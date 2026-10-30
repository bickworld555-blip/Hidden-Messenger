export type SecureCallAvailability = {
  available: boolean;
  reason: string | null;
};

const WEB_UNAVAILABLE_MESSAGE =
  'Secure WebRTC calls require a rebuilt native iOS or Android app.';
const NATIVE_MODULE_UNAVAILABLE_MESSAGE =
  'The WebRTC native module is not installed in this app build. Use a custom iOS or Android build with WebRTC enabled.';

export function getSecureCallAvailability(
  platform: string,
  nativeWebRtcModule: unknown,
): SecureCallAvailability {
  if (platform === 'web') {
    return { available: false, reason: WEB_UNAVAILABLE_MESSAGE };
  }

  const moduleRegistered =
    (typeof nativeWebRtcModule === 'object' && nativeWebRtcModule !== null) ||
    typeof nativeWebRtcModule === 'function';

  if (!moduleRegistered) {
    return { available: false, reason: NATIVE_MODULE_UNAVAILABLE_MESSAGE };
  }

  return { available: true, reason: null };
}
