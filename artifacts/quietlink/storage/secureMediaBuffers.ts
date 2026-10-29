export interface AsyncByteReader {
  readBytes(length: number): Promise<Uint8Array>;
}

export type AuthenticatedMediaDecryptor = (
  encryptedFrame: Uint8Array,
) => Promise<Uint8Array>;

export type DecryptedMediaConsumer<T> = (
  plaintext: Uint8Array,
) => T | Promise<T>;

const MAX_EXACT_READ_BYTES = 64 * 1024 + 28;

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error('Encrypted media reading was interrupted.');
  error.name = 'AbortError';
  throw error;
}

/**
 * Reads exactly the requested bounded frame. Partial input buffers are cleared
 * after copying, and the assembled plaintext buffer is cleared on any failure.
 */
export async function readExactly(
  reader: AsyncByteReader,
  length: number,
  signal?: AbortSignal,
) {
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_EXACT_READ_BYTES) {
    throw new Error('Requested media read exceeds the bounded frame limit.');
  }

  const output = new Uint8Array(length);
  let offset = 0;
  try {
    while (offset < length) {
      throwIfAborted(signal);
      let part: Uint8Array | null = null;
      try {
        part = await reader.readBytes(Math.min(length - offset, MAX_EXACT_READ_BYTES));
        throwIfAborted(signal);
        if (part.length === 0 || part.length > length - offset) {
          throw new Error('Media read ended early or returned an invalid frame length.');
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
 * Holds a decrypted chunk only for the duration of its consumer callback.
 * Ciphertext and plaintext buffers are cleared on success, interruption,
 * authentication failure, or consumer error.
 */
export async function withAuthenticatedMediaChunk<T>(
  encryptedFrame: Uint8Array,
  decrypt: AuthenticatedMediaDecryptor,
  consume: DecryptedMediaConsumer<T>,
  signal?: AbortSignal,
): Promise<T> {
  let plaintext: Uint8Array | null = null;
  try {
    throwIfAborted(signal);
    plaintext = await decrypt(encryptedFrame);
    if (!(plaintext instanceof Uint8Array)) {
      throw new Error('The AES-GCM provider did not return a byte buffer.');
    }
    throwIfAborted(signal);
    return await consume(plaintext);
  } finally {
    encryptedFrame.fill(0);
    plaintext?.fill(0);
  }
}
