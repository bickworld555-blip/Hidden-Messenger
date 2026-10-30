import { AESKeySize, AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import {
  deleteLocalVoiceNote,
  getLocalVoiceNote,
  listLocalVoiceNotes,
  openSecureChatDatabase,
  saveLocalVoiceNote,
  type LocalVoiceNoteSummary,
} from '@/storage/secureChatDb';
import { readExactly } from '@/storage/secureMediaBuffers';
import {
  readAuthenticatedVoiceFrames,
  VOICE_FRAME_PREFIX_BYTES,
  VOICE_GCM_OVERHEAD_BYTES,
  writeEncryptedVoiceFrame,
} from '@/storage/secureVoiceNoteFrames';

const VOICE_DIRECTORY_NAME = 'hidden-messenger-voice';
const VOICE_HEADER = Uint8Array.from([0x48, 0x4d, 0x56, 0x4e, 0x01]); // HMVN v1
const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const MAX_VOICE_NOTE_BYTES = 10 * 1024 * 1024;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

type FileHandle = ReturnType<File['open']>;

type SecureVoiceOutputModule = {
  startPlayback(sampleRate: number, speed: number): Promise<void>;
  writePcmChunk(chunk: Uint8Array): Promise<void>;
  setPlaybackSpeed(speed: number): Promise<void>;
  stopPlayback(): Promise<void>;
};

type ExpoAudioModule = {
  AudioStream?: unknown;
};

function getVoiceDirectory() {
  return new Directory(Paths.document, VOICE_DIRECTORY_NAME);
}

function bytesToAscii(value: string) {
  const encoded = encodeURIComponent(value);
  return Uint8Array.from(encoded, (character) => character.charCodeAt(0));
}

function buildVoiceChunkAad(input: {
  conversationId: string;
  voiceNoteId: string;
  sampleRate: number;
  channels: number;
  chunkIndex: number;
  plaintextLength: number;
}) {
  return bytesToAscii(JSON.stringify([
    'HiddenMessenger-VoiceNote-AES-256-GCM-v1',
    input.conversationId,
    input.voiceNoteId,
    String(input.sampleRate),
    String(input.channels),
    'pcm_s16le',
    String(input.chunkIndex),
    String(input.plaintextLength),
  ]));
}

function getNativeOutput() {
  try {
    return requireOptionalNativeModule<SecureVoiceOutputModule>(
      'HiddenMessengerSecureVoiceOutput',
    );
  } catch {
    return null;
  }
}

export function isSecureVoiceNotePathAvailable() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  try {
    const expoAudio = requireOptionalNativeModule<ExpoAudioModule>('ExpoAudio');
    const output = getNativeOutput();
    return (
      typeof expoAudio?.AudioStream === 'function' &&
      !!output &&
      typeof output.startPlayback === 'function' &&
      typeof output.writePcmChunk === 'function' &&
      typeof output.setPlaybackSpeed === 'function' &&
      typeof output.stopPlayback === 'function'
    );
  } catch {
    return false;
  }
}

export type LocalVoiceNoteWriter = {
  id: string;
  appendPcmChunk: (chunk: Uint8Array) => Promise<void>;
  finish: () => Promise<LocalVoiceNoteSummary>;
  abort: () => Promise<void>;
};

/**
 * Creates a ciphertext-only app-owned file. The caller passes each in-memory
 * microphone chunk to appendPcmChunk; this writer encrypts before writing.
 */
