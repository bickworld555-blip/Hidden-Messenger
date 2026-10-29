# Hidden Messenger

Hidden Messenger is an original cross-platform private-messaging prototype with chat, call, status, and settings flows plus a fail-closed SQLCipher storage foundation.

## Run & Operate

- `pnpm --filter @workspace/quietlink run dev` — run the Expo mobile preview
- `pnpm --filter @workspace/quietlink run typecheck` — typecheck the mobile app
- `pnpm --filter @workspace/api-server run dev` — run the shared API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- The mobile prototype does not require a server or database to render.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/quietlink/app/` — Expo Router screens for conversations, chat, status, calls, and settings.
- `artifacts/quietlink/context/MessageContext.tsx` — conversation state, native vault hydration, and an explicit memory-only preview fallback.
- `artifacts/quietlink/storage/secureChatDb.ts` — SQLCipher-backed native text storage; it fails closed unless the native binary includes SQLCipher.
- `artifacts/quietlink/security/secureMessaging.ts` — E2EE adapter/transport boundary; sending stays locked until both are installed.
- `artifacts/quietlink/docs/SECURITY_MODEL.md` — current prototype limits and production privacy architecture.
- `artifacts/quietlink/constants/colors.ts` — light and dark Hidden Messenger theme tokens.
- `artifacts/api-server/src/lib/signaling.ts` — in-memory, two-minute WebSocket pairing/signaling gateway; no messages/media are accepted or persisted.

## Architecture decisions

- The mobile app uses original Hidden Messenger branding and common chat interaction patterns, not copied WhatsApp assets or an exact brand replica.
- The Expo Go/web preview uses in-memory demo chats only; a rebuilt native SQLCipher binary can persist text and conversation metadata. Neither mode sends or backs up messages.
- SQLCipher is enabled as a native config plugin. Expo Go and web are intentionally not treated as encrypted storage environments.
- The signaling gateway holds only temporary pairing state and WebRTC offer/answer/ICE messages in memory; the mobile client does not use it yet.
- The chat composer and media actions remain disabled until a reviewed E2EE implementation and encrypted transport are selected and connected.
- In-app vault reset deletes the current database/key and opens a new empty vault best-effort; app uninstall cannot trigger app cleanup code.
- Do not use plain SQLite, AsyncStorage, or app logs as a fallback for chat contents when SQLCipher is unavailable.
- Deletion must be described as best-effort key/data removal, never forensic-proof overwriting.

## Product

The prototype includes a searchable chat list, local sample message composition, image selection for an in-memory preview, status browsing/composition, visual call screens, and a privacy/settings screen. The shared API has an ephemeral signal-only WebSocket gateway, but the mobile client does not use it. Real delivery, account identity, end-to-end protocol, WebRTC data channels, encrypted media storage, and device-to-device transfer remain unimplemented.

## User preferences

- The user asked for a cross-platform iOS/Android private messenger based on the attached chat-flow reference.

## Gotchas

- Changing `expo-sqlite`'s `useSQLCipher` setting requires a new native build; it cannot be enabled in Expo Go or by an OTA update.
- The app must keep the explicit prototype disclosures until its encryption, transport, and storage have been implemented and independently tested.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
