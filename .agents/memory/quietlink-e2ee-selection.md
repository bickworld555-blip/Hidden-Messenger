---
name: QuietLink E2EE selection
description: The current project decision to keep chat sending locked until a reviewed mobile-compatible E2EE implementation is chosen.
---

The user requested native libsodium primitives for QuietLink, but this does not replace a reviewed E2EE protocol. Keep text, media, and migration disabled until the user selects a reviewed, mobile-compatible messaging protocol.

**Why:** the user first deferred E2EE pending review, then asked to configure audited cryptographic primitives. Primitive availability alone does not provide identity verification, a ratchet, replay protection, or session lifecycle.

**How to apply:** use libsodium only through the installed native binding for primitives; preserve the fail-closed adapter and disabled send controls until a protocol and native integration path are reviewed and approved.
