---
name: Hidden Messenger E2EE selection
description: The current project decision to keep chat sending locked until a reviewed mobile-compatible E2EE implementation is chosen.
---

The user requested native libsodium primitives for Hidden Messenger, but this does not replace a reviewed E2EE messaging protocol. Keep text sending, media sharing, and migration disabled until a reviewed, mobile-compatible protocol is selected. The user separately approved QR-verified WebRTC audio/video calls; this does not unlock chat or attachment transport. Local media may be AES-GCM encrypted at rest only; do not wrap/send its file key without the messaging protocol. The user confirmed sending stays locked and contact discovery stays local-only: read phone contacts on-device for user-initiated invitations, but do not upload the address book or claim app membership without an approved directory.

**Why:** the user deferred E2EE pending review, chose local-only encryption for media and local-only contact discovery, and later approved calls only after QR fingerprint verification. These are separate security scopes; transport encryption for calls is not a reviewed chat protocol.

**How to apply:** preserve the fail-closed chat/media adapters and disabled send controls until a messaging protocol is reviewed. Calls may use WebRTC DTLS-SRTP only after the peer's current DTLS fingerprint is verified out-of-band; never present that as account or contact identity verification.
