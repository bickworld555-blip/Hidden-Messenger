import { Platform } from 'react-native';

export type SodiumBoxKeyPair = Readonly<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}>;

export type SodiumBoxPacket = Readonly<{
  version: 1;
  algorithm: 'crypto_box_easy';
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}>;

export type SodiumAeadPacket = Readonly<{
  version: 1;
  algorithm: 'xchacha20-poly1305-ietf';
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}>;

async function loadNativeSodium() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error('QuietLink cryptographic primitives require a native iOS or Android build.');
  }
  return import('react-native-libsodium');
}

/**
 * Generates a libsodium X25519 key pair for low-level public-key operations.
 * This alone is not a messaging protocol: it does not provide identity
 * verification, a ratchet, replay protection, or session lifecycle.
 */
export async function generateBoxKeyPair(): Promise<SodiumBoxKeyPair> {
  const sodium = await loadNativeSodium();
  const pair = sodium.crypto_box_keypair();
  if (
    pair.publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES ||
    pair.privateKey.length !== sodium.crypto_box_SECRETKEYBYTES
  ) {
    throw new Error('Libsodium returned an invalid public-key pair.');
  }
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

/** Authenticated public-key encryption using libsodium crypto_box_easy. */
export async function sealForPeer(
  plaintext: Uint8Array,
  recipientPublicKey: Uint8Array,
  senderPrivateKey: Uint8Array,
): Promise<SodiumBoxPacket> {
  const sodium = await loadNativeSodium();
  if (
    recipientPublicKey.length !== sodium.crypto_box_PUBLICKEYBYTES ||
    senderPrivateKey.length !== sodium.crypto_box_SECRETKEYBYTES
  ) {
    throw new Error('Invalid libsodium public/private key length.');
  }
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ciphertext = sodium.crypto_box_easy(
    plaintext,
    nonce,
    recipientPublicKey,
    senderPrivateKey,
  );
  return { version: 1, algorithm: 'crypto_box_easy', nonce, ciphertext };
}

/** Opens a crypto_box_easy packet; authentication failures throw. */
export async function openFromPeer(
  packet: SodiumBoxPacket,
  senderPublicKey: Uint8Array,
  recipientPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  const sodium = await loadNativeSodium();
  if (
    packet.version !== 1 ||
    packet.algorithm !== 'crypto_box_easy' ||
    packet.nonce.length !== sodium.crypto_box_NONCEBYTES ||
    senderPublicKey.length !== sodium.crypto_box_PUBLICKEYBYTES ||
    recipientPrivateKey.length !== sodium.crypto_box_SECRETKEYBYTES
  ) {
    throw new Error('Invalid crypto_box packet or key length.');
  }
  return sodium.crypto_box_open_easy(
    packet.ciphertext,
    packet.nonce,
    senderPublicKey,
    recipientPrivateKey,
  );
}

/** Generates an independent XChaCha20-Poly1305 key for local payload encryption. */
export async function generateAeadKey(): Promise<Uint8Array> {
  const sodium = await loadNativeSodium();
  return sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
}

/** Encrypts bytes with authenticated context and a fresh random nonce. */
export async function sealLocalBytes(
  plaintext: Uint8Array,
  key: Uint8Array,
  associatedData: string,
): Promise<SodiumAeadPacket> {
  const sodium = await loadNativeSodium();
  if (key.length !== sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES) {
    throw new Error('Invalid XChaCha20-Poly1305 key length.');
  }
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    associatedData,
    null,
    nonce,
    key,
  );
  return { version: 1, algorithm: 'xchacha20-poly1305-ietf', nonce, ciphertext };
}

/** Decrypts local bytes; wrong context, nonce, key, or modified data throws. */
export async function openLocalBytes(
  packet: SodiumAeadPacket,
  key: Uint8Array,
  associatedData: string,
): Promise<Uint8Array> {
  const sodium = await loadNativeSodium();
  if (
    packet.version !== 1 ||
    packet.algorithm !== 'xchacha20-poly1305-ietf' ||
    key.length !== sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES ||
    packet.nonce.length !== sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
  ) {
    throw new Error('Invalid XChaCha20-Poly1305 packet or key length.');
  }
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    packet.ciphertext,
    associatedData,
    packet.nonce,
    key,
  );
}

/**
 * Native-build smoke test for both X25519-backed crypto_box and local AEAD.
 * This verifies library availability only; it does not certify the binary or
 * replace protocol review and physical-device security testing.
 */
export async function assertNativeCryptoAvailable(): Promise<void> {
  const sodium = await loadNativeSodium();
  const sender = sodium.crypto_box_keypair();
  const recipient = sodium.crypto_box_keypair();
  const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
  try {
    const message = Uint8Array.from([0x51, 0x4c, 0x2d, 0x31]);
    const boxNonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const boxCiphertext = sodium.crypto_box_easy(
      message,
      boxNonce,
      recipient.publicKey,
      sender.privateKey,
    );
    const boxPlaintext = sodium.crypto_box_open_easy(
      boxCiphertext,
      boxNonce,
      sender.publicKey,
      recipient.privateKey,
    );

    const aeadNonce = sodium.randombytes_buf(
      sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
    );
    const associatedData = 'quietlink-native-crypto-self-test-v1';
    const aeadCiphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      message,
      associatedData,
      null,
      aeadNonce,
      key,
    );
    const aeadPlaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      aeadCiphertext,
      associatedData,
      aeadNonce,
      key,
    );
    const matches = (actual: Uint8Array) =>
      actual.length === message.length && actual.every((byte, index) => byte === message[index]);
    if (!matches(boxPlaintext) || !matches(aeadPlaintext)) {
      throw new Error('Libsodium self-test returned unexpected plaintext.');
    }

    const tamperedCiphertext = aeadCiphertext.slice();
    tamperedCiphertext[0] ^= 1;
    let tamperingRejected = false;
    try {
      sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        tamperedCiphertext,
        associatedData,
        aeadNonce,
        key,
      );
    } catch {
      tamperingRejected = true;
    }
    if (!tamperingRejected) {
      throw new Error('Libsodium self-test failed to reject modified ciphertext.');
    }
    boxPlaintext.fill(0);
    aeadPlaintext.fill(0);
  } finally {
    sender.privateKey.fill(0);
    recipient.privateKey.fill(0);
    key.fill(0);
  }
}
