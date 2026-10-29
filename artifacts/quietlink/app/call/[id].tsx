import React, { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { Avatar } from '@/components/Avatar';
import { SOUND_ASSETS } from '@/components/SoundPreviewButton';
import { useAppSettings } from '@/context/AppSettingsContext';
import { useColors } from '@/hooks/useColors';
import { requestDevicePermission } from '@/services/devicePermissions';

export default function CallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { name = 'Contact', mode = 'audio', stage: stageParam = 'outgoing' } = useLocalSearchParams<{ id: string; name?: string; mode?: string; stage?: string }>();
  const { settings } = useAppSettings();
  const [stage, setStage] = useState<'incoming' | 'outgoing' | 'active'>(
    stageParam === 'incoming' || stageParam === 'active' ? stageParam : 'outgoing',
  );
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(mode === 'video');
  const [permissionBusy, setPermissionBusy] = useState(false);
  const isVideo = mode === 'video';
  const tonePlayer = useAudioPlayer(stage === 'incoming' ? SOUND_ASSETS[settings.ringtone] : SOUND_ASSETS.ringback);
  const endTonePlayer = useAudioPlayer(SOUND_ASSETS.ended);

  useEffect(() => {
    setStage(stageParam === 'incoming' || stageParam === 'active' ? stageParam : 'outgoing');
  }, [stageParam]);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true });
    tonePlayer.loop = true;
    if (settings.callSoundsEnabled && (stage === 'incoming' || stage === 'outgoing')) {
      tonePlayer.seekTo(0);
      tonePlayer.play();
    } else {
      tonePlayer.pause();
    }
    return () => tonePlayer.pause();
  }, [settings.callSoundsEnabled, settings.ringtone, stage, tonePlayer]);

  useEffect(() => {
    if (stage !== 'incoming' || settings.vibrationPattern === 'off' || Platform.OS === 'web') return;
    const vibrate = () => Vibration.vibrate(settings.vibrationPattern === 'short' ? 130 : [0, 100, 85, 130]);
    vibrate();
    const interval = setInterval(vibrate, 2600);
    return () => {
      clearInterval(interval);
      Vibration.cancel();
    };
  }, [settings.vibrationPattern, stage]);

  const requestCallPermissions = async () => {
    if (permissionBusy) return false;
    setPermissionBusy(true);
    try {
      const microphone = await requestDevicePermission('microphone');
      const camera = isVideo ? await requestDevicePermission('camera') : null;
      const blocked = microphone.status !== 'granted' || (camera && camera.status !== 'granted');
      if (blocked) {
        Alert.alert(
          'Call permission not granted',
          microphone.status === 'unavailable' || camera?.status === 'unavailable'
            ? 'Use the native iOS or Android app to request call permissions.'
            : 'Allow microphone and camera access in QuietLink settings before trying a call.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open settings', onPress: () => { void Linking.openSettings(); } },
          ],
        );
        return false;
      }
      return true;
    } finally {
      setPermissionBusy(false);
    }
  };

  const acceptPreview = async () => {
    if (!await requestCallPermissions()) return;
    setStage('active');
    Alert.alert('Call preview only', 'Permissions are allowed, but QuietLink has no connected audio or video call transport. Nothing is captured or sent.');
  };

  const endCallPreview = () => {
    tonePlayer.pause();
    endTonePlayer.seekTo(0);
    endTonePlayer.play();
    setTimeout(() => router.back(), 380);
  };

  const declineCallPreview = () => {
    tonePlayer.pause();
    endTonePlayer.seekTo(0);
    endTonePlayer.play();
    setTimeout(() => router.back(), 380);
  };

  const control = (icon: React.ComponentProps<typeof Feather>['name'], label: string, selected: boolean, onPress: () => void) => (
    <Pressable onPress={onPress} style={[styles.control, { backgroundColor: selected ? colors.accent : colors.card }]} accessibilityRole="button" accessibilityLabel={`${label} preview control`}>
      <Feather name={icon} size={20} color={selected ? colors.primary : colors.foreground} />
      <Text style={[styles.controlText, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 20), paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.topLine}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Close call preview"><Feather name="chevron-down" size={22} color={colors.foreground} /></Pressable>
        <Text style={[styles.previewBadge, { color: colors.primary }]}>CALL PREVIEW</Text>
        <Feather name={isVideo ? 'video' : 'phone'} size={18} color={colors.primary} />
      </View>
      <View style={styles.caller}>
        <Avatar initials={String(name).split(' ').map((part) => part[0]).join('').slice(0, 2)} color={colors.primary} size={104} />
        <Text style={[styles.name, { color: colors.foreground }]}>{name}</Text>
        <Text style={[styles.callState, { color: colors.mutedForeground }]}>
          {stage === 'incoming' ? 'Incoming call · preview' : stage === 'outgoing' ? 'Calling · preview' : 'Active layout · preview'}
        </Text>
        <Text style={[styles.callDuration, { color: colors.mutedForeground }]}>00:00 · not connected</Text>
        {isVideo ? (
          <View style={[styles.videoPlaceholder, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="video-off" size={24} color={colors.mutedForeground} />
            <Text style={[styles.videoCaption, { color: colors.mutedForeground }]}>Camera feed is not connected</Text>
          </View>
        ) : null}
      </View>
      {stage === 'active' ? (
        <View style={styles.actions}>
          {control(muted ? 'mic-off' : 'mic', 'Mute', muted, () => setMuted((value) => !value))}
          {control('volume-2', 'Speaker', speaker, () => setSpeaker((value) => !value))}
          {isVideo ? control(cameraEnabled ? 'video' : 'video-off', 'Camera', cameraEnabled, () => setCameraEnabled((value) => !value)) : null}
        </View>
      ) : null}
      <View style={styles.bottomArea}>
        <View style={[styles.disclosureBox, { backgroundColor: colors.accent }]}>
          <Feather name="info" size={14} color={colors.primary} />
          <Text style={[styles.disclosure, { color: colors.accentForeground }]}>
            No WebRTC call is connected. Controls and screen changes are previews; no microphone or camera media is transmitted.
          </Text>
        </View>
        {stage === 'incoming' ? (
          <View style={styles.callActions}>
            <Pressable onPress={declineCallPreview} style={[styles.endButton, { backgroundColor: colors.destructive }]} accessibilityRole="button" accessibilityLabel="Decline call preview">
              <Feather name="phone-off" size={20} color={colors.destructiveForeground} />
            </Pressable>
            <Pressable onPress={() => void acceptPreview()} style={[styles.acceptButton, { backgroundColor: colors.primary }]} disabled={permissionBusy} accessibilityRole="button" accessibilityLabel="Accept call preview">
              <Feather name="phone" size={20} color={colors.primaryForeground} />
              <Text style={[styles.acceptText, { color: colors.primaryForeground }]}>{permissionBusy ? 'Checking' : 'Accept preview'}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.callActions}>
            {stage === 'outgoing' ? (
              <Pressable onPress={() => void requestCallPermissions()} style={[styles.permissionButton, { backgroundColor: colors.secondary }]} disabled={permissionBusy} accessibilityRole="button">
                <Feather name="shield" size={15} color={colors.primary} />
                <Text style={[styles.permissionText, { color: colors.secondaryForeground }]}>{permissionBusy ? 'Checking' : 'Check permissions'}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={endCallPreview} style={[styles.endButton, { backgroundColor: colors.destructive }]} accessibilityRole="button" accessibilityLabel="End call preview">
              <Feather name="phone-off" size={20} color={colors.destructiveForeground} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 },
  topLine: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewBadge: { fontSize: 10, fontWeight: '700', letterSpacing: 1.3 },
  caller: { alignItems: 'center', flex: 1, justifyContent: 'center', gap: 13 },
  name: { fontSize: 25, fontWeight: '700', marginTop: 12 },
  callState: { fontSize: 13 },
  callDuration: { fontSize: 11, fontVariant: ['tabular-nums'] },
  videoPlaceholder: { marginTop: 15, width: 230, height: 145, borderWidth: 1, borderRadius: 20, alignItems: 'center', justifyContent: 'center', gap: 10 },
  videoCaption: { fontSize: 11 },
  actions: { width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 15, marginBottom: 22 },
  control: { width: 64, height: 64, borderRadius: 22, justifyContent: 'center', alignItems: 'center', gap: 4 },
  controlText: { fontSize: 9 },
  bottomArea: { width: '100%', gap: 14, marginBottom: 10 },
  disclosureBox: { padding: 11, borderRadius: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  disclosure: { flex: 1, textAlign: 'left', fontSize: 10, lineHeight: 15 },
  callActions: { minHeight: 66, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 22 },
  acceptButton: { minWidth: 145, height: 56, borderRadius: 20, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 9, paddingHorizontal: 16 },
  acceptText: { fontSize: 12, fontWeight: '700' },
  endButton: { width: 58, height: 58, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  permissionButton: { minHeight: 42, paddingHorizontal: 12, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 7 },
  permissionText: { fontSize: 10, fontWeight: '700' },
});
