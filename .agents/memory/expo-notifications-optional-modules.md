---
name: Expo notification optional modules
description: Handling notification modules that are absent in Expo Go, web previews, or uncompiled builds.
---

Load notification APIs lazily behind platform checks, and use optional native-module lookup for notification features that are not required for app startup. If a native notification module is absent, keep the app usable and disable only the notification feature.

**Why:** Older `expo-notifications` builds eagerly evaluated the Android topic-subscription adapter, which could crash Expo Go or uncompiled builds. A later SDK patch includes optional lookup upstream, so carrying an old local patch can create version conflicts without adding protection.

**How to apply:** When adding or upgrading Expo notifications, inspect the installed package entrypoint and Android adapter before maintaining a local patch. Prefer upstream optional lookup when present; keep app imports lazy and verify web preview plus an Android-targeted bundle.
