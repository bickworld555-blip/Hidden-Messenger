import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  readExactly,
  withAuthenticatedMediaChunk,
} from '../storage/secureMediaBuffers.ts';
import {
  E2EEUnavailableError,
  isMediaKeyWrappingReady,
  wrapMediaFileKey,
} from '../security/secureMessaging.ts';

function encryptTestFrame(plaintext, key, nonce, aad) {
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}

function decryptTestFrame(frame, key, aad) {
  const iv = frame.subarray(0, 12);
  const tag = frame.subarray(frame.length - 16);
  const ciphertext = frame.subarray(12, frame.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

test('readExactly assembles partial reads and clears each source buffer', async () => {
  const first = Uint8Array.from([10, 20]);
  const second = Uint8Array.from([30, 40, 50]);
  const parts = [first, second];
  const output = await readExactly(
    { readBytes: async () => parts.shift() ?? new Uint8Array() },
    5,
  );

  assert.deepEqual(Array.from(output), [10, 20, 30, 40, 50]);
  assert.deepEqual(Array.from(first), [0, 0]);
  assert.deepEqual(Array.from(second), [0, 0, 0]);
  output.fill(0);
});

test('readExactly rejects an interrupted read and clears the partial source buffer', async () => {
  const partial = Uint8Array.from([71, 72, 73]);
  let readCount = 0;
  const reader = {
    async readBytes() {
      readCount += 1;
      if (readCount === 1) return partial;
      throw new Error('simulated interrupted file read');
    },
  };

  await assert.rejects(readExactly(reader, 6), /interrupted file read/);
  assert.deepEqual(Array.from(partial), [0, 0, 0]);
});

test('a corrupted GCM tag never reaches the consumer and clears the frame', async () => {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const aad = Buffer.from('quietlink media test aad');
  const frame = encryptTestFrame(Buffer.from('synthetic media bytes'), key, nonce, aad);
  frame[frame.length - 1] ^= 1;
  let consumerCalled = false;

  await assert.rejects(
    withAuthenticatedMediaChunk(
      frame,
      async (input) => decryptTestFrame(input, key, aad),
      () => {
        consumerCalled = true;
      },
    ),
  );

  assert.equal(consumerCalled, false);
  assert.equal(frame.every((byte) => byte === 0), true);
  key.fill(0);
  nonce.fill(0);
  aad.fill(0);
});

test('the decrypted buffer is zeroed as soon as the consumer callback completes', async () => {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const aad = Buffer.from('quietlink media test aad');
  const clear = Buffer.from('temporary decoded media chunk');
  const frame = encryptTestFrame(clear, key, nonce, aad);
  let consumedBuffer;

  await withAuthenticatedMediaChunk(
    frame,
    async (input) => decryptTestFrame(input, key, aad),
    (plaintext) => {
      consumedBuffer = plaintext;
      assert.deepEqual(Buffer.from(plaintext), clear);
    },
  );

  assert.equal(consumedBuffer.every((byte) => byte === 0), true);
  assert.equal(frame.every((byte) => byte === 0), true);
  key.fill(0);
  nonce.fill(0);
  aad.fill(0);
  clear.fill(0);
});

test('buffers are cleared even when rendering code rejects', async () => {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const aad = Buffer.from('quietlink media test aad');
  const frame = encryptTestFrame(Buffer.from('synthetic media bytes'), key, nonce, aad);
  let consumedBuffer;

  await assert.rejects(
    withAuthenticatedMediaChunk(
      frame,
      async (input) => decryptTestFrame(input, key, aad),
      (plaintext) => {
        consumedBuffer = plaintext;
        throw new Error('simulated renderer interruption');
      },
    ),
    /renderer interruption/,
  );

  assert.equal(consumedBuffer.every((byte) => byte === 0), true);
  assert.equal(frame.every((byte) => byte === 0), true);
  key.fill(0);
  nonce.fill(0);
  aad.fill(0);
});

test('media key wrapping fails closed until the reviewed E2EE adapter is installed', async () => {
  assert.equal(isMediaKeyWrappingReady(), false);
  await assert.rejects(
    wrapMediaFileKey({
      conversationId: 'conversation-test',
      attachmentId: 'attachment-test',
      fileKey: new Uint8Array(32),
    }),
    (error) => error instanceof E2EEUnavailableError && /Media sharing is locked/.test(error.message),
  );
});
