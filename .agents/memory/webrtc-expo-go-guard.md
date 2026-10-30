---
name: Expo Go WebRTC native module guard
description: The React Native WebRTC package must be guarded before dynamic import when its native bridge may be missing.
---

Check `NativeModules.WebRTCModule` before dynamically importing `react-native-webrtc`, requesting call permissions, or opening signaling. Use platform-specific fallback adapters/components so web preview does not runtime-import native-only WebRTC code. If the module is absent, show an unavailable state and do not attempt a plaintext or browser transport fallback.

**Why:** Expo Go bundles the JavaScript package without the WebRTC native bridge; the package entry throws during module evaluation when `WebRTCModule` is null.

**How to apply:** keep runtime imports of `react-native-webrtc` behind a native-module presence check, and ensure web resolves fallback implementations with no runtime reference to the package.
