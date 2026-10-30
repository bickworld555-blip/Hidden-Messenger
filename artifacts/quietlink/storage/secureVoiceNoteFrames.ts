export const MAX_VOICE_PCM_CHUNK_BYTES = 64 * 1024;
export const VOICE_GCM_OVERHEAD_BYTES = 12 + 16;
export const VOICE_FRAME_PREFIX_BYTES = 4;
const MAX_EXACT_READ_BYTES = MAX_VOICE_PCM_CHUNK_BYTES + VOICE_GCM_OVERHEAD_BYTES;

export type VoiceFrameReader = {
  readBytes(length: number): Promise<Uint8Array>;
};

export type VoiceFrameDecryptor = (
  encryptedFrame: Uint8Array,
  index: number,
  plaintextLength: number,
) => Promise<Uint8Array>;

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error('Encrypted voice-note reading was interrupted.');
  error.name = 'AbortError';
  throw error;
}

async function readVoiceBytesExactly(
  reader: VoiceFrameReader,
  length: number,
  signal?: AbortSignal,
) {
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_EXACT_READ_BYTES) {
    throw new Error('Requested voice-note frame exceeds the bounded read limit.');
  }
  const output = new Uint8Array(length);
  let offset = 0;
  try {
    while (offset < length) {
      throwIfAborted(signal);
      let part: Uint8Array | null = null;
      try {
        part = await reader.readBytes(length - offset);
        throwIfAborted(signal);
        if (part.length === 0 || part.length > length - offset) {
          throw new Error('Voice-note read ended early or returned an invalid frame length.');
        }
        output.set(part, offset);
        offset += part.length;
      } finally {
        part?.fill(0);
      }
    }
    throwIfAborted(signal);
    return output;
  } catch (error) {
    output.fill(0);
    throw error;
  }
}

/**
 * Encrypts a bounded PCM chunk before passing a length-prefixed ciphertext
 * frame to the file writer. The caller transfers ownership of plaintext.
 */
export async function writeEncryptedVoiceFrame(
  plaintext: Uint8Array,
  index: number,
  encrypt: (chunk: Uint8Array, index: number) => Promise<Uint8Array>,
  write: (frame: Uint8Array) => Promise<void>,
) {
  let sealed: Uint8Array | null = null;
  let frame: Uint8Array | null = null;
  try {
    if (
      plaintext.length === 0 ||
      plaintext.length > MAX_VOICE_PCM_CHUNK_BYTES ||
      plaintext.length % 2 !== 0 ||
      !Number.isSafeInteger(index) ||
      index < 0
    ) {
      throw new Error('Voice audio chunk has an invalid size or index.');
    }

    sealed = await encrypt(plaintext, index);
    if (sealed.length !== plaintext.length + VOICE_GCM_OVERHEAD_BYTES) {
      throw new Error('Native AES-GCM returned an invalid voice frame length.');
    }

    frame = new Uint8Array(VOICE_FRAME_PREFIX_BYTES + sealed.length);
    new DataView(frame.buffer, frame.byteOffset, frame.byteLength).setUint32(
      0,
      plaintext.length,
      false,
    );
    frame.set(sealed, VOICE_FRAME_PREFIX_BYTES);
    await write(frame);
    return plaintext.length;
  } finally {
    plaintext.fill(0);
    sealed?.fill(0);
    frame?.fill(0);
  }
}

/**
 * Reads and authenticates one PCM frame at a time. Plaintext exists only for
 * the duration of the consumer and is wiped after the callback settles.
 */
export async function readAuthenticatedVoiceFrames(
  reader: VoiceFrameReader,
  input: {
    chunkCount: number;
    totalBytes: number;
  },
  decrypt: VoiceFrameDecryptor,
  consume: (plaintext: Uint8Array, index: number) => void | Promise<void>,
  signal?: AbortSignal,
) {
  if (
    !Number.isSafeInteger(input.chunkCount) ||
    input.chunkCount <= 0 ||
    !Number.isSafeInteger(input.totalBytes) ||
    input.totalBytes <= 0
  ) {
    throw new Error('Voice note metadata is invalid.');
  }

  let deliveredBytes = 0;
  for (let index = 0; index < input.chunkCount; index += 1) {
    const prefix = await readVoiceBytesExactly(reader, VOICE_FRAME_PREFIX_BYTES, signal);
    let plaintextLength: number;
    try {
      plaintextLength = new DataView(
        prefix.buffer,
        prefix.byteOffset,
        prefix.byteLength,
      ).getUint32(0, false);
    } finally {
      prefix.fill(0);
    }

    if (
      plaintextLength === 0 ||
      plaintextLength > MAX_VOICE_PCM_CHUNK_BYTES ||
      plaintextLength % 2 !== 0 ||
      deliveredBytes + plaintextLength > input.totalBytes
    ) {
      throw new Error('Voice note frame length is invalid.');
    }

    const encryptedFrame = await readVoiceBytesExactly(
      reader,
      plaintextLength + VOICE_GCM_OVERHEAD_BYTES,
      signal,
    );
    let plaintext: Uint8Array | null = null;
    try {
      throwIfAborted(signal);
      plaintext = await decrypt(encryptedFrame, index, plaintextLength);
      if (!(plaintext instanceof Uint8Array)) {
        throw new Error('Voice-note decryptor did not return PCM bytes.');
      }
      throwIfAborted(signal);
      if (plaintext.length !== plaintextLength) {
        throw new Error('Decrypted voice frame has an invalid length.');
      }
      await consume(plaintext, index);
      deliveredBytes += plaintext.length;
    } finally {
      encryptedFrame.fill(0);
      plaintext?.fill(0);
    }
  }

  if (deliveredBytes !== input.totalBytes) {
    throw new Error('Voice note is truncated or has inconsistent metadata.');
  }
  return deliveredBytes;
}
