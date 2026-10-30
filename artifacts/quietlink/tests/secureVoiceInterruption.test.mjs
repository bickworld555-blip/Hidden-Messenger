import assert from 'node:assert/strict';
import test from 'node:test';

import {
  discardInterruptedVoiceCapture,
  notifyVoiceNoteInterruption,
  subscribeToVoiceNoteInterruption,
} from '../storage/voiceNoteInterruption.ts';

test('audio interruption stops capture, drains writes, aborts without saving, and releases monitoring', async () => {
  const steps = [];
  let keyAvailable = true;
  let ciphertextFileExists = true;
  let databaseRows = 0;
  const writer = {
    abort: async () => {
      steps.push('abort');
      keyAvailable = false;
      ciphertextFileExists = false;
    },
    finish: async () => {
      steps.push('finish');
      databaseRows += 1;
    },
  };

  await discardInterruptedVoiceCapture({
    writer,
    stopStream: () => steps.push('stop-stream'),
    drainPendingWrites: async () => steps.push('drain-writes'),
    stopInterruptionMonitoring: async () => steps.push('stop-monitor'),
  });

  assert.deepEqual(steps, ['stop-stream', 'drain-writes', 'abort', 'stop-monitor']);
  assert.equal(keyAvailable, false);
  assert.equal(ciphertextFileExists, false);
  assert.equal(databaseRows, 0);
});

test('interruption cleanup still aborts the writer when draining or monitor teardown fails', async () => {
  const steps = [];
  await assert.rejects(
    discardInterruptedVoiceCapture({
      writer: { abort: async () => steps.push('abort') },
      stopStream: () => steps.push('stop-stream'),
      drainPendingWrites: async () => {
        steps.push('drain-writes');
        throw new Error('interrupted drain');
      },
      stopInterruptionMonitoring: async () => {
        steps.push('stop-monitor');
        throw new Error('monitor already stopped');
      },
    }),
    /interrupted drain/,
  );
  assert.deepEqual(steps, ['stop-stream', 'drain-writes', 'abort', 'stop-monitor']);
});

test('opening a call route notifies mounted voice-note capture panels to abort', () => {
  let interruptions = 0;
  const unsubscribe = subscribeToVoiceNoteInterruption(() => {
    interruptions += 1;
  });
  notifyVoiceNoteInterruption();
  unsubscribe();
  notifyVoiceNoteInterruption();
  assert.equal(interruptions, 1);
});
