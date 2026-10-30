import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { Avatar } from '@/components/Avatar';
import SecureCallVideo from '@/components/SecureCallVideo';
import { SOUND_ASSETS } from '@/components/SoundPreviewButton';
import { useAppSettings } from '@/context/AppSettingsContext';
import { useColors } from '@/hooks/useColors';
import { parseCallInvite, type CallMode } from '@/security/secureCallVerification';
import { requestDevicePermission } from '@/services/devicePermissions';
import {
  createSecureCallSession,
  getSecureCallTransportAvailability,
} from '@/services/secureCallSession';
import { notifyVoiceNoteInterruption } from '@/storage/voiceNoteInterruption';
import type {
  SecureCallController,
  SecureCallRole,
  SecureCallSnapshot,
} from '@/services/secureCallSession.types';

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}

export default function CallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    name?: string;
    mode?: string;
    role?: string;
    invite?: string;
  }>();
  const { settings } = useAppSettings();
  const [transportAvailability] = useState(() => getSecureCallTransportAvailability());
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const name = String(params.name || 'Hidden Messenger call');
  const mode: CallMode = params.mode === 'video' ? 'video' : 'audio';
  const role: SecureCallRole = params.role === 'joiner' ? 'joiner' : 'host';
  const invite = useMemo(
    () => (typeof params.invite === 'string' ? parseCallInvite(params.invite) : null),
    [params.invite],
  );
  const sessionRef = useRef<SecureCallController | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const scanHandledRef = useRef(false);
  const [snapshot, setSnapshot] = useState<SecureCallSnapshot | null>(null);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState('');
  const [duration, setDuration] = useState(0);
  const [pageError, setPageError] = useState(
    transportAvailability.available
      ? ''
      : transportAvailability.reason ?? 'Secure WebRTC calls are unavailable in this app build.',
  );
  const tonePlayer = useAudioPlayer(SOUND_ASSETS.ringback);
  const endTonePlayer = useAudioPlayer(SOUND_ASSETS.ended);

  useEffect(() => {
    notifyVoiceNoteInterruption();
  }, []);

  const requestCallPermissions = async (forRole: SecureCallRole) => {
    if (permissionBusy) return false;
    setPermissionBusy(true);
    try {
      const microphone = await requestDevicePermission('microphone');
      const needsCamera = mode === 'video' || forRole === 'joiner';
      const camera = needsCamera
        ? cameraPermission?.granted
          ? cameraPermission
          : await requestCameraPermission()
        : null;
      if (microphone.status === 'granted' && (!camera || camera.status === 'granted')) return true;

      const permission = microphone.status !== 'granted' ? microphone : camera;
      const canAskAgain = permission?.canAskAgain ?? false;
      const canOpenSettings = permission?.status === 'denied' && !canAskAgain;
      const message = microphone.status === 'unavailable'
        ? 'Use a rebuilt native iOS or Android app to access call permissions.'
        : forRole === 'joiner' && mode === 'audio'
          ? 'Camera access is required to scan the peer verification QR. Calls remain disconnected if access is denied.'
          : 'Allow microphone access, and camera access for video calls, before continuing.';
      Alert.alert(
        'Call permission needed',
        message,
        [
          { text: 'Not now', style: 'cancel' },
          ...(canOpenSettings && Platform.OS !== 'web'
            ? [{
                text: 'Open settings',
                onPress: () => {
                  void Linking.openSettings().catch(() => setPageError('Could not open device settings.'));
                },
              }]
            : []),
        ],
      );
      return false;
    } catch {
      setPageError('Hidden Messenger could not check call permissions.');
      return false;
    } finally {
      setPermissionBusy(false);
    }
  };

  useEffect(() => {
    if (role !== 'host') return;
    let mounted = true;
    let session: SecureCallController | null = null;
    const start = async () => {
      if (!transportAvailability.available) {
        setPageError(transportAvailability.reason ?? 'Secure WebRTC calls are unavailable in this app build.');
        return;
      }
      if (!await requestCallPermissions('host') || !mounted) return;
      session = createSecureCallSession('host', mode);
      sessionRef.current = session;
      unsubscribeRef.current = session.subscribe(setSnapshot);
      try {
        await session.startOutgoing();
      } catch (error) {
        if (mounted) setPageError(error instanceof Error ? error.message : 'Could not start the call.');
      }
    };
    void start();
    return () => {
      mounted = false;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      if (sessionRef.current === session) sessionRef.current = null;
      if (session) void session.end();
    };
    // The outgoing session is created once when the user opens this route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, mode, transportAvailability]);

  useEffect(() => {
    if (snapshot?.status !== 'active') {
      setDuration(0);
      return;
    }
    const timer = setInterval(() => setDuration((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [snapshot?.status]);

  useEffect(() => {
    const shouldRing = role === 'host' &&
      settings.callSoundsEnabled &&
      (snapshot?.status === 'waiting' || snapshot?.status === 'connecting');
    tonePlayer.loop = true;
    if (shouldRing) {
      void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
      tonePlayer.seekTo(0);
      tonePlayer.play();
    } else {
      tonePlayer.pause();
    }
    return () => tonePlayer.pause();
  }, [role, settings.callSoundsEnabled, snapshot?.status, tonePlayer]);

  useEffect(() => {
    if (role !== 'joiner' || !scannerOpen || Platform.OS === 'web') return;
    if (settings.vibrationPattern === 'off') return;
    const vibrate = () => Vibration.vibrate(settings.vibrationPattern === 'short' ? 130 : [0, 100, 85, 130]);
    vibrate();
    return () => Vibration.cancel();
  }, [role, scannerOpen, settings.vibrationPattern]);

  const attachSession = (session: SecureCallController) => {
    unsubscribeRef.current?.();
    sessionRef.current = session;
    unsubscribeRef.current = session.subscribe(setSnapshot);
  };

  const acceptInvitation = async () => {
    if (!transportAvailability.available) {
      setPageError(transportAvailability.reason ?? 'Secure WebRTC calls are unavailable in this app build.');
      return;
    }
    if (!invite) {
      setPageError('This call invitation is invalid or expired. Ask the caller to create a new QR code.');
      return;
    }
    if (!await requestCallPermissions('joiner')) return;
    const session = createSecureCallSession('joiner', mode);
    attachSession(session);
    try {
      await session.join(invite);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Could not join the call.');
    }
  };

  const openVerificationScanner = async () => {
    if (Platform.OS === 'web') {
      setScanError('QR verification requires the native camera.');
      return;
    }
    const camera = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
    if (camera.status !== 'granted') {
      setScanError('Camera access is needed to scan the other device’s verification QR.');
      if (camera.status === 'denied' && !camera.canAskAgain) {
        Alert.alert('Camera access denied', 'Open device settings to allow camera access for call verification.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open settings',
            onPress: () => {
              if (Platform.OS !== 'web') void Linking.openSettings().catch(() => setScanError('Could not open device settings.'));
            },
          },
        ]);
      }
      return;
    }
    scanHandledRef.current = false;
    setScanError('');
    setScannerOpen(true);
  };

  const onVerificationQr = async (value: string) => {
    if (scanHandledRef.current) return;
    scanHandledRef.current = true;
    try {
      await sessionRef.current?.verifyPeerQr(value);
      setScannerOpen(false);
      setScanError('');
    } catch (error) {
      setScannerOpen(false);
      setScanError(error instanceof Error ? error.message : 'The QR did not match.');
    }
  };

  const endCall = async () => {
    tonePlayer.pause();
    await sessionRef.current?.end();
    endTonePlayer.seekTo(0);
    endTonePlayer.play();
    setTimeout(() => router.back(), 260);
  };

  const statusText = (() => {
    if (pageError) return pageError;
    if (!snapshot) return role === 'joiner' ? 'Invitation scanned · waiting for your answer' : 'Preparing a secure call';
    switch (snapshot.status) {
      case 'preparing': return 'Preparing secure call';
      case 'waiting': return 'Waiting for the other device to scan';
      case 'incoming': return 'Call invitation ready';
      case 'connecting': return 'Connecting directly to the other device';
      case 'verifying': return role === 'host'
        ? 'Scan this QR on the other device to verify the call'
        : 'Scan the verification QR shown on the other device';
      case 'verified': return 'Peer fingerprint verified · preparing media';
      case 'active': return `Verified ${mode === 'video' ? 'video' : 'audio'} call · ${formatDuration(duration)}`;
      case 'ended': return 'Call ended';
      case 'error': return snapshot.error || 'The secure call could not be started';
    }
  })();

  const active = snapshot?.status === 'active';
  const showInvite = role === 'host' && snapshot?.inviteQr;
  const showVerification = snapshot?.status === 'verifying' && role === 'host' && snapshot.verificationQr;
  const showJoinQrScanner = role === 'joiner' && scannerOpen && Platform.OS !== 'web';

  const control = (
    icon: React.ComponentProps<typeof Feather>['name'],
    label: string,
    selected: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      onPress={onPress}
      style={[styles.control, { backgroundColor: selected ? colors.primary : colors.card }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name={icon} size={20} color={selected ? colors.primaryForeground : colors.foreground} />
      <Text style={[styles.controlText, { color: selected ? colors.primaryForeground : colors.foreground }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[
      styles.screen,
      {
        backgroundColor: colors.background,
        paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 12),
        paddingBottom: insets.bottom + 16,
      },
    ]}>
      <View style={styles.topLine}>
        <Pressable onPress={() => void endCall()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close call">
          <Feather name="chevron-down" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.topLabel, { color: colors.primary }]}>
          {active ? 'VERIFIED CALL' : role === 'joiner' ? 'JOIN SECURE CALL' : 'SECURE CALL'}
        </Text>
        <Feather name={mode === 'video' ? 'video' : 'phone'} size={18} color={colors.primary} />
      </View>

      {showJoinQrScanner ? (
        <View style={styles.scanner}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => { void onVerificationQr(data); }}
          />
          <View style={styles.scannerOverlay}>
            <Text style={styles.scannerTitle}>Scan call verification QR</Text>
            <Text style={styles.scannerCaption}>The code must match this call before microphone or camera media starts.</Text>
            {scanError ? <Text style={styles.scannerError}>{scanError}</Text> : null}
            <Pressable onPress={() => setScannerOpen(false)} style={styles.scannerClose} accessibilityRole="button" accessibilityLabel="Cancel QR scan">
              <Feather name="x" size={21} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.caller}>
            {mode === 'video' && active && snapshot?.remoteStream ? (
              <View style={[styles.remoteVideo, { backgroundColor: colors.card }]}>
                <SecureCallVideo stream={snapshot.remoteStream} style={StyleSheet.absoluteFill} label="Waiting for the other camera" />
                {snapshot.localStream ? (
                  <View style={styles.localVideo}>
                    <SecureCallVideo stream={snapshot.localStream} style={StyleSheet.absoluteFill} mirror />
                  </View>
                ) : null}
              </View>
            ) : (
              <Avatar
                initials={name.split(' ').map((part) => part[0]).join('').slice(0, 2)}
                color={colors.primary}
                size={96}
              />
            )}
            <Text style={[styles.name, { color: colors.foreground }]}>{name}</Text>
            <Text style={[styles.callState, { color: snapshot?.status === 'error' || pageError ? colors.destructive : colors.mutedForeground }]}>
              {statusText}
            </Text>

            {showInvite || showVerification ? (
              <View style={[styles.qrCard, { borderColor: colors.border }]}>
                <QRCode
                  value={showInvite ? snapshot.inviteQr! : snapshot.verificationQr!}
                  size={196}
                  color="#111111"
                  backgroundColor="#FFFFFF"
                />
                <Text style={[styles.qrCaption, { color: colors.mutedForeground }]}>
                  {showInvite ? 'Temporary invite · expires shortly' : 'Fingerprint check · scan with the other device'}
                </Text>
              </View>
            ) : null}

            {role === 'joiner' && !snapshot ? (
              <View style={styles.inviteActions}>
                <Pressable
                  onPress={() => router.back()}
                  style={[styles.secondaryButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Decline</Text>
                </Pressable>
                <Pressable
                  onPress={() => void acceptInvitation()}
                  disabled={permissionBusy || !invite || !transportAvailability.available}
                  style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: permissionBusy || !invite || !transportAvailability.available ? 0.55 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Accept secure call invitation"
                >
                  <Feather name="phone" size={17} color={colors.primaryForeground} />
                  <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>{permissionBusy ? 'Checking' : transportAvailability.available ? 'Join call' : 'Unavailable in this build'}</Text>
                </Pressable>
              </View>
            ) : null}

            {role === 'joiner' && snapshot?.status === 'verifying' ? (
              <Pressable
                onPress={() => void openVerificationScanner()}
                style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                accessibilityRole="button"
              >
                <Feather name="camera" size={17} color={colors.primaryForeground} />
                <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Scan verification QR</Text>
              </Pressable>
            ) : null}
            {scanError && !scannerOpen ? <Text style={[styles.scanError, { color: colors.destructive }]}>{scanError}</Text> : null}
          </View>

          {active ? (
            <View style={styles.actions}>
              {control(
                snapshot?.muted ? 'mic-off' : 'mic',
                snapshot?.muted ? 'Unmute' : 'Mute',
                Boolean(snapshot?.muted),
                () => sessionRef.current?.setMuted(!snapshot?.muted),
              )}
              {mode === 'video' ? control(
                snapshot?.cameraEnabled ? 'video' : 'video-off',
                snapshot?.cameraEnabled ? 'Camera off' : 'Camera on',
                !snapshot?.cameraEnabled,
                () => sessionRef.current?.setCameraEnabled(!snapshot?.cameraEnabled),
              ) : null}
            </View>
          ) : null}

          <View style={styles.bottomArea}>
            {snapshot?.status === 'error' || pageError ? (
              <View style={[styles.notice, { backgroundColor: colors.accent }]}>
                <Feather name="shield" size={15} color={colors.primary} />
                <Text style={[styles.noticeText, { color: colors.accentForeground }]}>
                  No media is sent until the peer fingerprint is QR-verified. This call could not continue.
                </Text>
              </View>
            ) : role === 'host' && snapshot?.status !== 'active' ? (
              <View style={[styles.notice, { backgroundColor: colors.accent }]}>
                <Feather name="lock" size={15} color={colors.primary} />
                <Text style={[styles.noticeText, { color: colors.accentForeground }]}>
                  Audio and video start only after the other device verifies the call fingerprint. Signaling relays setup data only.
                </Text>
              </View>
            ) : null}
            {snapshot ? (
              <Pressable
                onPress={() => void endCall()}
                style={[styles.endButton, { backgroundColor: colors.destructive }]}
                accessibilityRole="button"
                accessibilityLabel="End secure call"
              >
                <Feather name="phone-off" size={21} color={colors.destructiveForeground} />
              </Pressable>
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 },
  topLine: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  caller: { alignItems: 'center', flex: 1, width: '100%', justifyContent: 'center', gap: 12 },
  name: { fontSize: 24, fontWeight: '700', marginTop: 8 },
  callState: { fontSize: 13, textAlign: 'center', lineHeight: 19, maxWidth: 300 },
  qrCard: { marginTop: 10, padding: 12, borderWidth: 1, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', gap: 9 },
  qrCaption: { maxWidth: 220, textAlign: 'center', fontSize: 10, lineHeight: 14 },
  remoteVideo: { width: '100%', height: '72%', maxHeight: 520, borderRadius: 22, overflow: 'hidden' },
  localVideo: { position: 'absolute', right: 12, top: 12, width: 92, height: 136, borderRadius: 13, overflow: 'hidden', borderWidth: 1, borderColor: '#FFFFFF' },
  actions: { width: '100%', flexDirection: 'row', justifyContent: 'center', gap: 14, marginBottom: 18 },
  control: { minWidth: 74, height: 68, borderRadius: 20, justifyContent: 'center', alignItems: 'center', gap: 5, paddingHorizontal: 8 },
  controlText: { fontSize: 9, fontWeight: '700' },
  bottomArea: { width: '100%', alignItems: 'center', gap: 12, marginBottom: 10 },
  notice: { width: '100%', flexDirection: 'row', gap: 9, alignItems: 'flex-start', borderRadius: 13, padding: 12 },
  noticeText: { fontSize: 11, flex: 1, lineHeight: 16 },
  endButton: { width: 60, height: 60, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  inviteActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  primaryButton: { minHeight: 48, paddingHorizontal: 18, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryButtonText: { fontSize: 12, fontWeight: '700' },
  secondaryButton: { minHeight: 48, minWidth: 90, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  secondaryButtonText: { fontSize: 12, fontWeight: '600' },
  scanError: { maxWidth: 290, textAlign: 'center', fontSize: 11 },
  scanner: { flex: 1, width: '100%', overflow: 'hidden', borderRadius: 22, marginVertical: 18 },
  scannerOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'flex-end', padding: 20, gap: 10, backgroundColor: 'rgba(0,0,0,0.18)' },
  scannerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  scannerCaption: { color: '#FFFFFF', fontSize: 12, lineHeight: 17, textAlign: 'center', maxWidth: 280 },
  scannerError: { color: '#FFFFFF', fontSize: 12, textAlign: 'center' },
  scannerClose: { width: 46, height: 46, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', marginTop: 4 },
});
