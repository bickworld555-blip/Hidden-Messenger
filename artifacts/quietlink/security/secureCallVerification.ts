export type CallMode = 'audio' | 'video';
export type CallInvite = {
  roomId: string;
  joinToken: string;
  mode: CallMode;
  expiresAt: number;
};

const CALL_INVITE_PREFIX = 'HM-CALL-1:';
const CALL_VERIFY_PREFIX = 'HM-VERIFY-1:';
const MAX_INVITE_LIFETIME_MS = 125_000;

function isValidRoomId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16}$/.test(value);
}

function isValidJoinToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function isCallMode(value: unknown): value is CallMode {
  return value === 'audio' || value === 'video';
}

export function encodeCallInvite(invite: CallInvite) {
  if (
    !isValidRoomId(invite.roomId) ||
    !isValidJoinToken(invite.joinToken) ||
    !isCallMode(invite.mode) ||
    !Number.isSafeInteger(invite.expiresAt)
  ) {
    throw new Error('Invalid temporary call invitation.');
  }
  return `${CALL_INVITE_PREFIX}${JSON.stringify({
    v: 1,
    roomId: invite.roomId,
    joinToken: invite.joinToken,
    mode: invite.mode,
    expiresAt: invite.expiresAt,
  })}`;
}

export function parseCallInvite(value: string, now = Date.now()): CallInvite | null {
  if (!value.startsWith(CALL_INVITE_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(value.slice(CALL_INVITE_PREFIX.length));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (
      Object.keys(record).length !== 5 ||
      record.v !== 1 ||
      !isValidRoomId(record.roomId) ||
      !isValidJoinToken(record.joinToken) ||
      !isCallMode(record.mode) ||
      !Number.isSafeInteger(record.expiresAt) ||
      (record.expiresAt as number) <= now ||
      (record.expiresAt as number) > now + MAX_INVITE_LIFETIME_MS
    ) {
      return null;
    }
    return {
      roomId: record.roomId,
      joinToken: record.joinToken,
      mode: record.mode,
      expiresAt: record.expiresAt as number,
    };
  } catch {
    return null;
  }
}

export function encodeFingerprintVerificationQr(code: string) {
  if (!/^[A-F0-9]{64}$/.test(code)) {
    throw new Error('Invalid call verification fingerprint.');
  }
  return `${CALL_VERIFY_PREFIX}${code}`;
}

export function parseFingerprintVerificationQr(value: string) {
  if (!value.startsWith(CALL_VERIFY_PREFIX)) return null;
  const code = value.slice(CALL_VERIFY_PREFIX.length);
  return /^[A-F0-9]{64}$/.test(code) ? code : null;
}

export function extractSha256Fingerprint(sdp: string) {
  const match = sdp.match(
    /(?:^|\r?\n)a=fingerprint:sha-256 ((?:[0-9a-f]{2}:){31}[0-9a-f]{2})(?:\r?\n|$)/i,
  );
  if (!match) throw new Error('WebRTC did not provide a SHA-256 DTLS fingerprint.');
  return match[1].replaceAll(':', '').toUpperCase();
}

export function buildCallVerificationMaterial(input: {
  role: 'host' | 'joiner';
  roomId: string;
  joinToken: string;
  localFingerprint: string;
  remoteFingerprint: string;
}) {
  const initiatorFingerprint = input.role === 'host'
    ? input.localFingerprint
    : input.remoteFingerprint;
  const responderFingerprint = input.role === 'host'
    ? input.remoteFingerprint
    : input.localFingerprint;
  return [
    'HiddenMessenger-Verified-WebRTC-Call-v1',
    input.roomId,
    input.joinToken,
    initiatorFingerprint,
    responderFingerprint,
  ].join('\n');
}

export function hasAudioVideoMedia(sdp: string) {
  return /(?:^|\r?\n)m=(?:audio|video) /i.test(sdp);
}
