export type EncryptedTextEnvelope = Readonly<{
  version: 1;
  protocol: string;
  conversationId: string;
  messageId: string;
  ciphertext: string;
}>;

export type WrappedMediaFileKeyEnvelope = Readonly<{
  version: 1;
  protocol: string;
  conversationId: string;
  attachmentId: string;
  ciphertext: string;
}>;

/**
 * Boundary for a reviewed messaging protocol implementation.
 * Implementations must own identity/session state and authenticate ciphertext;
 * do not replace this with raw ECDH + AES composition.
 */
export interface E2EEProtocolAdapter {
  readonly protocolId: string;
  encryptText(input: {
    conversationId: string;
    messageId: string;
    plaintext: string;
  }): Promise<EncryptedTextEnvelope>;
  decryptText(envelope: EncryptedTextEnvelope): Promise<string>;
}

/**
 * Media-key wrapping must be implemented by the same selected E2EE protocol.
 * Local AES-GCM storage keys are never sent directly to a peer or server.
 */
export interface E2EEMediaKeyWrapper {
  readonly protocolId: string;
  wrapMediaFileKey(input: {
    conversationId: string;
    attachmentId: string;
    fileKey: Uint8Array;
  }): Promise<WrappedMediaFileKeyEnvelope>;
  unwrapMediaFileKey(envelope: WrappedMediaFileKeyEnvelope): Promise<Uint8Array>;
}

/** The transport accepts encrypted envelopes only, never plaintext strings. */
export interface EncryptedRealtimeTransport {
  send(envelope: EncryptedTextEnvelope): Promise<void>;
}

export class E2EEUnavailableError extends Error {
  constructor(feature: 'message' | 'media' = 'message') {
    super(
      feature === 'media'
        ? 'Media sharing is locked until a reviewed E2EE protocol, matching media-key wrapper, and encrypted media transport are configured.'
        : 'Message sending is locked until a reviewed E2EE protocol and encrypted transport are configured.',
    );
    this.name = 'E2EEUnavailableError';
  }
}

let protocolAdapter: E2EEProtocolAdapter | null = null;
let realtimeTransport: EncryptedRealtimeTransport | null = null;
let mediaKeyWrapper: E2EEMediaKeyWrapper | null = null;

export function installSecureMessaging(
  adapter: E2EEProtocolAdapter,
  transport: EncryptedRealtimeTransport,
) {
  if (!adapter.protocolId.trim()) throw new Error('An E2EE protocol identifier is required.');
  if (mediaKeyWrapper && mediaKeyWrapper.protocolId !== adapter.protocolId) {
    throw new Error('The media key wrapper must use the same E2EE protocol as messaging.');
  }
  protocolAdapter = adapter;
  realtimeTransport = transport;
}

export function installMediaKeyWrapper(wrapper: E2EEMediaKeyWrapper) {
  if (!wrapper.protocolId.trim()) throw new Error('A media key wrapper protocol identifier is required.');
  if (protocolAdapter && wrapper.protocolId !== protocolAdapter.protocolId) {
    throw new Error('The media key wrapper must use the same E2EE protocol as messaging.');
  }
  mediaKeyWrapper = wrapper;
}

export function isSecureMessagingReady() {
  return protocolAdapter !== null && realtimeTransport !== null;
}

export function isMediaKeyWrappingReady() {
  return Boolean(
    protocolAdapter &&
    mediaKeyWrapper &&
    protocolAdapter.protocolId === mediaKeyWrapper.protocolId,
  );
}

export async function wrapMediaFileKey(input: {
  conversationId: string;
  attachmentId: string;
  fileKey: Uint8Array;
}) {
  const adapter = mediaKeyWrapper;
  if (!adapter || !isMediaKeyWrappingReady()) throw new E2EEUnavailableError('media');
  if (input.fileKey.length !== 32) throw new Error('Media file keys must be 256 bits.');
  const envelope = await adapter.wrapMediaFileKey(input);
  if (
    envelope.version !== 1 ||
    envelope.protocol !== adapter.protocolId ||
    envelope.conversationId !== input.conversationId ||
    envelope.attachmentId !== input.attachmentId ||
    typeof envelope.ciphertext !== 'string' ||
    envelope.ciphertext.length === 0
  ) {
    throw new Error('The E2EE adapter returned an invalid wrapped media-key envelope.');
  }
  return envelope;
}

export async function unwrapMediaFileKey(envelope: WrappedMediaFileKeyEnvelope) {
  const adapter = mediaKeyWrapper;
  if (!adapter || !isMediaKeyWrappingReady()) throw new E2EEUnavailableError('media');
  if (
    envelope.version !== 1 ||
    envelope.protocol !== adapter.protocolId ||
    !envelope.conversationId ||
    !envelope.attachmentId ||
    !envelope.ciphertext
  ) {
    throw new Error('The wrapped media-key envelope is invalid or uses an unsupported protocol.');
  }
  const key = await adapter.unwrapMediaFileKey(envelope);
  if (key.length !== 32) {
    key.fill(0);
    throw new Error('The E2EE adapter returned a media key with an invalid size.');
  }
  return key;
}

export async function sendEncryptedText(input: {
  conversationId: string;
  messageId: string;
  plaintext: string;
}) {
  const adapter = protocolAdapter;
  const transport = realtimeTransport;
  if (!adapter || !transport) throw new E2EEUnavailableError();

  const envelope = await adapter.encryptText(input);
  if (
    envelope.version !== 1 ||
    envelope.protocol !== adapter.protocolId ||
    envelope.conversationId !== input.conversationId ||
    envelope.messageId !== input.messageId ||
    typeof envelope.ciphertext !== 'string' ||
    envelope.ciphertext.length === 0
  ) {
    throw new Error('The E2EE adapter returned an invalid ciphertext envelope.');
  }

  await transport.send(envelope);
  return envelope;
}

export async function decryptEncryptedText(envelope: EncryptedTextEnvelope) {
  const adapter = protocolAdapter;
  if (!adapter) throw new E2EEUnavailableError();
  if (envelope.version !== 1 || envelope.protocol !== adapter.protocolId || !envelope.ciphertext) {
    throw new Error('The received encrypted envelope is invalid or uses an unsupported protocol.');
  }
  return adapter.decryptText(envelope);
}
