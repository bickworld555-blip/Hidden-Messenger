import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { inspect } from "node:util";
import { test } from "node:test";
import WebSocket from "ws";
import { attachSignalingGateway } from "../src/lib/signaling.ts";

const TEST_TIMEOUT_MS = 2_000;

function withTimeout(promise, message = "Timed out waiting for WebSocket event") {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), TEST_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

function nextJson(socket) {
  return withTimeout(once(socket, "message")).then(([data]) => JSON.parse(data.toString()));
}

function nextClose(socket) {
  return withTimeout(once(socket, "close")).then(([code, reason]) => ({
    code,
    reason: reason.toString(),
  }));
}

function sendJson(socket, value) {
  socket.send(JSON.stringify(value));
}

function captureConsole() {
  const methods = ["debug", "info", "log", "warn", "error"];
  const originals = new Map();
  const lines = [];

  for (const method of methods) {
    originals.set(method, console[method]);
    console[method] = (...args) => {
      lines.push(args.map((arg) => (typeof arg === "string" ? arg : inspect(arg))).join(" "));
    };
  }

  return {
    lines,
    restore() {
      for (const [method, original] of originals) console[method] = original;
    },
  };
}

async function startGateway(options) {
  const server = createServer();
  const clients = [];
  attachSignalingGateway(server, options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    async connect() {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/signal`);
      clients.push(socket);
      await withTimeout(once(socket, "open"), "Timed out opening WebSocket");
      return socket;
    },
    async close() {
      await Promise.all(
        clients.map(async (socket) => {
          if (socket.readyState === WebSocket.CLOSED) return;
          const closed = nextClose(socket);
          if (socket.readyState === WebSocket.OPEN) socket.close(1000, "test cleanup");
          else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
          await closed;
        }),
      );
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    },
  };
}

async function createPairing(gateway, socket) {
  const response = nextJson(socket);
  sendJson(socket, { action: "create" });
  const message = await response;
  assert.equal(message.type, "created");
  return message;
}

async function waitUntilExpired(expiresAt) {
  const deadline = Date.now() + TEST_TIMEOUT_MS;
  while (Date.now() < expiresAt) {
    if (Date.now() >= deadline) throw new Error("Pairing did not reach its expiry time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
}

test("joining requires the token, can happen once, and does not log token or SDP", async () => {
  const captured = captureConsole();
  const gateway = await startGateway({ sessionTtlMs: 5_000, cleanupIntervalMs: 10_000, maxSessions: 1 });

  try {
    const host = await gateway.connect();
    const { roomId, joinToken } = await createPairing(gateway, host);

    const noTokenSocket = await gateway.connect();
    const missingTokenResponse = nextJson(noTokenSocket);
    sendJson(noTokenSocket, { action: "join", roomId });
    assert.deepEqual(await missingTokenResponse, { type: "error", code: "pairing_required" });

    const wrongTokenSocket = await gateway.connect();
    const wrongTokenClose = nextClose(wrongTokenSocket);
    const wrongToken = `${joinToken.slice(0, -1)}${joinToken.endsWith("A") ? "B" : "A"}`;
    sendJson(wrongTokenSocket, { action: "join", roomId, joinToken: wrongToken });
    assert.deepEqual(await wrongTokenClose, {
      code: 4004,
      reason: "invalid or expired pairing",
    });
    assert.equal(host.readyState, WebSocket.OPEN);

    const peer = await gateway.connect();
    const hostPeerJoined = nextJson(host);
    const peerJoinedMessage = nextJson(peer);
    sendJson(peer, { action: "join", roomId, joinToken });
    const joinedMessage = await peerJoinedMessage;
    assert.equal(joinedMessage.type, "joined");
    assert.equal(joinedMessage.roomId, roomId);
    assert.equal(typeof joinedMessage.expiresAt, "number");
    assert.deepEqual(await hostPeerJoined, { type: "peer-joined" });

    const reusedTokenSocket = await gateway.connect();
    const reusedTokenClose = nextClose(reusedTokenSocket);
    sendJson(reusedTokenSocket, { action: "join", roomId, joinToken });
    assert.deepEqual(await reusedTokenClose, {
      code: 4004,
      reason: "invalid or expired pairing",
    });

    const sdpMarker = "private-test-sdp-marker";
    const relayedSignal = nextJson(host);
    sendJson(peer, {
      action: "signal",
      roomId,
      signal: { type: "offer", sdp: sdpMarker },
    });
    assert.deepEqual(await relayedSignal, {
      type: "signal",
      signal: { type: "offer", sdp: sdpMarker },
    });

    const logOutput = captured.lines.join("\n");
    assert.equal(logOutput.includes(joinToken), false, "join token was written to a console log");
    assert.equal(logOutput.includes(sdpMarker), false, "SDP was written to a console log");
  } finally {
    await gateway.close();
    captured.restore();
  }
});

test("an expired pairing rejects a late join and frees room capacity", async () => {
  const captured = captureConsole();
  const gateway = await startGateway({
    sessionTtlMs: 150,
    cleanupIntervalMs: 10_000,
    handshakeTimeoutMs: 1_000,
    maxSessions: 1,
  });

  try {
    const host = await gateway.connect();
    const pairing = await createPairing(gateway, host);
    await waitUntilExpired(pairing.expiresAt);

    const hostClosedMessage = nextJson(host);
    const hostClose = nextClose(host);
    const lateJoiner = await gateway.connect();
    const lateJoinerClose = nextClose(lateJoiner);
    sendJson(lateJoiner, {
      action: "join",
      roomId: pairing.roomId,
      joinToken: pairing.joinToken,
    });

    assert.deepEqual(await hostClosedMessage, { type: "session-closed", reason: "pairing expired" });
    assert.deepEqual(await hostClose, { code: 4001, reason: "pairing expired" });
    assert.deepEqual(await lateJoinerClose, {
      code: 4004,
      reason: "invalid or expired pairing",
    });

    const replacementHost = await gateway.connect();
    assert.equal((await createPairing(gateway, replacementHost)).type, "created");

    assert.equal(captured.lines.join("\n").includes(pairing.joinToken), false);
  } finally {
    await gateway.close();
    captured.restore();
  }
});

test("periodic expiry closes both connected peers and removes the room", async () => {
  const gateway = await startGateway({
    sessionTtlMs: 200,
    cleanupIntervalMs: 10,
    handshakeTimeoutMs: 1_000,
    maxSessions: 1,
  });

  try {
    const host = await gateway.connect();
    const pairing = await createPairing(gateway, host);
    const peer = await gateway.connect();
    const hostPeerJoined = nextJson(host);
    const peerJoined = nextJson(peer);
    sendJson(peer, { action: "join", roomId: pairing.roomId, joinToken: pairing.joinToken });
    await peerJoined;
    await hostPeerJoined;

    const hostClosedMessage = nextJson(host);
    const peerClosedMessage = nextJson(peer);
    const hostClose = nextClose(host);
    const peerClose = nextClose(peer);

    assert.deepEqual(await hostClosedMessage, { type: "session-closed", reason: "pairing expired" });
    assert.deepEqual(await peerClosedMessage, { type: "session-closed", reason: "pairing expired" });
    assert.deepEqual(await hostClose, { code: 4001, reason: "pairing expired" });
    assert.deepEqual(await peerClose, { code: 4001, reason: "pairing expired" });

    const replacementHost = await gateway.connect();
    assert.equal((await createPairing(gateway, replacementHost)).type, "created");
  } finally {
    await gateway.close();
  }
});

test("a peer disconnect invalidates the pairing and closes the remaining socket", async () => {
  const captured = captureConsole();
  const gateway = await startGateway({
    sessionTtlMs: 5_000,
    cleanupIntervalMs: 10_000,
    handshakeTimeoutMs: 1_000,
    maxSessions: 1,
  });

  try {
    const host = await gateway.connect();
    const pairing = await createPairing(gateway, host);
    const peer = await gateway.connect();
    const hostPeerJoined = nextJson(host);
    const peerJoined = nextJson(peer);
    sendJson(peer, { action: "join", roomId: pairing.roomId, joinToken: pairing.joinToken });
    await peerJoined;
    await hostPeerJoined;

    const hostClosedMessage = nextJson(host);
    const hostClose = nextClose(host);
    const peerClose = nextClose(peer);
    peer.close(1000, "test disconnect");

    assert.deepEqual(await peerClose, { code: 1000, reason: "test disconnect" });
    assert.deepEqual(await hostClosedMessage, { type: "session-closed", reason: "peer disconnected" });
    assert.deepEqual(await hostClose, { code: 4001, reason: "peer disconnected" });

    const staleJoiner = await gateway.connect();
    const staleJoinClose = nextClose(staleJoiner);
    sendJson(staleJoiner, {
      action: "join",
      roomId: pairing.roomId,
      joinToken: pairing.joinToken,
    });
    assert.deepEqual(await staleJoinClose, {
      code: 4004,
      reason: "invalid or expired pairing",
    });

    const replacementHost = await gateway.connect();
    assert.equal((await createPairing(gateway, replacementHost)).type, "created");
    assert.equal(captured.lines.join("\n").includes(pairing.joinToken), false);
  } finally {
    await gateway.close();
    captured.restore();
  }
});
