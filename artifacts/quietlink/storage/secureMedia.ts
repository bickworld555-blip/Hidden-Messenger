import { Platform } from 'react-native';
import { AESKeySize, AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import {
  getLocalMediaAttachment,
  openSecureChatDatabase,
  saveLocalMediaAttachment,
} from '@/storage/secureChatDb';

const MEDIA_DIRECTORY_NAME = 'quietlink-secure-media';
const CONTAINER_MAGIC = [0x51, 0x4c, 0x4d, 0x31] as const; // QLM1
const CONTAINER_VERSION = 1;
const HEADER_LENGTH = 17;
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const SEALED_OVERHEAD = GCM_IV_LENGTH + GCM_TAG_LENGTH;
const CHUNK_SIZE = 64 * 1024;
const MAX_MEDIA_BYTES = 512 * 1024 * 1024;
const MEDIA_PICKER_TYPES = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
} as const;

export type LocalMediaKind = keyof typeof MEDIA_PICKER_TYPES;
export type LocalMediaSaved = {
  id: string;
  mimeType: string;
  plaintextBytes: number;
};
export type DecryptedMediaChunkConsumer = (chunk: Uint8Array, index: number) => void | Promise<void>;

type FileHandle = ReturnType<File['open']>;

function assertNativeMediaStorage() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error('Encrypted media storage requires a native iOS or Android build with SQLCipher.');
  }
}

