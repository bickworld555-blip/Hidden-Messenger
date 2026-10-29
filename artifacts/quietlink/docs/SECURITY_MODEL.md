# QuietLink security model

## Current build status

The app does not send messages, media, make real calls, publish statuses, or transfer data to another device. Text sending and media sharing remain locked because no reviewed E2EE protocol or encrypted transport is installed. `security/secureMessaging.ts` defines fail-closed text and media-key adapter boundaries; it does not implement a messaging protocol. The app configures a native libsodium binding for X25519-backed `crypto_box` and XChaCha20-Poly1305 primitives. These primitives are not a reviewed messaging protocol and are not wired into message or transfer flows. The API includes a short-lived WebSocket signaling gateway, but the mobile app does not connect to it yet. In Expo Go, web, or any binary without SQLCipher, the secure vault and local media import fail closed. A rebuilt native iOS/Android binary configured with SQLCipher stores conversation data and local media-key metadata in the encrypted vault.

The chat provider opens the vault before showing screens. The adapter checks for SQLCipher and fails closed rather than using plaintext SQLite. The secure-message boundary will only pass protocol-produced ciphertext envelopes to a configured transport. No protocol engine or transport is installed, so sends remain disabled. On native builds with the encrypted vault, users can import photos, videos, and audio for local storage only. Media is never sent, and no E2EE key wrapper is installed.

## Target architecture

```text
Mobile client A  <---- end-to-end encrypted payloads ---->  Mobile client B
       |                                                     |
       +--------- ephemeral WebSocket signaling ------------+
                              |
                       Signaling service
```

1. Use an established, independently reviewed end-to-end protocol implementation. Do not invent key exchange, ratchets, message authentication, or group cryptography. Device keys should be generated locally and kept in platform-protected key storage.
2. The API WebSocket route at `/api/signal` creates a random, short-lived pairing room and accepts only WebRTC offers, answers, and ICE candidates. The room/token state exists in process memory for up to two minutes; the gateway has no database or persistent queue. Do not accept message bodies or media on signaling routes. The service can still observe connection metadata and signaling SDP/candidates, including IP addresses and timing. A process restart destroys all active pairings.
3. WebRTC data channels can carry peer-to-peer payloads when network conditions allow. Some users will need a TURN relay because NAT/firewalls prevent direct paths. A TURN relay can see traffic metadata and must relay only already-encrypted payloads; this is not a guarantee of a direct connection or zero server exposure.
4. Use an encrypted SQLCipher database for message records in a rebuilt iOS/Android binary. SQLCipher's native configuration is enabled for both platforms; the SQLCipher v4 default page cipher is AES-256-CBC with an HMAC. Obtain a random 256-bit database key using a cryptographically secure random source and store it in Keychain/Android Keystore-backed storage. Never hard-code or log it. `secureChatDb.ts` checks for SQLCipher support before opening, sets the key before reading schema data, and the chat provider uses it for text and conversation metadata only when cipher support is confirmed.
5. `security/cryptoPrimitives.ts` wraps libsodium's native X25519-backed `crypto_box` and XChaCha20-Poly1305 primitives. The native binding is a third-party bridge with a subset of libsodium's API; this app and bridge have not received an independent security audit. Use per-purpose keys and authenticated context. These primitives do not provide identity verification, a ratchet, replay protection, or an E2EE session protocol; do not use them alone for chat or migration.
6. Encrypt media before writing it to the app sandbox. The current local-only path uses Expo Crypto AES-256-GCM with a fresh random 256-bit key per file, a fresh 96-bit nonce per 64 KiB chunk, a 128-bit tag, and AAD binding the chunk to the conversation, attachment, type, and position. The file key is stored only in the SQLCipher-protected metadata table. A bounded streaming decrypt API authenticates each chunk before passing it to a caller and zeroes the chunk buffer afterward. Do not assume SQLCipher encrypts unrelated files, thumbnails, temporary files, or OS backups.
7. The document picker is called with `copyToCacheDirectory: false`. The selected source remains in its original Photos/files provider and is not modified or deleted by QuietLink. If the native file handle cannot read the granted URI directly, import fails; there is no plaintext cache-copy fallback. App-owned media output is ciphertext only. No thumbnail, preview file, or media content is written to logs.
8. A new-device transfer should require explicit approval on both devices, establish an authenticated encrypted session using a reviewed protocol, stream the vault over the local link, verify integrity, and only then offer the user a choice to remove the old copy. A QR code should carry only a short-lived pairing secret or public key—not chat data or a reusable account secret.

