import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSecureCallAvailability } from '../security/secureCallAvailability.ts';
import { createUnavailableSecureCallSession } from '../services/unavailableSecureCallSession.ts';

test('web preview fails closed without native call initialization', () => {
  const availability = getSecureCallAvailability('web', {});

  assert.equal(availability.available, false);
  assert.match(availability.reason, /rebuilt native iOS or Android app/i);
});

test('native build without the WebRTC module returns a user-facing reason', () => {
  const availability = getSecureCallAvailability('android', null);

  assert.equal(availability.available, false);
  assert.match(availability.reason, /WebRTC native module is not installed/i);
});

test('native build with a registered WebRTC module is eligible to initialize', () => {
  assert.deepEqual(getSecureCallAvailability('ios', {}), {
    available: true,
    reason: null,
  });
});

test('unavailable call sessions publish an error and reject without connecting', async () => {
  const session = createUnavailableSecureCallSession(
    'host',
    'audio',
    'WebRTC is unavailable in this build.',
  );
  let snapshot;
  session.subscribe((value) => {
    snapshot = value;
  });

  assert.equal(snapshot.status, 'error');
  assert.equal(snapshot.inviteQr, null);
  await assert.rejects(session.startOutgoing(), /unavailable in this build/i);
});
