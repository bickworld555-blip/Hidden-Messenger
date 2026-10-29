---
name: QuietLink E2EE selection
description: The current project decision to keep chat sending locked until a reviewed mobile-compatible E2EE implementation is chosen.
---

Keep QuietLink text and media sending disabled until the user selects a reviewed, mobile-compatible E2EE implementation. Do not substitute a homegrown ECDH/AES protocol.

**Why:** the user chose to defer E2EE pending review; available React Native bindings have licensing, support, or audit questions that need resolution first.

**How to apply:** preserve the fail-closed adapter and disabled send controls until the user approves the protocol and its native integration path.
