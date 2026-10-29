export type EncryptedTextEnvelope = Readonly<{
  version: 1;
  protocol: string;
  conversationId: string;
  messageId: string;
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

/** The transport accepts encrypted envelopes only, never plaintext strings. */
export interface EncryptedRealtimeTransport {
  send(envelope: EncryptedTextEnvelope): Promise<void>;
}

export class E2EEUnavailableError extends Error {
  constructor() {
    super('Message sending is locked until a reviewed E2EE protocol and encrypted transport are configured.');
    this.name = 'E2EEUnavailableError';
  }
}

let protocolAdapter: E2EEProtocolAdapter | null = null;
let realtimeTransport: EncryptedRealtimeTransport | null = null;

export function installSecureMessaging(
  adapter: E2EEProtocolAdapter,
  transport: EncryptedRealtimeTransport,
) {
  if (!adapter.protocolId.trim()) throw new Error('An E2EE protocol identifier is required.');
  protocolAdapter = adapter;
  realtimeTransport = transport;
}

export function isSecureMessagingReady() {
  return protocolAdapter !== null && realtimeTransport !== null;
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