export async function beginLocalVoiceNote(
  conversationId: string,
): Promise<LocalVoiceNoteWriter> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error('Encrypted voice notes require a native iOS or Android build.');
  }
  if (!isSecureVoiceNotePathAvailable()) {
    throw new Error('The native encrypted voice capture and playback path is unavailable.');
  }
  if (!conversationId.trim()) throw new Error('A conversation is required for local voice notes.');
  await openSecureChatDatabase();

  const Crypto = await import('expo-crypto');
  const id = Crypto.randomUUID();
  let key: AESEncryptionKey | null = await AESEncryptionKey.generate(AESKeySize.AES256);
  let fileKeyHex = '';
  let outputFile: File | null = null;
  let outputHandle: FileHandle | null = null;
  let createdFile = false;
  let state: 'open' | 'finished' | 'aborted' = 'open';
  let acceptingChunks = true;
  let totalBytes = 0;
  let chunkCount = 0;
  let failure: unknown = null;
  let appendQueue: Promise<void> = Promise.resolve();

  try {
    const directory = getVoiceDirectory();
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    outputFile = new File(directory, `${id}.hmvn`);
    outputFile.create({ intermediates: true, overwrite: false });
    createdFile = true;
    outputHandle = outputFile.open(FileMode.WriteOnly);
    await outputHandle.writeBytes(VOICE_HEADER);
  } catch {
    try { outputHandle?.close(); } catch { /* already closed */ }
    if (createdFile && outputFile?.exists) {
      try { outputFile.delete(); } catch { /* no sensitive content was written */ }
    }
    key = null;
    throw new Error('Could not initialize encrypted voice-note storage.');
  }

  const cleanupCiphertext = async () => {
    try { outputHandle?.close(); } catch { /* already closed */ }
    outputHandle = null;
    if (outputFile?.exists) {
      try {
        outputFile.delete();
      } catch {
        // Any remaining file contains ciphertext only; its key is not persisted.
      }
    }
    key = null;
    fileKeyHex = '';
  };

  return {
    id,
    appendPcmChunk(chunk) {
      if (!acceptingChunks) {
        chunk.fill(0);
        return Promise.reject(new Error('Voice capture is no longer accepting audio.'));
      }

      const operation = appendQueue.then(async () => {
        if (state !== 'open' || failure) {
          chunk.fill(0);
          throw new Error('Voice capture has already failed.');
        }
        if (totalBytes + chunk.length > MAX_VOICE_NOTE_BYTES) {
          chunk.fill(0);
          throw new Error('Voice note reached the local recording limit.');
        }
        const activeKey = key;
        const activeHandle = outputHandle;
        if (!activeKey || !activeHandle) {
          chunk.fill(0);
          throw new Error('Encrypted voice-note storage is unavailable.');
        }

        await writeEncryptedVoiceFrame(
          chunk,
          chunkCount,
          async (plaintext, index) => {
            const aad = buildVoiceChunkAad({
              conversationId,
              voiceNoteId: id,
              sampleRate: SAMPLE_RATE,
              channels: CHANNELS,
              chunkIndex: index,
              plaintextLength: plaintext.length,
            });
            try {
              const sealed = await aesEncryptAsync(plaintext, activeKey, {
                nonce: { length: NONCE_LENGTH },
                tagLength: TAG_LENGTH,
                additionalData: aad,
              });
              return await sealed.combined();
            } finally {
              aad.fill(0);
            }
          },
          async (frame) => {
            await activeHandle.writeBytes(frame);
          },
        );
        totalBytes += chunk.length;
        chunkCount += 1;
      });

      appendQueue = operation.catch((error: unknown) => {
        failure ??= error;
        chunk.fill(0);
      });
      return operation;
    },
    async finish() {
      if (state !== 'open') throw new Error('Voice capture is already closed.');
      acceptingChunks = false;
      await appendQueue;
      if (failure) {
        await cleanupCiphertext();
        state = 'aborted';
        throw new Error('Voice capture was interrupted; the incomplete encrypted note was discarded.');
      }
      if (chunkCount === 0 || totalBytes <= 0) {
        await cleanupCiphertext();
        state = 'aborted';
        throw new Error('No audio was captured.');
      }

      const activeKey = key;
      const activeHandle = outputHandle;
      if (!activeKey || !activeHandle) {
        await cleanupCiphertext();
        state = 'aborted';
        throw new Error('Encrypted voice-note storage is unavailable.');
      }

      try {
        activeHandle.close();
        outputHandle = null;
        fileKeyHex = await activeKey.encoded('hex');
        await saveLocalVoiceNote({
          id,
          conversationId,
          sampleRate: SAMPLE_RATE,
          channels: CHANNELS,
          totalBytes,
          chunkCount,
          fileKeyHex,
        });
        state = 'finished';
        key = null;
        fileKeyHex = '';
        return {
          id,
          conversation_id: conversationId,
          sample_rate: SAMPLE_RATE,
          channels: CHANNELS,
          total_bytes: totalBytes,
          chunk_count: chunkCount,
          created_at: Date.now(),
        };
      } catch {
        await cleanupCiphertext();
        state = 'aborted';
        throw new Error('Could not save the encrypted voice-note record.');
      }
    },
    async abort() {
      if (state !== 'open') return;
      acceptingChunks = false;
      state = 'aborted';
      await appendQueue;
      await cleanupCiphertext();
    },
  };
}

export async function listLocalVoiceNoteSummaries(conversationId: string) {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return [];
  await openSecureChatDatabase();
  return listLocalVoiceNotes(conversationId);
}

export async function deleteLocalVoiceNoteAndCiphertext(id: string) {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error('Encrypted voice notes require a native iOS or Android build.');
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid local voice-note identifier.');
  await openSecureChatDatabase();
  const existing = await getLocalVoiceNote(id);
  if (!existing) return;
  await deleteLocalVoiceNote(id);
  const encryptedFile = new File(getVoiceDirectory(), `${id}.hmvn`);
  if (encryptedFile.exists) {
    try {
      encryptedFile.delete();
    } catch {
      // A residual file is ciphertext only and its SQLCipher-protected key is gone.
    }
  }
}

