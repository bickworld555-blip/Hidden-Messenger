---
name: Expo SQLite web preview
description: Why the browser preview uses a platform-specific no-database adapter.
---

Keep the browser preview's storage adapter free of runtime imports from `expo-sqlite` when the product relies on SQLCipher only in native builds.

**Why:** Expo SQLite's web entry imports a WASM SQLite worker. In this workspace Metro failed to resolve that WASM asset, even though the browser preview should never use SQLCipher.

**How to apply:** Keep the web adapter as a fail-closed memory-preview stub and the real SQLCipher adapter on native platforms. If browser SQLite is intentionally added later, configure and verify its WASM bundling separately; do not describe it as SQLCipher storage.
