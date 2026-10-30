import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCallVerificationMaterial,
  encodeCallInvite,
  encodeFingerprintVerificationQr,
  extractSha256Fingerprint,
  hasAudioVideoMedia,
  parseCallInvite,
  parseFingerprintVerificationQr,
} from '../security/secureCallVerification.ts';

const validInvite = {
  roomId: 'abcdefghijklmnop',
  joinToken: 'A'.repeat(43),
  mode: 'video',
  expiresAt: 1_800_000_100_000,
};

test('call invitation QR is strict, short-lived, and round-trips', () => {
  const encoded = encodeCallInvite(validInvite);
  assert.deepEqual(parseCallInvite(encoded, 1_800_000_000_000), validInvite);
  assert.equal(parseCallInvite(encoded, validInvite.expiresAt), null);
  assert.equal(
    parseCallInvite(encodeCallInvite({ ...validInvite, expiresAt: 1_800_000_200_000 }), 1_800_000_000_000),
    null,
  );
  assert.equal(parseCallInvite(`${encoded}junk`, 1_800_000_000_000), null);
  assert.throws(() => encodeCallInvite({ ...validInvite, joinToken: 'short' }));
});

test('fingerprint verification QR accepts only one full SHA-256 comparison value', () => {
  const value = 'AB'.repeat(32);
  const encoded = encodeFingerprintVerificationQr(value);
  assert.equal(parseFingerprintVerificationQr(encoded), value);
  assert.equal(parseFingerprintVerificationQr(`${encoded}extra`), null);
  assert.throws(() => encodeFingerprintVerificationQr('1234'));
});

test('both peers build identical verification material from the same DTLS fingerprints', () => {
  const caller = '11'.repeat(32);
  const callee = '22'.repeat(32);
  const common = { roomId: validInvite.roomId, joinToken: validInvite.joinToken };
  const callerMaterial = buildCallVerificationMaterial({
    ...common,
    role: 'host',
    localFingerprint: caller,
    remoteFingerprint: callee,
  });
  const calleeMaterial = buildCallVerificationMaterial({
    ...common,
    role: 'joiner',
    localFingerprint: callee,
    remoteFingerprint: caller,
  });
  assert.equal(callerMaterial, calleeMaterial);
});

test('requires a complete SHA-256 DTLS fingerprint and detects media SDP', () => {
  const fingerprint = 'AA:'.repeat(31) + 'AA';
  const sdp = `v=0\r\na=fingerprint:sha-256 ${fingerprint}\r\na=setup:actpass\r\n`;
  assert.equal(extractSha256Fingerprint(sdp), 'AA'.repeat(32));
  assert.throws(() => extractSha256Fingerprint('v=0\r\na=fingerprint:sha-1 AA\r\n'));
  assert.equal(hasAudioVideoMedia('v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n'), false);
  assert.equal(hasAudioVideoMedia('v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'), true);
});
