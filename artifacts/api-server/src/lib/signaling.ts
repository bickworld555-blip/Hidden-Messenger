import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";

const SIGNAL_PATH = "/api/signal";
const SESSION_TTL_MS = 2 * 60 * 1000;
const ACTIVE_CALL_TTL_MS = 4 * 60 * 60 * 1000;
const HANDSHAKE_TIMEOUT_MS = 10 * 1000;
const MAX_SESSIONS = 250;
const MAX_CONNECTIONS_PER_IP_PER_MINUTE = 20;
const CLEANUP_INTERVAL_MS = 30_000;

type SignalingGatewayOptions = {
  sessionTtlMs?: number;
  activeCallTtlMs?: number;
  cleanupIntervalMs?: number;
  handshakeTimeoutMs?: number;
  maxSessions?: number;
  maxConnectionsPerIpPerMinute?: number;
};

type OfferSignal = { type: "offer" | "answer"; sdp: string };
type IceSignal = {
  type: "ice";
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
};
type Signal = OfferSignal | IceSignal;
type Room = {
  id: string;
  joinTokenHash: Buffer;
  peers: Set<WebSocket>;
  expiresAt: number;
  pairingExpiresAt: number;
};

const rooms = new Map<string, Room>();
const roomBySocket = new WeakMap<WebSocket, Room>();
const connectionWindows = new Map<string, { startedAt: number; count: number }>();
const socketServer = new WebSocketServer({
  noServer: true,
  maxPayload: 16 * 1024,
  perMessageDeflate: false,
});

function send(socket: WebSocket, message: Record<string, unknown>) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function closeRoom(room: Room, reason: string, except?: WebSocket) {
  if (rooms.get(room.id) !== room) return;
  rooms.delete(room.id);
  for (const peer of room.peers) {
    roomBySocket.delete(peer);
    if (peer === except) continue;
    send(peer, { type: "session-closed", reason });
    peer.close(4001, reason.slice(0, 100));
  }
  room.peers.clear();
}

function getRemoteKey(request: IncomingMessage) {
  return request.socket.remoteAddress ?? "unknown";
}

function isRateLimited(
  remoteKey: string,
  maxConnectionsPerIpPerMinute = MAX_CONNECTIONS_PER_IP_PER_MINUTE,
) {
  const now = Date.now();
  const window = connectionWindows.get(remoteKey);
  if (!window || now - window.startedAt >= 60_000) {
    connectionWindows.set(remoteKey, { startedAt: now, count: 1 });
    return false;
  }
  window.count += 1;
  return window.count > maxConnectionsPerIpPerMinute;
}

function parseSignal(value: unknown): Signal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const signal = value as Record<string, unknown>;
  if (signal.type === "offer" || signal.type === "answer") {
    if (typeof signal.sdp !== "string" || signal.sdp.length === 0 || signal.sdp.length > 12_000) return null;
    if (Object.keys(signal).some((key) => key !== "type" && key !== "sdp")) return null;
    return { type: signal.type, sdp: signal.sdp };
  }
  if (signal.type === "ice") {
    if (typeof signal.candidate !== "string" || signal.candidate.length > 4_000) return null;
    if (signal.sdpMid !== undefined && signal.sdpMid !== null && typeof signal.sdpMid !== "string") return null;
    if (signal.sdpMLineIndex !== undefined && signal.sdpMLineIndex !== null && typeof signal.sdpMLineIndex !== "number") return null;
    if (Object.keys(signal).some((key) => !["type", "candidate", "sdpMid", "sdpMLineIndex"].includes(key))) return null;
    return {
      type: "ice",
      candidate: signal.candidate,
      sdpMid: signal.sdpMid as string | null | undefined,
      sdpMLineIndex: signal.sdpMLineIndex as number | null | undefined,
    };
  }
  return null;
}