function asciiBytes(value: string) {
  if (Array.from(value).some((character) => character.charCodeAt(0) > 0x7f)) {
    throw new Error('Invalid authenticated media context.');
  }
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function buildChunkAad(input: {
  conversationId: string;
  attachmentId: string;
  mimeType: string;
  totalBytes: number;
  chunkCount: number;
  index: number;
}) {
  const canonicalContext = JSON.stringify([
    'QuietLink-Media-AES-256-GCM-v1',
    input.conversationId,
    input.attachmentId,
    input.mimeType,
    String(CHUNK_SIZE),
    String(input.totalBytes),
    String(input.chunkCount),
    String(input.index),
  ]);
  return asciiBytes(encodeURIComponent(canonicalContext));
}

function makeHeader(totalBytes: number, chunkCount: number) {
  const header = new Uint8Array(HEADER_LENGTH);
  header.set(CONTAINER_MAGIC, 0);
  header[4] = CONTAINER_VERSION;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  view.setUint32(5, CHUNK_SIZE, false);
  view.setUint32(9, totalBytes, false);
  view.setUint32(13, chunkCount, false);
  return header;
}

function parseHeader(header: Uint8Array) {
  if (header.length !== HEADER_LENGTH || !CONTAINER_MAGIC.every((byte, index) => header[index] === byte)) {
    throw new Error('Unrecognized encrypted media container.');
  }
  if (header[4] !== CONTAINER_VERSION) {
    throw new Error('Unsupported encrypted media container version.');
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  return {
    chunkSize: view.getUint32(5, false),
    totalBytes: view.getUint32(9, false),
    chunkCount: view.getUint32(13, false),
  };
}

async function readExactly(handle: FileHandle, length: number) {
  const output = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    const part = await handle.readBytes(length - offset);
    if (part.length === 0) {
      output.fill(0);
      throw new Error('The selected media file ended before the expected number of bytes.');
    }
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function getMediaDirectory() {
  return new Directory(Paths.document, MEDIA_DIRECTORY_NAME);
}

/**
 * Picks an image, video, or audio source without asking the picker to copy it
 * into app cache. The app writes only authenticated ciphertext to its sandbox.
 */
export async function pickAndEncryptLocalMedia(
  conversationId: string,
  kind: LocalMediaKind,
): Promise<LocalMediaSaved | null> {
  assertNativeMediaStorage();
  await openSecureChatDatabase();

  const result = await DocumentPicker.getDocumentAsync({
    type: MEDIA_PICKER_TYPES[kind],
    copyToCacheDirectory: false,
    multiple: false,
    base64: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset?.uri) throw new Error('The system picker did not provide a readable media file.');

  const mimeType = (asset.mimeType ?? '').toLowerCase();
  if (
    !mimeType.startsWith(`${kind}/`) ||
    !/^(image|video|audio)\/[a-z0-9.+-]+$/.test(mimeType)
  ) {
    throw new Error('The selected file does not have a supported image, video, or audio type.');
  }

  const id = (await import('expo-crypto')).randomUUID();
  const sourceFile = new File(asset.uri);
  let sourceHandle: FileHandle | null = null;
  let outputHandle: FileHandle | null = null;
  let outputFile: File | null = null;
  let fileKey: AESEncryptionKey | null = null;
  let fileKeyHex = '';

  try {
    sourceHandle = sourceFile.open(FileMode.ReadOnly);
    const totalBytes = sourceHandle.size;
    if (
      totalBytes === null ||
      !Number.isSafeInteger(totalBytes) ||
      totalBytes <= 0 ||
      totalBytes > MAX_MEDIA_BYTES
    ) {
      throw new Error('The selected file is empty, unreadable, or larger than the 512 MB local limit.');
    }
    const chunkCount = Math.ceil(totalBytes / CHUNK_SIZE);
    fileKey = await AESEncryptionKey.generate(AESKeySize.AES256);

    const directory = getMediaDirectory();
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    outputFile = new File(directory, `${id}.qlm`);
    outputFile.create({ intermediates: true, overwrite: false });
    outputHandle = outputFile.open(FileMode.WriteOnly);
    await outputHandle.writeBytes(makeHeader(totalBytes, chunkCount));

    for (let index = 0; index < chunkCount; index += 1) {
      const plaintextLength = Math.min(CHUNK_SIZE, totalBytes - index * CHUNK_SIZE);
      const plaintext = await readExactly(sourceHandle, plaintextLength);
      try {
        const sealed = await aesEncryptAsync(plaintext, fileKey, {
          nonce: { length: GCM_IV_LENGTH },
          tagLength: GCM_TAG_LENGTH,
          additionalData: buildChunkAad({
            conversationId,
            attachmentId: id,
            mimeType,
            totalBytes,
            chunkCount,
            index,
          }),
        });
        const ciphertext = await sealed.combined();
        if (ciphertext.length !== plaintextLength + SEALED_OVERHEAD) {
          throw new Error('The native AES-GCM provider returned an unexpected frame size.');
        }
        await outputHandle.writeBytes(ciphertext);
        ciphertext.fill(0);
      } finally {
        plaintext.fill(0);
      }
    }

    if (sourceHandle.offset !== totalBytes) {
      throw new Error('The source media changed while it was being encrypted.');
    }
    outputHandle.close();
    outputHandle = null;
    sourceHandle.close();
    sourceHandle = null;

    fileKeyHex = await fileKey.encoded('hex');
    await saveLocalMediaAttachment({
      id,
      conversationId,
      mimeType,
      plaintextBytes: totalBytes,
      chunkSize: CHUNK_SIZE,
      chunkCount,
      fileKeyHex,
    });

    return { id, mimeType, plaintextBytes: totalBytes };
  } catch {
    try { outputHandle?.close(); } catch { /* already closed */ }
    outputHandle = null;
    try { sourceHandle?.close(); } catch { /* already closed */ }
    sourceHandle = null;
    if (outputFile?.exists) {
      try {
        outputFile.delete();
      } catch {
        // The file contains ciphertext only; a failed cleanup cannot expose plaintext.
      }
    }
    throw new Error('Could not encrypt and save this file locally. No plaintext cache fallback was used.');
  } finally {
    try { sourceHandle?.close(); } catch { /* already closed */ }
    try { outputHandle?.close(); } catch { /* already closed */ }
    fileKey = null;
    fileKeyHex = '';
  }
}

/**
 * Delivers only individually authenticated 64 KiB plaintext chunks to the
 * caller. The consumer must not retain the supplied view; it is zeroed after
 * the callback settles. This API never creates a plaintext file or thumbnail.
 */
export async function streamDecryptedLocalMedia(
  attachmentId: string,
  consumeChunk: DecryptedMediaChunkConsumer,
) {
  assertNativeMediaStorage();
  const metadata = await getLocalMediaAttachment(attachmentId);
  if (!metadata) throw new Error('The encrypted media record is unavailable.');

  let inputHandle: FileHandle | null = null;
  let key: AESEncryptionKey | null = null;
  try {
    key = await AESEncryptionKey.import(metadata.file_key_hex, 'hex');
    const encryptedFile = new File(getMediaDirectory(), `${metadata.id}.qlm`);
    if (!encryptedFile.exists) throw new Error('Encrypted media file is missing.');
    inputHandle = encryptedFile.open(FileMode.ReadOnly);
    const fileSize = inputHandle.size;
    if (fileSize === null || fileSize < HEADER_LENGTH) throw new Error('Encrypted media file is truncated.');

    const header = await readExactly(inputHandle, HEADER_LENGTH);
    const parsed = parseHeader(header);
    header.fill(0);
    if (
      parsed.chunkSize !== metadata.chunk_size ||
      parsed.totalBytes !== metadata.plaintext_bytes ||
      parsed.chunkCount !== metadata.chunk_count ||
      parsed.chunkSize !== CHUNK_SIZE ||
      parsed.totalBytes <= 0 ||
      parsed.totalBytes > MAX_MEDIA_BYTES ||
      parsed.chunkCount <= 0 ||
      parsed.chunkCount > Math.ceil(MAX_MEDIA_BYTES / CHUNK_SIZE) ||
      parsed.chunkCount !== Math.ceil(parsed.totalBytes / parsed.chunkSize)
    ) {
      throw new Error('Encrypted media header does not match the protected database record.');
    }
    const expectedContainerBytes = HEADER_LENGTH + parsed.totalBytes + parsed.chunkCount * SEALED_OVERHEAD;
    if (fileSize !== expectedContainerBytes) {
      throw new Error('Encrypted media file is truncated or has unexpected trailing data.');
    }

    let deliveredBytes = 0;
    for (let index = 0; index < parsed.chunkCount; index += 1) {
      const plaintextLength = Math.min(parsed.chunkSize, parsed.totalBytes - deliveredBytes);
      const combined = await readExactly(inputHandle, plaintextLength + SEALED_OVERHEAD);
      let plaintext: Uint8Array | null = null;
      try {
        const sealed = AESSealedData.fromCombined(combined, {
          ivLength: GCM_IV_LENGTH,
          tagLength: GCM_TAG_LENGTH,
        });
        const decrypted = await aesDecryptAsync(sealed, key, {
          output: 'bytes',
          additionalData: buildChunkAad({
            conversationId: metadata.conversation_id,
            attachmentId: metadata.id,
            mimeType: metadata.mime_type,
            totalBytes: parsed.totalBytes,
            chunkCount: parsed.chunkCount,
            index,
          }),
        });
        if (typeof decrypted === 'string' || decrypted.length !== plaintextLength) {
          throw new Error('Decrypted media chunk has an invalid length.');
        }
        plaintext = decrypted;
        await consumeChunk(plaintext, index);
        deliveredBytes += plaintext.length;
      } finally {
        combined.fill(0);
        plaintext?.fill(0);
      }
    }

    if (deliveredBytes !== parsed.totalBytes || inputHandle.offset !== fileSize) {
      throw new Error('Encrypted media stream has trailing or missing data.');
    }
  } catch {
    throw new Error('The local media stream is incomplete or failed AES-GCM authentication.');
  } finally {
    try { inputHandle?.close(); } catch { /* already closed */ }
    key = null;
  }
}
