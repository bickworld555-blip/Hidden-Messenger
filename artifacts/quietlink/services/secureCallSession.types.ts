import type { MediaStream } from 'react-native-webrtc';
import type { CallInvite, CallMode } from '@/security/secureCallVerification';

export type SecureCallRole = 'host' | 'joiner';
export type SecureCallStatus =
  | 'preparing'
  | 'waiting'
  | 'incoming'
  | 'connecting'
  | 'verifying'
  | 'verified'
  | 'active'
  | 'ended'
  | 'error';

export type SecureCallSnapshot = {
  role: SecureCallRole;
  mode: CallMode;
  status: SecureCallStatus;
  inviteQr: string | null;
  verificationQr: string | null;
  verificationCode: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  error: string | null;
  muted: boolean;
  cameraEnabled: boolean;
};

export type SecureCallListener = (snapshot: SecureCallSnapshot) => void;

export interface SecureCallController {
  readonly role: SecureCallRole;
  readonly mode: CallMode;
  subscribe(listener: SecureCallListener): () => void;
  startOutgoing(): Promise<void>;
  join(invite: CallInvite): Promise<void>;
  verifyPeerQr(value: string): Promise<void>;
  setMuted(muted: boolean): void;
  setCameraEnabled(enabled: boolean): void;
  end(): Promise<void>;
}