function bindSocket(
  socket: WebSocket,
  options: Required<SignalingGatewayOptions>,
) {
  let room: Room | undefined;
  let authenticated = false;
  let messageWindowStartedAt = Date.now();
  let messageCount = 0;
  const handshakeTimer = setTimeout(
    () => socket.close(4002, "handshake timeout"),
    options.handshakeTimeoutMs,
  );

  socket.on("message", (raw, isBinary) => {
    const now = Date.now();
    if (now - messageWindowStartedAt >= 10_000) {
      messageWindowStartedAt = now;
      messageCount = 0;
    }
    messageCount += 1;
    if (messageCount > 40) {
      socket.close(4005, "message rate exceeded");
      return;
    }

    if (isBinary) {
      send(socket, { type: "error", code: "text_frames_only" });
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: "error", code: "invalid_json" });
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      send(socket, { type: "error", code: "invalid_message" });
      return;
    }
    const value = message as Record<string, unknown>;

    if (!authenticated) {
      if (value.action === "create" && Object.keys(value).length === 1) {
        if (rooms.size >= options.maxSessions) {
          socket.close(4003, "signaling capacity reached");
          return;
        }
        const id = randomBytes(12).toString("base64url");
        const joinToken = randomBytes(32).toString("base64url");
        room = {
          id,
          joinTokenHash: createHash("sha256").update(joinToken).digest(),
          peers: new Set([socket]),
          expiresAt: Date.now() + options.activeCallTtlMs,
          pairingExpiresAt: Date.now() + options.sessionTtlMs,
        };
        rooms.set(id, room);
        roomBySocket.set(socket, room);
        authenticated = true;
        clearTimeout(handshakeTimer);
        send(socket, { type: "created", roomId: id, joinToken, expiresAt: room.pairingExpiresAt });
        return;
      }

      if (value.action === "join" && typeof value.roomId === "string" && typeof value.joinToken === "string") {
        const candidateRoom = rooms.get(value.roomId);
        if (!candidateRoom) {
          socket.close(4004, "invalid or expired pairing");
          return;
        }
        if (candidateRoom.pairingExpiresAt <= Date.now()) {
          closeRoom(candidateRoom, "pairing expired");
          socket.close(4004, "invalid or expired pairing");
          return;
        }
        if (candidateRoom.peers.size !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(value.joinToken)) {
          socket.close(4004, "invalid or expired pairing");
          return;
        }
        const suppliedHash = createHash("sha256").update(value.joinToken).digest();
        if (!timingSafeEqual(candidateRoom.joinTokenHash, suppliedHash)) {
          socket.close(4004, "invalid or expired pairing");
          return;
        }
        room = candidateRoom;
        room.peers.add(socket);
        roomBySocket.set(socket, room);
        authenticated = true;
        clearTimeout(handshakeTimer);
        send(socket, { type: "joined", roomId: room.id, expiresAt: room.expiresAt });
        for (const peer of room.peers) if (peer !== socket) send(peer, { type: "peer-joined" });
        return;
      }

      send(socket, { type: "error", code: "pairing_required" });
      return;
    }

    if (value.action === "signal") {
      if (!room || value.roomId !== room.id) {
        send(socket, { type: "error", code: "unsupported_message" });
        return;
      }
      const activeRoom = room;
      if (activeRoom.expiresAt <= Date.now()) {
        closeRoom(activeRoom, "pairing expired");
        return;
      }
      const signal = parseSignal(value.signal);
      if (!signal || Object.keys(value).some((key) => !["action", "roomId", "signal"].includes(key))) {
        send(socket, { type: "error", code: "invalid_signal" });
        return;
      }
      if (activeRoom.peers.size !== 2) {
        send(socket, { type: "error", code: "peer_not_joined" });
        return;
      }
      for (const peer of activeRoom.peers) {
        if (peer !== socket) send(peer, { type: "signal", signal });
      }
      return;
    }

    send(socket, { type: "error", code: "unsupported_message" });
  });

  socket.on("close", () => {
    clearTimeout(handshakeTimer);
    const connectedRoom = roomBySocket.get(socket);
    if (connectedRoom) closeRoom(connectedRoom, "peer disconnected", socket);
  });

  socket.on("error", () => {
    // Socket errors are deliberately not logged with request, pairing, or SDP data.
  });
}

/**
 * Attaches a memory-only WebSocket signaling gateway to the API HTTP server.
 * The gateway accepts ephemeral pairing and WebRTC offer/answer/ICE messages,
 * and rejects chat text, media frames, and unrecognized payload shapes.
 */
export function attachSignalingGateway(
  server: Server,
  options: SignalingGatewayOptions = {},
) {
  const resolvedOptions: Required<SignalingGatewayOptions> = {
    sessionTtlMs: options.sessionTtlMs ?? SESSION_TTL_MS,
    activeCallTtlMs: options.activeCallTtlMs ?? ACTIVE_CALL_TTL_MS,
    cleanupIntervalMs: options.cleanupIntervalMs ?? CLEANUP_INTERVAL_MS,
    handshakeTimeoutMs: options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS,
    maxSessions: options.maxSessions ?? MAX_SESSIONS,
    maxConnectionsPerIpPerMinute:
      options.maxConnectionsPerIpPerMinute ?? MAX_CONNECTIONS_PER_IP_PER_MINUTE,
  };
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.peers.size === 1 && room.pairingExpiresAt <= now) {
        closeRoom(room, "pairing expired");
      } else if (room.peers.size === 2 && room.expiresAt <= now) {
        closeRoom(room, "call expired");
      }
    }
    for (const [key, window] of connectionWindows) {
      if (now - window.startedAt >= 60_000) connectionWindows.delete(key);
    }
  }, resolvedOptions.cleanupIntervalMs);
  cleanupTimer.unref();
  server.once("close", () => clearInterval(cleanupTimer));

  server.on("upgrade", (request, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== SIGNAL_PATH) return;
    if (isRateLimited(getRemoteKey(request), resolvedOptions.maxConnectionsPerIpPerMinute)) {
      socket.destroy();
      return;
    }
    socketServer.handleUpgrade(request, socket, head, (webSocket) => {
      socketServer.emit("connection", webSocket, request);
      bindSocket(webSocket, resolvedOptions);
    });
  });
}
