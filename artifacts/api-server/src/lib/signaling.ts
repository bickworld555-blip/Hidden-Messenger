import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";

const SIGNAL_PATH = "/api/signal";
const SESSION_TTL_MS = 2 * 60 * 1000;
const HANDSHAKE_TIMEOUT_MS = 10 * 1000;
const MAX_SESSIONS = 250;
const MAX_CONNECTIONS_PER_IP_PER_MINUTE = 20;

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
}

function getRemoteKey(request: IncomingMessage) {
  return request.socket.remoteAddress ?? "unknown";
}

function isRateLimited(remoteKey: string) {
  const now = Date.now();
  const window = connectionWindows.get(remoteKey);
  if (!window || now - window.startedAt >= 60_000) {
    connectionWindows.set(remoteKey, { startedAt: now, count: 1 });
    return false;
  }
  window.count += 1;
  return window.count > MAX_CONNECTIONS_PER_IP_PER_MINUTE;
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

function bindSocket(socket: WebSocket) {
  let room: Room | undefined;
  let authenticated = false;
  let messageWindowStartedAt = Date.now();
  let messageCount = 0;
  const handshakeTimer = setTimeout(() => socket.close(4002, "handshake timeout"), HANDSHAKE_TIMEOUT_MS);

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
        if (rooms.size >= MAX_SESSIONS) {
          socket.close(4003, "signaling capacity reached");
          return;
        }
        const id = randomBytes(12).toString("base64url");
        const joinToken = randomBytes(32).toString("base64url");
        room = {
          id,
          joinTokenHash: createHash("sha256").update(joinToken).digest(),
          peers: new Set([socket]),
          expiresAt: Date.now() + SESSION_TTL_MS,
        };
        rooms.set(id, room);
        roomBySocket.set(socket, room);
        authenticated = true;
        clearTimeout(handshakeTimer);
        send(socket, { type: "created", roomId: id, joinToken, expiresAt: room.expiresAt });
        return;
      }

      if (value.action === "join" && typeof value.roomId === "string" && typeof value.joinToken === "string") {
        const candidateRoom = rooms.get(value.roomId);
        if (
          !candidateRoom ||
          candidateRoom.expiresAt <= Date.now() ||
          candidateRoom.peers.size !== 1 ||
          !/^[A-Za-z0-9_-]{43}$/.test(value.joinToken)
        ) {
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

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.expiresAt <= now) closeRoom(room, "pairing expired");
  }
  for (const [key, window] of connectionWindows) {
    if (now - window.startedAt >= 60_000) connectionWindows.delete(key);
  }
}, 30_000);
cleanupTimer.unref();

/**
 * Attaches a memory-only WebSocket signaling gateway to the API HTTP server.
 * The gateway accepts ephemeral pairing and WebRTC offer/answer/ICE messages,
 * and rejects chat text, media frames, and unrecognized payload shapes.
 */
export function attachSignalingGateway(server: Server) {
  server.on("upgrade", (request, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== SIGNAL_PATH) return;
    if (isRateLimited(getRemoteKey(request))) {
      socket.destroy();
      return;
    }
    socketServer.handleUpgrade(request, socket, head, (webSocket) => {
      socketServer.emit("connection", webSocket, request);
      bindSocket(webSocket);
    });
  });
}
