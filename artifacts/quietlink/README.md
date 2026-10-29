# Hidden Messenger

Hidden Messenger is a cross-platform private-messaging prototype. Its visible app name is Hidden Messenger; the Expo slug, workspace package name, route identifiers, and `quietlink` URL scheme remain stable internal identifiers.

## Run and verify

- `pnpm --filter @workspace/quietlink run dev` — start the Expo preview.
- `pnpm --filter @workspace/quietlink run typecheck` — typecheck the mobile app.
- `pnpm --filter @workspace/quietlink run test:secure-media` — run secure media buffer tests.

## Native display name

Expo's `name` is set to **Hidden Messenger** and supplies the Android application label during native generation. `ios.infoPlist.CFBundleDisplayName` explicitly sets the iOS home-screen name. This repository uses Expo prebuild configuration and does not check in `ios/Info.plist` or `android/app/src/main/AndroidManifest.xml`.

## Security status

- Native builds must include SQLCipher; storage fails closed when it is unavailable.
- Message sending, E2EE, real calls, remote push delivery, voice recording/playback, and device transfer remain disabled or preview-only until their reviewed secure implementations are available.
- Local media is encrypted at rest only. Its protocol AAD, database/key identifiers, SecureStore keys, and existing app scheme retain their `quietlink` values for compatibility; do not rename them as part of a display-name change.
- See `docs/SECURITY_MODEL.md` for the current architecture, limitations, and native validation requirements.
