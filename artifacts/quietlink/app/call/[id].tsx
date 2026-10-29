import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { useColors } from '@/hooks/useColors';

export default function CallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { name = 'Contact', mode = 'audio' } = useLocalSearchParams<{ id: string; name?: string; mode?: string }>();
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [camera, setCamera] = useState(mode === 'video');
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const time = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  const control = (icon: React.ComponentProps<typeof Feather>['name'], label: string, selected: boolean, onPress: () => void) => (
    <Pressable onPress={onPress} style={[styles.control, { backgroundColor: selected ? colors.accent : 'rgba(255,255,255,0.13)' }]} accessibilityRole="button" accessibilityLabel={label}>
      <Feather name={icon} size={20} color={selected ? colors.primary : '#FFFFFF'} />
      <Text style={styles.controlText}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.screen, { backgroundColor: '#12221F', paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 20), paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.topLine}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Close call preview"><Feather name="chevron-down" size={22} color="#FFFFFF" /></Pressable>
        <Text style={styles.previewBadge}>CALL PREVIEW</Text>
        <View style={{ width: 22 }} />
      </View>
      <View style={styles.caller}>
        <Avatar initials={String(name).split(' ').map((part) => part[0]).join('').slice(0, 2)} color="#558F81" size={104} />
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.callState}>No call connection · {time}</Text>
        {mode === 'video' ? <View style={styles.videoPlaceholder}><Feather name="video-off" size={24} color="rgba(255,255,255,0.7)" /><Text style={styles.videoCaption}>Camera preview is not connected</Text></View> : null}
      </View>
      <View style={styles.actions}>
        {control(muted ? 'mic-off' : 'mic', 'Mute', muted, () => setMuted((value) => !value))}
        {control('volume-2', 'Speaker', speaker, () => setSpeaker((value) => !value))}
        {mode === 'video' ? control(camera ? 'video' : 'video-off', 'Camera', camera, () => setCamera((value) => !value)) : null}
        <Pressable onPress={() => router.back()} style={[styles.endButton, { backgroundColor: '#CF4F55' }]} accessibilityRole="button" accessibilityLabel="End call">
          <Feather name="phone-off" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
      <Text style={styles.disclosure}>This screen is visual only. It does not request microphone/camera access or connect to another device.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 },
  topLine: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewBadge: { color: '#92B8AD', fontSize: 10, fontWeight: '700', letterSpacing: 1.3 },
  caller: { alignItems: 'center', flex: 1, justifyContent: 'center', gap: 13 },
  name: { color: '#FFFFFF', fontSize: 25, fontWeight: '700', marginTop: 12 },
  callState: { color: '#A5B9B3', fontSize: 13 },
  videoPlaceholder: { marginTop: 25, width: 210, height: 130, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', gap: 10 },
  videoCaption: { color: '#B9C9C4', fontSize: 11 },
  actions: { width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 15, marginBottom: 18 },
  control: { width: 64, height: 64, borderRadius: 22, justifyContent: 'center', alignItems: 'center', gap: 4 },
  controlText: { color: '#FFFFFF', fontSize: 9 },
  endButton: { width: 62, height: 62, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  disclosure: { color: '#93A9A2', textAlign: 'center', fontSize: 10, lineHeight: 15, marginBottom: 10, maxWidth: 290 },
});
