import * as Crypto from 'expo-crypto';
import type {
  MediaStream,
  MediaStreamTrack,
  RTCPeerConnection,
} from 'react-native-webrtc';
import {
  buildCallVerificationMaterial,
  encodeCallInvite,
  encodeFingerprintVerificationQr,
  extractSha256Fingerprint,
  hasAudioVideoMedia,
  parseFingerprintVerificationQr,
  type CallInvite,
  type CallMode,
} from '@/security/secureCallVerification';
import type {
  SecureCallController,
  SecureCallListener,
  SecureCallRole,
  SecureCallSnapshot,
  SecureCallStatus,
} from '@/services/secureCallSession.types';

type JsonRecord = Record<string, unknown>;
type RTCDataChannel = ReturnType<RTCPeerConnection['createDataChannel']>;
type IceCandidatePayload = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
};
type SignalPayload =
  | { type: 'offer' | 'answer'; sdp: string }
  | IceCandidatePayload & { type: 'ice' };
type MessageWaiter = {
  matches: (message: JsonRecord) => boolean;
  resolve: (message: JsonRecord) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const SIGNAL_TIMEOUT_MS = 15_000;
const ICE_SERVERS = [
  {
    urls: process.env.EXPO_PUBLIC_STUN_URL || 'stun:stun.l.google.com:19302',
  },
];

class NativeSecureCallSession implements SecureCallController {
  readonly role: SecureCallRole;
  readonly mode: CallMode;

  private listeners = new Set<SecureCallListener>();
  private snapshot: SecureCallSnapshot;
  private socket: WebSocket | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private webRTC: typeof import('react-native-webrtc') | null = null;
  private invite: CallInvite | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private pendingIce: IceCandidatePayload[] = [];
  private waiters = new Set<MessageWaiter>();
  private serializedSignals = Promise.resolve();
  private createdOffer = false;
  private peerJoined = false;
  private localMediaStarted = false;
  private mediaRequest: Promise<MediaStream> | null = null;
  private safetyCode: string | null = null;
  private isVerified = false;
  private isEnded = false;
  private isMuted = false;
  private isCameraEnabled = true;

  constructor(role: SecureCallRole, mode: CallMode) {
    this.role = role;
    this.mode = mode;
    this.isCameraEnabled = mode === 'video';
    this.snapshot = {
      role,
      mode,
      status: 'preparing',
      inviteQr: null,
      verificationQr: null,
      verificationCode: null,
      localStream: null,
      remoteStream: null,
      error: null,
      muted: false,
      cameraEnabled: this.isCameraEnabled,
    };
  }

  subscribe(listener: SecureCallListener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async startOutgoing() {
    if (this.role !== 'host') throw new Error('This call session cannot create an invitation.');
    try {
      await this.connectSignaling();
      const createdPromise = this.waitForServerMessage(
        (message) => message.type === 'created' || message.type === 'error',
      );
      this.sendJson({ action: 'create' });
      const created = await createdPromise;
      if (created.type === 'error') throw this.serverError(created);
      if (
        typeof created.roomId !== 'string' ||
        typeof created.joinToken !== 'string' ||
        typeof created.expiresAt !== 'number'
      ) {
        throw new Error('The signaling service returned an invalid call invitation.');
      }
      this.invite = {
        roomId: created.roomId,
        joinToken: created.joinToken,
        mode: this.mode,
        expiresAt: created.expiresAt,
      };
      await this.initializePeerConnection();
      this.publish({ status: 'waiting', inviteQr: encodeCallInvite(this.invite) });
      if (this.peerJoined) await this.createInitialOffer();
    } catch (error) {
      this.fail(this.safeError(error));
      throw error;
    }
  }

  async join(invite: CallInvite) {
    if (this.role !== 'joiner') throw new Error('This call session cannot join an invitation.');
    if (invite.mode !== this.mode || invite.expiresAt <= Date.now()) {
      throw new Error('This call invitation is invalid or has expired.');
    }
    try {
      this.invite = invite;
      await this.connectSignaling();
      await this.initializePeerConnection();
      const joinedPromise = this.waitForServerMessage(
        (message) => message.type === 'joined' || message.type === 'error',
      );
      this.sendJson({
        action: 'join',
        roomId: invite.roomId,
        joinToken: invite.joinToken,
      });
      const joined = await joinedPromise;
      if (joined.type === 'error') throw this.serverError(joined);
      this.publish({ status: 'connecting', inviteQr: null });
    } catch (error) {
      this.fail(this.safeError(error));
      throw error;
    }
  }

  async verifyPeerQr(value: string) {
    if (this.role !== 'joiner' || !this.safetyCode || !this.dataChannel) {
      throw new Error('Call verification is not ready yet.');
    }
    if (this.isVerified) return;
    const receivedCode = parseFingerprintVerificationQr(value);
    if (!receivedCode || receivedCode !== this.safetyCode) {
      throw new Error('The QR fingerprint did not match. The call remains disconnected.');
    }
    if (this.dataChannel.readyState !== 'open') {
      throw new Error('The secure call channel is not ready. Try scanning again.');
    }
    this.isVerified = true;
    this.dataChannel.send(JSON.stringify({ type: 'verified', code: this.safetyCode }));
    this.publish({ status: 'verified', verificationQr: null });
  }

  setMuted(muted: boolean) {
    this.isMuted = muted;
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    this.publish({ muted });
  }

  setCameraEnabled(enabled: boolean) {
    if (this.mode !== 'video') return;
    this.isCameraEnabled = enabled;
    this.localStream?.getVideoTracks().forEach((track) => {
      track.enabled = enabled;
    });
    this.publish({ cameraEnabled: enabled });
  }

  async end() {
    if (this.isEnded) return;
    this.isEnded = true;
    this.disposeResources();
    this.publish({
      status: 'ended',
      inviteQr: null,
      verificationQr: null,
      verificationCode: null,
      localStream: null,
      remoteStream: null,
    });
  }

  private disposeResources() {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Call ended.'));
    }
    this.waiters.clear();
    try {
      this.dataChannel?.close();
      this.peerConnection?.close();
      this.socket?.close();
    } catch {
      // Cleanup must continue if an individual native close operation fails.
    }
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.remoteStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.remoteStream = null;
  }

  private publish(change: Partial<SecureCallSnapshot>) {
    if (this.isEnded && change.status !== 'ended') return;
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  private async connectSignaling() {
    const domain = process.env.EXPO_PUBLIC_DOMAIN?.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!domain) throw new Error('Secure call signaling is not configured for this build.');
    const socket = new WebSocket(`wss://${domain}/api/signal`);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      let opened = false;
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('Could not connect to the secure call signaling service.'));
      }, SIGNAL_TIMEOUT_MS);
      socket.onopen = () => {
        opened = true;
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        if (opened) this.fail('The secure call signaling connection failed.');
        else reject(new Error('Could not connect to the secure call signaling service.'));
      };
      socket.onclose = () => {
        clearTimeout(timer);
        if (!opened) reject(new Error('Could not connect to the secure call signaling service.'));
        if (!this.isEnded) this.fail('The signaling connection closed.');
      };
      socket.onmessage = (event) => this.onSocketMessage(event.data);
    });
  }

  private async initializePeerConnection() {
    if (this.peerConnection) return;
    if (this.role !== 'host' && this.role !== 'joiner') {
      throw new Error('Unsupported call participant role.');
    }
    try {
      this.webRTC = await import('react-native-webrtc');
    } catch {
      throw new Error('Native WebRTC is not installed in this build. Rebuild the iOS or Android app.');
    }
    if (!this.webRTC?.RTCPeerConnection || !this.webRTC.mediaDevices?.getUserMedia) {
      throw new Error('Native WebRTC is unavailable. Rebuild the iOS or Android app.');
    }

    const peerConnection = new this.webRTC.RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peerConnection = peerConnection;
    peerConnection.onicecandidate = (event) => {
      const candidate = (event as unknown as { candidate: {
        candidate: string;
        sdpMid: string | null;
        sdpMLineIndex: number | null;
      } | null }).candidate;
      if (!candidate || !this.invite) return;
      this.sendSignal({
        type: 'ice',
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      });
    };
    peerConnection.ontrack = (event) => {
      const trackEvent = event as unknown as { streams: MediaStream[]; track: MediaStreamTrack | null };
      const stream = trackEvent.streams[0] ?? this.createRemoteStream();
      if (!trackEvent.streams[0] && trackEvent.track) stream.addTrack(trackEvent.track);
      this.remoteStream = stream;
      this.publish({ remoteStream: stream });
      this.updateActiveState();
    };
    peerConnection.onconnectionstatechange = () => {
      if (peerConnection.connectionState === 'failed') {
        this.fail('A peer-to-peer connection could not be established. Check both devices’ network connections.');
      } else if (peerConnection.connectionState === 'connected') {
        this.updateActiveState();
      } else if (peerConnection.connectionState === 'disconnected') {
        this.publish({ status: 'connecting' });
      }
    };

    if (this.role === 'host') {
      this.attachDataChannel(
        peerConnection.createDataChannel('call-verification', { ordered: true }),
      );
    } else {
      peerConnection.ondatachannel = (event) => {
        const channelEvent = event as unknown as { channel: RTCDataChannel };
        this.attachDataChannel(channelEvent.channel);
      };
    }
  }

  private createRemoteStream() {
    if (!this.webRTC) throw new Error('WebRTC is unavailable.');
    if (!this.remoteStream) this.remoteStream = new this.webRTC.MediaStream();
    return this.remoteStream;
  }

  private attachDataChannel(channel: RTCDataChannel) {
    this.dataChannel = channel;
    channel.onopen = () => {
      void this.refreshVerificationCode();
    };
    channel.onmessage = (event: unknown) => {
      const data = (event as { data?: unknown }).data;
      void this.onDataMessage(String(data ?? ''));
    };
    channel.onerror = () => {
      this.fail('The encrypted call control channel failed.');
    };
    channel.onclose = () => {
      if (!this.isEnded) this.fail('The other device ended the call.');
    };
  }

  private async onDataMessage(raw: string) {
    let message: JsonRecord;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      message = parsed as JsonRecord;
    } catch {
      return;
    }
    if (
      this.role === 'host' &&
      message.type === 'verified' &&
      typeof message.code === 'string' &&
      message.code === this.safetyCode &&
      this.dataChannel?.readyState === 'open'
    ) {
      this.isVerified = true;
      this.publish({ status: 'verified' });
      try {
        await this.startHostMedia();
      } catch (error) {
        this.fail(this.safeError(error));
      }
    }
  }

  private onSocketMessage(raw: unknown) {
    if (typeof raw !== 'string') return;
    let message: JsonRecord;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      message = parsed as JsonRecord;
    } catch {
      return;
    }
    for (const waiter of [...this.waiters]) {
      if (waiter.matches(message)) {
        this.waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
    if (message.type === 'peer-joined' && this.role === 'host') {
      this.peerJoined = true;
      void this.createInitialOffer().catch((error) => this.fail(this.safeError(error)));
    } else if (message.type === 'signal' && message.signal && typeof message.signal === 'object') {
      const signal = message.signal as SignalPayload;
      this.serializedSignals = this.serializedSignals
        .then(() => this.handleSignal(signal))
        .catch((error) => this.fail(this.safeError(error)));
    } else if (message.type === 'session-closed') {
      this.fail('The other device ended the call.');
    } else if (message.type === 'error' && typeof message.code === 'string') {
      this.fail(`The call signaling service rejected the request (${message.code}).`);
    }
  }

  private waitForServerMessage(matches: (message: JsonRecord) => boolean) {
    return new Promise<JsonRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error('The call signaling service did not respond in time.'));
      }, SIGNAL_TIMEOUT_MS);
      const waiter: MessageWaiter = {
        matches,
        resolve,
        reject,
        timer,
      };
      this.waiters.add(waiter);
    });
  }

  private sendJson(value: JsonRecord) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('The call signaling connection is not open.');
    }
    this.socket.send(JSON.stringify(value));
  }

  private sendSignal(signal: SignalPayload) {
    if (!this.invite || this.isEnded) return;
    this.sendJson({
      action: 'signal',
      roomId: this.invite.roomId,
      signal,
    });
  }

  private async createInitialOffer() {
    if (this.role !== 'host' || this.createdOffer || !this.peerConnection || !this.invite) return;
    this.createdOffer = true;
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    const sdp = this.peerConnection.localDescription?.sdp;
    if (!sdp) throw new Error('Could not create the initial WebRTC offer.');
    this.sendSignal({ type: 'offer', sdp });
    this.publish({ status: 'connecting', inviteQr: null });
  }

  private async handleSignal(signal: SignalPayload) {
    const peerConnection = this.peerConnection;
    if (!peerConnection || this.isEnded) return;
    if (signal.type === 'ice') {
      if (!peerConnection.remoteDescription) this.pendingIce.push(signal);
      else await peerConnection.addIceCandidate(signal);
      return;
    }
    if (signal.type === 'offer') {
      const includesMedia = hasAudioVideoMedia(signal.sdp);
      if (includesMedia && (!this.isVerified || this.role !== 'joiner')) {
        throw new Error('Media was offered before call verification.');
      }
      if (includesMedia) await this.ensureLocalMedia();
      await peerConnection.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      await this.flushPendingIce();
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      const localSdp = peerConnection.localDescription?.sdp;
      if (!localSdp) throw new Error('Could not create a WebRTC answer.');
      this.sendSignal({ type: 'answer', sdp: localSdp });
      this.publish({ status: this.isVerified ? 'verified' : 'connecting' });
      await this.refreshVerificationCode();
      this.updateActiveState();
      return;
    }

    if (signal.type === 'answer') {
      await peerConnection.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      await this.flushPendingIce();
      await this.refreshVerificationCode();
      this.updateActiveState();
    }
  }

  private async flushPendingIce() {
    const peerConnection = this.peerConnection;
    if (!peerConnection?.remoteDescription || this.pendingIce.length === 0) return;
    const candidates = this.pendingIce.splice(0);
    for (const candidate of candidates) await peerConnection.addIceCandidate(candidate);
  }

  private async refreshVerificationCode() {
    const localSdp = this.peerConnection?.localDescription?.sdp;
    const remoteSdp = this.peerConnection?.remoteDescription?.sdp;
    if (!localSdp || !remoteSdp || !this.invite || !this.dataChannel) return;
    try {
      const material = buildCallVerificationMaterial({
        role: this.role,
        roomId: this.invite.roomId,
        joinToken: this.invite.joinToken,
        localFingerprint: extractSha256Fingerprint(localSdp),
        remoteFingerprint: extractSha256Fingerprint(remoteSdp),
      });
      const code = (
        await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, material)
      ).toUpperCase();
      this.safetyCode = code;
      const qr = this.role === 'host' ? encodeFingerprintVerificationQr(code) : null;
      if (this.dataChannel.readyState === 'open' && !this.isVerified) {
        this.publish({
          status: 'verifying',
          verificationCode: code,
          verificationQr: qr,
        });
      }
    } catch (error) {
      this.fail(this.safeError(error));
    }
  }

  private async startHostMedia() {
    if (this.role !== 'host' || !this.isVerified || this.localMediaStarted) return;
    const peerConnection = this.peerConnection;
    if (!peerConnection || peerConnection.signalingState !== 'stable') {
      throw new Error('The peer connection is not ready to start media.');
    }
    await this.ensureLocalMedia();
    this.localMediaStarted = true;
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    const sdp = peerConnection.localDescription?.sdp;
    if (!sdp) throw new Error('Could not create the verified media offer.');
    this.sendSignal({ type: 'offer', sdp });
    this.publish({ status: 'connecting' });
  }

  private async ensureLocalMedia() {
    if (this.localStream) return this.localStream;
    if (this.mediaRequest) return this.mediaRequest;
    if (!this.isVerified) throw new Error('Media cannot start before fingerprint verification.');
    if (!this.webRTC?.mediaDevices?.getUserMedia) {
      throw new Error('Native media capture is unavailable in this build.');
    }
    this.mediaRequest = this.webRTC.mediaDevices
      .getUserMedia({
        audio: true,
        video: this.mode === 'video'
          ? {
              facingMode: 'user',
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 24, max: 30 },
            }
          : false,
      })
      .then((stream) => {
        if (this.isEnded) {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error('Call ended before media could start.');
        }
        this.localStream = stream;
        stream.getTracks().forEach((track) => {
          track.enabled = track.kind === 'audio' ? !this.isMuted : this.isCameraEnabled;
          this.peerConnection?.addTrack(track, stream);
        });
        this.publish({ localStream: stream });
        return stream;
      })
      .finally(() => {
        this.mediaRequest = null;
      });
    return this.mediaRequest;
  }

  private updateActiveState() {
    if (
      this.isVerified &&
      this.localStream &&
      this.peerConnection?.connectionState === 'connected'
    ) {
      this.publish({ status: 'active' });
    }
  }

  private serverError(message: JsonRecord) {
    const code = typeof message.code === 'string' ? message.code : 'unknown';
    return new Error(`The call signaling service rejected the request (${code}).`);
  }

  private safeError(error: unknown) {
    if (error instanceof Error) {
      const safe = error.message.replace(/[\r\n]+/g, ' ').slice(0, 180);
      return safe || 'The secure call could not be started.';
    }
    return 'The secure call could not be started.';
  }

  private fail(error: string) {
    if (this.isEnded) return;
    this.isEnded = true;
    this.disposeResources();
    this.snapshot = {
      ...this.snapshot,
      status: 'error',
      error,
      inviteQr: null,
      verificationQr: null,
      verificationCode: null,
      localStream: null,
      remoteStream: null,
    };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }
}

export function createSecureCallSession(
  role: SecureCallRole,
  mode: CallMode,
): SecureCallController {
  return new NativeSecureCallSession(role, mode);
}
