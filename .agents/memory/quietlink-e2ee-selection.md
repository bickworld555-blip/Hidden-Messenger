---
name: Hidden Messenger E2EE selection
description: The current project decision to keep chat sending locked until a reviewed mobile-compatible E2EE implementation is chosen.
---

The user requested native libsodium primitives for Hidden Messenger, but this does not replace a reviewed E2EE protocol. Keep text sending, media sharing, and migration disabled until the user selects a reviewed, mobile-compatible messaging protocol. Local media may be AES-GCM encrypted at rest only; do not wrap/send its file key without the protocol.

**Why:** the user deferred E2EE pending review, then chose local-only encryption for media before that review. Primitive availability alone does not provide identity verification, a ratchet, replay protection, or session lifecycle.

**How to apply:** use primitives only inside local storage or a reviewed protocol; preserve the fail-closed adapter and disabled send controls until a protocol and native integration path are reviewed and approved.
