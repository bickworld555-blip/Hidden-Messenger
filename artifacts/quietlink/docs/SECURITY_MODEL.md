# QuietLink security model

## Current build status

The app does not send messages, make real calls, publish statuses, or transfer data to another device. The mobile composer and media actions stay locked because no reviewed E2EE protocol or encrypted transport is installed. `security/secureMessaging.ts` defines a fail-closed adapter boundary; it does not implement cryptography. The API includes a short-lived WebSocket signaling gateway, but the mobile app does not connect to it yet. In Expo Go, web, or any binary without SQLCipher, demo conversations stay in React memory and disappear on reload. A rebuilt native iOS/Android binary configured with SQLCipher stores demo text and conversation metadata in the local encrypted vault.

The chat provider opens the vault before showing screens. The adapter checks for SQLCipher and fails closed rather than using plaintext SQLite. The secure-message boundary will only pass protocol-produced ciphertext envelopes to a configured transport. No engine or transport is installed, so sends remain disabled. Media selection and transfer remain disabled; media files are not encrypted or persisted by this build.

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
4. Use an encrypted SQLCipher database for message records in a rebuilt iOS/Android binary. Obtain a random 256-bit database key using a cryptographically secure random source and store it in Keychain/Android Keystore-backed storage. Never hard-code or log it. `secureChatDb.ts` checks for SQLCipher support before opening, sets the key before reading schema data, and the chat provider uses it for text and conversation metadata only when cipher support is confirmed.
5. Encrypt media before writing it to the app sandbox. Use a vetted native cryptographic implementation and per-file random keys, wrapped by a vault key; do not assume that SQLCipher encrypts unrelated files, thumbnails, temporary files, or OS backups.
6. A new-device transfer should require explicit approval on both devices, establish an authenticated encrypted session using a reviewed protocol, stream the vault over the local link, verify integrity, and only then offer the user a choice to remove the old copy. A QR code should carry only a short-lived pairing secret or public key—not chat data or a reusable account secret.

## Deletion limits

The app must not claim forensic-proof deletion. Flash storage controllers, filesystem snapshots, app backups, operating-system caches, and journal behavior can leave data outside an app's control. Overwriting a file is not a reliable way to erase flash storage. A product can delete records and media, remove temporary data it owns, and destroy the vault key as best-effort cryptographic erasure. The UI must describe those limits and treat backup/export copies separately.

The delete action removes message/conversation rows from SQLCipher when the native encrypted vault is active, or removes them from memory in preview mode. The settings screen offers an explicit vault reset that deletes the database and current key, then creates a new empty vault. This is best-effort cryptographic erasure, not a secure wipe; the app cannot run cleanup code when uninstalled.

## Native build steps for the encrypted vault

1. Keep `expo-sqlite` configured with `useSQLCipher: true` and build a new native iOS/Android binary. A JavaScript reload or Expo Go session cannot enable SQLCipher.
2. Store a random 32-byte database key in platform secure storage. Expo SecureStore maps to iOS Keychain and Android Keystore-backed storage. Do not derive it from a user PIN without a reviewed KDF and a recovery plan.
3. Open the database, verify `PRAGMA cipher_version` is present, set `PRAGMA key` immediately, and perform a read before migrations. Refuse to continue if the cipher check or read fails.
4. Apply schema migrations transactionally. Use parameterized statements for user-controlled values; only the validated local hexadecimal key is interpolated in the SQLCipher PRAGMA.
5. Verify fresh install, app restart, wrong-key handling, reset, device restore, and deletion behavior on physical Android and iOS devices. The current provider stores demo text only; selected media is not enabled.
6. Add a separate audited media encryption layer, disable sensitive OS backups where appropriate, and review crash reporting, notification text, screenshots/app switcher previews, memory lifetime, and logs before shipping.
7. Complete a third-party security review and publish a threat model before making production privacy or security claims.

## Known non-goals in this prototype

- No WhatsApp branding, copied assets, or exact proprietary screen reproduction.
- No production identity system, key verification, Signal Protocol implementation, TURN server, WebRTC data channel, or message delivery. The ephemeral signaling gateway exists but the mobile client does not use it.
- No secure overwrite or anti-forensics feature.
- No app-managed cloud backup. Operating-system backup behavior still needs platform-specific review. The prototype does not yet have a P2P migration implementation.
