import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

function noMessageFor(socket, durationMs = 40) {
  return new Promise((resolve, reject) => {
    const onMessage = (data) => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      reject(new Error(`Unexpected message received: ${data.toString()}`));
    };
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      resolve();
    }, durationMs);
    socket.on("message", onMessage);
  });
}

async function startGateway(options) {
  const server = createServer();
  const clients = [];
  attachSignalingGateway(server, { maxConnectionsPerIpPerMinute: 100, ...options });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const createClientSocket = () => {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/signal`);
    clients.push(socket);
    return socket;
  };

  return {
    createSocket: createClientSocket,
    async connect() {
      const socket = createClientSocket();
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

async function createJoinedPair(gateway) {
  const host = await gateway.connect();
  const pairing = await createPairing(gateway, host);
  const peer = await gateway.connect();
  const hostPeerJoined = nextJson(host);
  const peerJoined = nextJson(peer);
  sendJson(peer, {
    action: "join",
    roomId: pairing.roomId,
    joinToken: pairing.joinToken,
  });
  assert.equal((await peerJoined).type, "joined");
  assert.deepEqual(await hostPeerJoined, { type: "peer-joined" });
  return { host, peer, ...pairing };
}

async function waitUntilExpired(expiresAt) {
  const deadline = Date.now() + TEST_TIMEOUT_MS;
  while (Date.now() < expiresAt) {
    if (Date.now() >= deadline) throw new Error("Pairing did not reach its expiry time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
}

test("per-IP connection bursts are rejected without disrupting allowed callers", async () => {
  const maxConnections = 3;
  const gateway = await startGateway({
    maxConnectionsPerIpPerMinute: maxConnections,
    handshakeTimeoutMs: 5_000,
    cleanupIntervalMs: 10_000,
  });

  try {
    const host = await gateway.connect();
    const peer = await gateway.connect();
    const remainingAllowedSocket = await gateway.connect();
    const rejectedSocket = gateway.createSocket();
    rejectedSocket.on("error", () => {});
    const rejectedClose = new Promise((resolve) => rejectedSocket.once("close", resolve));
    const connectionResult = withTimeout(new Promise((resolve) => {
      const cleanup = () => {
        rejectedSocket.off("open", onOpen);
        rejectedSocket.off("error", onReject);
        rejectedSocket.off("close", onReject);
      };
      const onOpen = () => {
        cleanup();
        resolve("opened");
      };
      const onReject = () => {
        cleanup();
        resolve("rejected");
      };
      rejectedSocket.once("open", onOpen);
      rejectedSocket.once("error", onReject);
      rejectedSocket.once("close", onReject);
    }), "Timed out waiting for the over-limit connection to be rejected");

    assert.equal(await connectionResult, "rejected");
    await withTimeout(rejectedClose, "The rejected socket did not close");

    const pairing = await createPairing(gateway, host);
    const hostPeerJoined = nextJson(host);
    const peerJoined = nextJson(peer);
    sendJson(peer, {
      action: "join",
      roomId: pairing.roomId,
      joinToken: pairing.joinToken,
    });
    assert.equal((await peerJoined).type, "joined");
    assert.deepEqual(await hostPeerJoined, { type: "peer-joined" });
    assert.equal(remainingAllowedSocket.readyState, WebSocket.OPEN);
    assert.equal(host.readyState, WebSocket.OPEN);
    assert.equal(peer.readyState, WebSocket.OPEN);
  } finally {
    await gateway.close();
  }
});

test("a valid signal cannot be relayed with another pairing's room ID", async () => {
  const gateway = await startGateway({ handshakeTimeoutMs: 5_000, cleanupIntervalMs: 10_000 });

  try {
    const senderPair = await createJoinedPair(gateway);
    const otherPair = await createJoinedPair(gateway);
    const recipients = [senderPair.peer, otherPair.host, otherPair.peer];
    const mismatchedSignals = [
      { type: "offer", sdp: "v=0\r\n" },
      {
        type: "ice",
        candidate: "candidate:1 1 udp 1 192.0.2.1 12345 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      },
    ];

    for (const signal of mismatchedSignals) {
      const senderError = nextJson(senderPair.host);
      const recipientsStayQuiet = Promise.all(recipients.map((socket) => noMessageFor(socket, 100)));
      sendJson(senderPair.host, {
        action: "signal",
        roomId: otherPair.roomId,
        signal,
      });
      assert.deepEqual(await senderError, { type: "error", code: "unsupported_message" });
      await recipientsStayQuiet;
    }

    const validSignal = { type: "offer", sdp: "v=0\r\n" };
    const intendedPeerReceives = nextJson(senderPair.peer);
    const otherPairStaysQuiet = Promise.all([otherPair.host, otherPair.peer].map((socket) => noMessageFor(socket, 100)));
    sendJson(senderPair.host, {
      action: "signal",
      roomId: senderPair.roomId,
      signal: validSignal,
    });
    assert.deepEqual(await intendedPeerReceives, { type: "signal", signal: validSignal });
    await otherPairStaysQuiet;

    assert.equal(senderPair.host.readyState, WebSocket.OPEN);
    assert.equal(senderPair.peer.readyState, WebSocket.OPEN);
    assert.equal(otherPair.host.readyState, WebSocket.OPEN);
    assert.equal(otherPair.peer.readyState, WebSocket.OPEN);
  } finally {
    await gateway.close();
  }
});

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

test("a paired call survives invitation expiry and ends at its active-call limit", async () => {
  const gateway = await startGateway({
    sessionTtlMs: 100,
    activeCallTtlMs: 1_000,
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

    await waitUntilExpired(pairing.expiresAt);
    assert.equal(host.readyState, WebSocket.OPEN);
    assert.equal(peer.readyState, WebSocket.OPEN);
    const relayedSignal = nextJson(host);
    sendJson(peer, {
      action: "signal",
      roomId: pairing.roomId,
      signal: { type: "offer", sdp: "active-call-still-relays" },
    });
    assert.deepEqual(await relayedSignal, {
      type: "signal",
      signal: { type: "offer", sdp: "active-call-still-relays" },
    });

    const callExpiry = Date.now() + 1_000;
    const hostClosedMessage = nextJson(host);
    const peerClosedMessage = nextJson(peer);
    const hostClose = nextClose(host);
    const peerClose = nextClose(peer);

    await waitUntilExpired(callExpiry);
    assert.deepEqual(await hostClosedMessage, { type: "session-closed", reason: "call expired" });
    assert.deepEqual(await peerClosedMessage, { type: "session-closed", reason: "call expired" });
    assert.deepEqual(await hostClose, { code: 4001, reason: "call expired" });
    assert.deepEqual(await peerClose, { code: 4001, reason: "call expired" });

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

test("only offer, answer, and ICE signals are relayed without persistence or payload logs", async () => {
  const captured = captureConsole();
  const gateway = await startGateway({ sessionTtlMs: 5_000, cleanupIntervalMs: 10_000 });
  const markers = [
    "private-offer-sdp-marker",
    "private-answer-sdp-marker",
    "private-ice-candidate-marker",
    "private-chat-body-marker",
    "private-json-media-marker",
    "private-media-signal-marker",
    "private-unknown-field-marker",
    "private-binary-frame-marker",
  ];

  try {
    const { host, peer, roomId } = await createJoinedPair(gateway);
    const offer = { type: "offer", sdp: markers[0] };
    const answer = { type: "answer", sdp: markers[1] };
    const ice = {
      type: "ice",
      candidate: markers[2],
      sdpMid: "audio",
      sdpMLineIndex: 0,
    };

    for (const [sender, receiver, signal] of [
      [peer, host, offer],
      [host, peer, answer],
      [peer, host, ice],
    ]) {
      const relayed = nextJson(receiver);
      sendJson(sender, { action: "signal", roomId, signal });
      assert.deepEqual(await relayed, { type: "signal", signal });
    }

    const rejectedMessages = [
      {
        sender: host,
        receiver: peer,
        message: { action: "message", roomId, body: markers[3] },
        error: { type: "error", code: "unsupported_message" },
      },
      {
        sender: host,
        receiver: peer,
        message: { action: "media", roomId, payload: markers[4] },
        error: { type: "error", code: "unsupported_message" },
      },
      {
        sender: peer,
        receiver: host,
        message: {
          action: "signal",
          roomId,
          signal: { type: "media", payload: markers[5] },
        },
        error: { type: "error", code: "invalid_signal" },
      },
      {
        sender: peer,
        receiver: host,
        message: {
          action: "signal",
          roomId,
          extra: markers[6],
          signal: { type: "ice", candidate: "candidate:valid" },
        },
        error: { type: "error", code: "invalid_signal" },
      },
      {
        sender: peer,
        receiver: host,
        message: {
          action: "signal",
          roomId,
          signal: { type: "offer", sdp: "valid-sdp", unexpected: markers[6] },
        },
        error: { type: "error", code: "invalid_signal" },
      },
    ];

    for (const { sender, receiver, message, error } of rejectedMessages) {
      const response = nextJson(sender);
      const peerStaysQuiet = noMessageFor(receiver);
      sendJson(sender, message);
      assert.deepEqual(await response, error);
      await peerStaysQuiet;
    }

    const binaryResponse = nextJson(peer);
    const hostStaysQuiet = noMessageFor(host);
    peer.send(Buffer.from(markers[7]));
    assert.deepEqual(await binaryResponse, { type: "error", code: "text_frames_only" });
    await hostStaysQuiet;

    const signalingSource = await readFile(
      new URL("../src/lib/signaling.ts", import.meta.url),
      "utf8",
    );
    const imports = [...signalingSource.matchAll(/from\s+["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    assert.equal(
      imports.some((specifier) =>
        /(?:@workspace\/db|drizzle|pino|(?:^|\/)(?:db|database|storage|logger)(?:\/|$)|^node:fs(?:\/|$))/i.test(
          specifier,
        ),
      ),
      false,
      "signaling must not import persistence or logging modules",
    );
    assert.doesNotMatch(
      signalingSource,
      /\b(?:writeFile|appendFile|createWriteStream)\s*\(/,
      "signaling must not write payloads to persistent files",
    );
    assert.doesNotMatch(signalingSource, /\b(?:logger|console)\.(?:debug|info|log|warn|error)\s*\(/);
    assert.doesNotMatch(signalingSource, /\bprocess\.(?:stdout|stderr)\b/);

    for (const marker of markers) {
      assert.equal(captured.lines.join("\n").includes(marker), false, `${marker} was written to a console log`);
    }
  } finally {
    await gateway.close();
    captured.restore();
  }
});

test("oversized SDP, ICE candidates, and WebSocket frames are rejected", async () => {
  const gateway = await startGateway({
    sessionTtlMs: 5_000,
    cleanupIntervalMs: 10_000,
    handshakeTimeoutMs: 2_000,
  });

  try {
    const { host, peer, roomId } = await createJoinedPair(gateway);
    const oversizedSignals = [
      { type: "offer", sdp: "s".repeat(12_001) },
      { type: "ice", candidate: "c".repeat(4_001) },
    ];

    for (const signal of oversizedSignals) {
      const rejection = nextJson(host);
      const peerStaysQuiet = noMessageFor(peer);
      sendJson(host, { action: "signal", roomId, signal });
      assert.deepEqual(await rejection, { type: "error", code: "invalid_signal" });
      await peerStaysQuiet;
    }

    const oversizedFrame = await gateway.connect();
    const oversizedFrameClose = nextClose(oversizedFrame);
    oversizedFrame.send("x".repeat(16 * 1024 + 1));
    const close = await oversizedFrameClose;
    assert.equal(close.code, 1009);
  } finally {
    await gateway.close();
  }
});

test("a signaling socket is closed after exceeding the message-rate limit", async () => {
  const captured = captureConsole();
  const gateway = await startGateway({ handshakeTimeoutMs: 5_000, cleanupIntervalMs: 10_000 });
  const marker = "private-rate-limit-payload-marker";

  try {
    const socket = await gateway.connect();
    const close = nextClose(socket);
    for (let index = 0; index < 41; index += 1) {
      sendJson(socket, { action: "unsupported", marker });
    }

    assert.deepEqual(await close, { code: 4005, reason: "message rate exceeded" });
    assert.equal(captured.lines.join("\n").includes(marker), false);
  } finally {
    await gateway.close();
    captured.restore();
  }
});
