import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  readAuthenticatedVoiceFrames,
  writeEncryptedVoiceFrame,
} from '../storage/secureVoiceNoteFrames.ts';

function aadFor(index, length) {
  return Buffer.from(`hidden-messenger-voice-test-v1|${index}|${length}`);
}

function makeEncryptor(key) {
  return async (plaintext, index) => {
    const nonce = randomBytes(12);
    const aad = aadFor(index, plaintext.length);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const result = new Uint8Array(Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]));
    nonce.fill(0);
    aad.fill(0);
    ciphertext.fill(0);
    return result;
  };
}

function makeDecryptor(key) {
  return async (frame, index, plaintextLength) => {
    const nonce = frame.subarray(0, 12);
    const ciphertext = frame.subarray(12, frame.length - 16);
    const tag = frame.subarray(frame.length - 16);
    const aad = aadFor(index, plaintextLength);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    aad.fill(0);
    return new Uint8Array(plaintext);
  };
}

function createReader(source, maxRead = Number.POSITIVE_INFINITY) {
  let offset = 0;
  const readBuffers = [];
  return {
    readBuffers,
    async readBytes(requested) {
      if (offset >= source.length) return new Uint8Array();
      const end = Math.min(offset + requested, offset + maxRead, source.length);
      const chunk = source.slice(offset, end);
      offset = end;
      readBuffers.push(chunk);
      return chunk;
    },
  };
}

test('voice capture persists only AES-GCM frames and clears microphone PCM', async () => {
  const key = randomBytes(32);
  const plaintext = Uint8Array.from([0x51, 0x4c, 0x50, 0x43, 1, 2, 3, 4]);
  const original = Buffer.from(plaintext);
  const persisted = [];

  await writeEncryptedVoiceFrame(
    plaintext,
    0,
    makeEncryptor(key),
    async (frame) => persisted.push(Uint8Array.from(frame)),
  );

  assert.deepEqual(Array.from(plaintext), new Array(original.length).fill(0));
  assert.equal(Buffer.from(persisted[0]).includes(original), false);
  assert.equal(persisted[0].length, original.length + 4 + 12 + 16);

  const record = persisted[0];
  const clear = await makeDecryptor(key)(
    record.subarray(4),
    0,
    original.length,
  );
  assert.deepEqual(Buffer.from(clear), original);
  clear.fill(0);
  record.fill(0);
  original.fill(0);
  key.fill(0);
});

test('an interrupted ciphertext write wipes the capture buffer and never writes raw PCM', async () => {
  const key = randomBytes(32);
  const plaintext = Uint8Array.from([11, 22, 33, 44, 55, 66]);
  const original = Buffer.from(plaintext);
  let bytesPresentedToWriter;
  let writerFrame;

  await assert.rejects(
    writeEncryptedVoiceFrame(
      plaintext,
      0,
      makeEncryptor(key),
      async (frame) => {
        writerFrame = frame;
        bytesPresentedToWriter = Uint8Array.from(frame);
        throw new Error('simulated interrupted file write');
      },
    ),
    /interrupted file write/,
  );

  assert.deepEqual(Array.from(plaintext), new Array(original.length).fill(0));
  assert.equal(Buffer.from(bytesPresentedToWriter).includes(original), false);
  assert.equal(writerFrame.every((byte) => byte === 0), true);
  original.fill(0);
  key.fill(0);
});

test('voice playback authenticates before rendering and wipes each decrypted chunk immediately', async () => {
  const key = randomBytes(32);
  const clear = Uint8Array.from([1, 0, 2, 0, 3, 0, 4, 0]);
  const expected = Buffer.from(clear);
  const disk = [];
  await writeEncryptedVoiceFrame(clear, 0, makeEncryptor(key), async (frame) => {
    disk.push(Uint8Array.from(frame));
  });
  const reader = createReader(disk[0], 3);
  let renderedBuffer;
  let renderCount = 0;

  const delivered = await readAuthenticatedVoiceFrames(
    reader,
    { chunkCount: 1, totalBytes: expected.length },
    makeDecryptor(key),
    async (pcm) => {
      renderCount += 1;
      renderedBuffer = pcm;
      assert.deepEqual(Buffer.from(pcm), expected);
    },
  );

  assert.equal(delivered, expected.length);
  assert.equal(renderCount, 1);
  assert.equal(renderedBuffer.every((byte) => byte === 0), true);
  assert.equal(reader.readBuffers.every((buffer) => buffer.every((byte) => byte === 0)), true);
  disk[0].fill(0);
  expected.fill(0);
  key.fill(0);
});

test('a corrupted voice-note tag never reaches the renderer and wipes read buffers', async () => {
  const key = randomBytes(32);
  const clear = Uint8Array.from([7, 0, 8, 0, 9, 0]);
  const disk = [];
  await writeEncryptedVoiceFrame(clear, 0, makeEncryptor(key), async (frame) => {
    disk.push(Uint8Array.from(frame));
  });
  disk[0][disk[0].length - 1] ^= 0x80;
  const reader = createReader(disk[0], 5);
  let rendered = false;

  await assert.rejects(
    readAuthenticatedVoiceFrames(
      reader,
      { chunkCount: 1, totalBytes: 6 },
      makeDecryptor(key),
      () => { rendered = true; },
    ),
    /authenticate|Unsupported state|unable to authenticate/i,
  );

  assert.equal(rendered, false);
  assert.equal(reader.readBuffers.every((buffer) => buffer.every((byte) => byte === 0)), true);
  disk[0].fill(0);
  key.fill(0);
});

test('an interrupted frame read and a renderer failure both clear temporary buffers', async () => {
  const key = randomBytes(32);
  const clear = Uint8Array.from([1, 0, 1, 0, 1, 0]);
  const disk = [];
  await writeEncryptedVoiceFrame(clear, 0, makeEncryptor(key), async (frame) => {
    disk.push(Uint8Array.from(frame));
  });
  const interruptedReader = createReader(disk[0].subarray(0, 8), 2);

  await assert.rejects(
    readAuthenticatedVoiceFrames(
      interruptedReader,
      { chunkCount: 1, totalBytes: 6 },
      makeDecryptor(key),
      () => assert.fail('interrupted reads must not render'),
    ),
    /ended early|invalid frame/i,
  );
  assert.equal(interruptedReader.readBuffers.every((buffer) => buffer.every((byte) => byte === 0)), true);

  const renderReader = createReader(disk[0], 4);
  let renderedBuffer;
  await assert.rejects(
    readAuthenticatedVoiceFrames(
      renderReader,
      { chunkCount: 1, totalBytes: 6 },
      makeDecryptor(key),
      (pcm) => {
        renderedBuffer = pcm;
        throw new Error('simulated native renderer interruption');
      },
    ),
    /renderer interruption/,
  );
  assert.equal(renderedBuffer.every((byte) => byte === 0), true);
  assert.equal(renderReader.readBuffers.every((buffer) => buffer.every((byte) => byte === 0)), true);
  disk[0].fill(0);
  key.fill(0);
});

test('voice frame length and metadata inconsistencies fail closed', async () => {
  const reader = createReader(Uint8Array.from([0, 1, 0, 1]));
  await assert.rejects(
    readAuthenticatedVoiceFrames(
      reader,
      { chunkCount: 1, totalBytes: 2 },
      async () => new Uint8Array(),
      () => assert.fail('invalid frame must not render'),
    ),
    /frame length is invalid/,
  );
});
