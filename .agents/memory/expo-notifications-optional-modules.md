---
name: Expo notification optional modules
description: Handling notification modules that are absent in Expo Go, web previews, or uncompiled builds.
---

Load notification APIs lazily behind platform checks, and use optional native-module lookup for notification features that are not required for app startup. If a native notification module is absent, keep the app usable and disable only the notification feature.

**Why:** `expo-notifications` can eagerly evaluate its Android topic-subscription adapter from the package entrypoint. Expo Go or an uncompiled build may not include that native module, so importing notifications can otherwise crash the app even when topic subscriptions are never used.

**How to apply:** When adding or upgrading Expo notifications, inspect the package entrypoint and Android adapter. Ensure absent optional modules return a no-op/unavailable result, keep app imports lazy, and verify both web preview and an Android-targeted bundle.
