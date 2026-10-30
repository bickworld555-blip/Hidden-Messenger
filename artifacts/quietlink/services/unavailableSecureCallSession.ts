import type { CallInvite, CallMode } from '@/security/secureCallVerification';
import type {
  SecureCallController,
  SecureCallRole,
  SecureCallSnapshot,
} from '@/services/secureCallSession.types';

export function createUnavailableSecureCallSession(
  role: SecureCallRole,
  mode: CallMode,
  reason: string,
): SecureCallController {
  const snapshot: SecureCallSnapshot = {
    role,
    mode,
    status: 'error',
    inviteQr: null,
    verificationQr: null,
    verificationCode: null,
    localStream: null,
    remoteStream: null,
    error: reason,
    muted: false,
    cameraEnabled: mode === 'video',
  };

  const unavailable = async () => {
    throw new Error(reason);
  };

  return {
    role,
    mode,
    subscribe: (listener) => {
      listener(snapshot);
      return () => undefined;
    },
    startOutgoing: unavailable,
    join: (_invite: CallInvite) => unavailable(),
    verifyPeerQr: (_value: string) => unavailable(),
    setMuted: (_muted: boolean) => undefined,
    setCameraEnabled: (_enabled: boolean) => undefined,
    end: async () => undefined,
  };
}
