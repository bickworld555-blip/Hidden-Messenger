import type {
  SecureCallController,
  SecureCallRole,
} from '@/services/secureCallSession.types';
import type { CallMode } from '@/security/secureCallVerification';
import { getSecureCallAvailability } from '@/security/secureCallAvailability';
import { createUnavailableSecureCallSession } from '@/services/unavailableSecureCallSession';

export function getSecureCallTransportAvailability() {
  return getSecureCallAvailability('web', null);
}

export function createSecureCallSession(
  role: SecureCallRole,
  mode: CallMode,
): SecureCallController {
  const availability = getSecureCallTransportAvailability();
  return createUnavailableSecureCallSession(
    role,
    mode,
    availability.reason ??
      'Secure WebRTC calls are unavailable in this preview.',
  );
}
