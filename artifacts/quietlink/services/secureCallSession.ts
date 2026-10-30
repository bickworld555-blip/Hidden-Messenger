import type {
  SecureCallController,
  SecureCallListener,
  SecureCallRole,
} from '@/services/secureCallSession.types';
import type { CallInvite, CallMode } from '@/security/secureCallVerification';

const unavailable = async (): Promise<void> => {
  throw new Error('Secure WebRTC calls require a rebuilt native iOS or Android app.');
};

export function createSecureCallSession(
  role: SecureCallRole,
  mode: CallMode,
): SecureCallController {
  const snapshot = {
    role,
    mode,
    status: 'error' as const,
    inviteQr: null,
    verificationQr: null,
    verificationCode: null,
    localStream: null,
    remoteStream: null,
    error: 'Secure WebRTC calls are unavailable in this preview.',
    muted: false,
    cameraEnabled: mode === 'video',
  };
  const notify: SecureCallListener = () => undefined;
  return {
    role,
    mode,
    subscribe: (listener) => {
      listener(snapshot);
      return () => undefined;
    },
    startOutgoing: unavailable,
    join: (_invite: CallInvite) => unavailable(),
    verifyPeerQr: unavailable,
    setMuted: notify,
    setCameraEnabled: notify,
    end: async () => undefined,
  };
}