## Deletion limits

The app must not claim forensic-proof deletion. Flash storage controllers, filesystem snapshots, app backups, operating-system caches, and journal behavior can leave data outside an app's control. Overwriting a file is not a reliable way to erase flash storage. A product can delete records and media, remove temporary data it owns, and destroy the vault key as best-effort cryptographic erasure. The UI must describe those limits and treat backup/export copies separately.

The delete action removes message/conversation rows from SQLCipher when the native encrypted vault is active, or removes them from memory in preview mode. The settings screen offers an explicit vault reset that deletes the database and current key, then creates a new empty vault. Media keys are inside SQLCipher; losing the vault key makes remaining media ciphertext unreadable. This is best-effort cryptographic erasure, not a secure wipe; the app cannot run cleanup code when uninstalled.

## Native build steps for the encrypted vault

1. Keep `expo-sqlite` configured with `useSQLCipher: true` and build a new native iOS/Android binary. A JavaScript reload or Expo Go session cannot enable SQLCipher.
2. Store a random 32-byte database key in platform secure storage. Expo SecureStore maps to iOS Keychain and Android Keystore-backed storage; the iOS item is restricted to the current device and Android SecureStore preferences are excluded from automatic backup. Do not derive it from a user PIN without a reviewed KDF and a recovery plan.
3. Open the database, verify `PRAGMA cipher_version` is present, set `PRAGMA key` immediately, and perform a read before migrations. Refuse to continue if the cipher check or read fails.
4. Apply schema migrations transactionally. Use parameterized statements for user-controlled values; only the validated local hexadecimal key is interpolated in the SQLCipher PRAGMA.
5. Verify fresh install, app restart, wrong-key handling, reset, device restore, and deletion behavior on physical Android and iOS devices. Verify that the document picker does not create an app-cache copy with `copyToCacheDirectory: false`; the import must fail rather than fall back to plaintext copying. OS backups may include the encrypted media container and SQLCipher database, but the app must never put plaintext media or file keys into those app-owned files.
6. The current media flow stores ciphertext only and exposes a bounded streaming decryption callback, but does not yet include an in-app photo/video/audio renderer. Do not open media through system preview or write decrypted files to disk. Before shipping, add a native renderer that consumes authenticated chunks without OS disk caching, then review backups, crash reporting, notifications, screenshots/app-switcher previews, memory lifetime, and logs.
7. The native libsodium plugin requires a rebuilt custom iOS/Android binary; Expo Go does not contain this native module. Validate compilation and crypto smoke tests on physical iOS and Android devices.
8. Complete a third-party security review and publish a threat model before making production privacy or security claims.

## Known non-goals in this prototype

- No WhatsApp branding, copied assets, or exact proprietary screen reproduction.
- No production identity system, key verification, Signal Protocol implementation, TURN server, WebRTC data channel, or message delivery. The ephemeral signaling gateway exists but the mobile client does not use it.
- No E2EE media-key wrapping or media sharing; local file keys are only protected by SQLCipher at rest.
- No in-app decrypted media renderer; the streaming API has not been verified with native image, video, or audio decoders.
- No secure overwrite or anti-forensics feature.
- No app-managed cloud backup. Operating-system backup behavior still needs platform-specific review. The prototype does not yet have a P2P migration implementation.
