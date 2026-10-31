---
name: Standalone Android cold start
description: Physical-device startup behavior and the need to bundle the React Native app in test APKs.
---

The user reported that a fresh install of an earlier Android test APK stayed on the native splash screen. The APK was built with the default React Native `debug` variant, which is treated as debuggable and omits the JavaScript bundle; standalone installs therefore cannot start without Metro. A subsequent release build failed R8 minification because the WebRTC dependency references an absent `org.webrtc.Dav1dDecoder$Natives` JNI class.

**Why:** A successful Gradle build does not prove the APK contains a runnable app bundle. Both the splash failure and the R8 failure were observed in physical-device testing/build output.

**How to apply:** Build a standalone, debug-signed release variant for physical-device testing; disable R8 and resource shrinking for this test variant; assert that `assets/index.android.bundle` is present before uploading. Treat physical cold-start verification as separate from CI build success.