export async function setLocalVoicePlaybackSpeed(speed: number) {
  if (![1, 1.5, 2].includes(speed)) throw new Error('Unsupported voice playback speed.');
  const output = getNativeOutput();
  if (!output) throw new Error('Secure voice playback is unavailable in this build.');
  await output.setPlaybackSpeed(speed);
}

export async function stopLocalVoicePlayback() {
  const output = getNativeOutput();
  if (output) await output.stopPlayback();
}

/**
 * Authenticates and renders one bounded PCM chunk at a time. Native output
 * resolves each write only after its in-memory audio buffer has been consumed.
 */
export async function playLocalVoiceNote(
  id: string,
  options: { signal?: AbortSignal; speed?: number } = {},
) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid local voice-note identifier.');
  if (!isSecureVoiceNotePathAvailable()) {
    throw new Error('Secure voice playback is unavailable in this build.');
  }
  const output = getNativeOutput();
  if (!output) throw new Error('Secure voice playback is unavailable in this build.');

  const metadata = await getLocalVoiceNote(id);
  if (!metadata) throw new Error('The local voice note is unavailable.');
  if (
    metadata.sample_rate !== SAMPLE_RATE ||
    metadata.channels !== CHANNELS ||
    metadata.total_bytes <= 0 ||
    metadata.total_bytes > MAX_VOICE_NOTE_BYTES ||
    metadata.chunk_count <= 0 ||
    metadata.chunk_count > 3_200 ||
    metadata.total_bytes % 2 !== 0
  ) {
    throw new Error('The local voice-note metadata is invalid.');
  }

  let inputHandle: FileHandle | null = null;
  let key: AESEncryptionKey | null = null;
  let fileKeyHex = metadata.file_key_hex;
  metadata.file_key_hex = '';
  try {
    key = await AESEncryptionKey.import(fileKeyHex, 'hex');
    fileKeyHex = '';
    const encryptedFile = new File(getVoiceDirectory(), `${metadata.id}.hmvn`);
    if (!encryptedFile.exists) throw new Error('Encrypted voice-note file is missing.');
    inputHandle = encryptedFile.open(FileMode.ReadOnly);
    const fileSize = inputHandle.size;
    const expectedSize =
      VOICE_HEADER.length +
      metadata.total_bytes +
      metadata.chunk_count * (VOICE_FRAME_PREFIX_BYTES + VOICE_GCM_OVERHEAD_BYTES);
    if (fileSize !== expectedSize) throw new Error('Encrypted voice-note file is incomplete.');

    const header = await readExactly(inputHandle, VOICE_HEADER.length, options.signal);
    try {
      if (!VOICE_HEADER.every((byte, index) => header[index] === byte)) {
        throw new Error('Unrecognized encrypted voice-note container.');
      }
    } finally {
      header.fill(0);
    }

    await output.startPlayback(metadata.sample_rate, options.speed ?? 1);
    await readAuthenticatedVoiceFrames(
      inputHandle,
      { chunkCount: metadata.chunk_count, totalBytes: metadata.total_bytes },
      async (encryptedFrame, chunkIndex, plaintextLength) => {
        const activeKey = key;
        if (!activeKey) throw new Error('Voice-note key is unavailable.');
        const sealed = AESSealedData.fromCombined(encryptedFrame, {
          ivLength: NONCE_LENGTH,
          tagLength: TAG_LENGTH,
        });
        const aad = buildVoiceChunkAad({
          conversationId: metadata.conversation_id,
          voiceNoteId: metadata.id,
          sampleRate: metadata.sample_rate,
          channels: metadata.channels,
          chunkIndex,
          plaintextLength,
        });
        try {
          const decrypted = await aesDecryptAsync(sealed, activeKey, {
            output: 'bytes',
            additionalData: aad,
          });
          if (typeof decrypted === 'string') {
            throw new Error('The AES-GCM provider did not return PCM bytes.');
          }
          return decrypted;
        } finally {
          aad.fill(0);
        }
      },
      async (plaintext) => {
        if (options.signal?.aborted) {
          throw new Error('Voice playback was interrupted.');
        }
        await output.writePcmChunk(plaintext);
      },
      options.signal,
    );
    if (inputHandle.offset !== fileSize) {
      throw new Error('Encrypted voice-note stream has trailing data.');
    }
  } catch {
    throw new Error('The voice note is incomplete, interrupted, or failed AES-GCM authentication.');
  } finally {
    try { inputHandle?.close(); } catch { /* already closed */ }
    key = null;
    fileKeyHex = '';
    try { await output.stopPlayback(); } catch { /* native output may already be stopped */ }
  }
}

export type { LocalVoiceNoteSummary };
