import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

const waveform = [8, 17, 12, 23, 10, 18, 28, 15, 9, 21, 13, 25, 11, 19, 8, 16, 24, 12, 20, 9, 15, 26, 11, 18, 8, 21, 13, 17];

function WaveBar({ height, active, index, color }: { height: number; active: boolean; index: number; color: string }) {
  const progress = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    if (!active) {
      progress.setValue(0.45);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: 250 + (index % 5) * 45, useNativeDriver: true }),
        Animated.timing(progress, { toValue: 0.25, duration: 280 + (index % 4) * 55, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [active, index, progress]);
  return (
    <Animated.View
      style={[
        styles.waveBar,
        { height, opacity: active ? 1 : 0.55, backgroundColor: color, transform: [{ scaleY: progress }] },
      ]}
    />
  );
}

export function VoiceNotePanel({ onCheckMicrophone, onClose }: { onCheckMicrophone: () => void; onClose: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: colors.accent }]}>
          <Feather name="mic" size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>Voice notes</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Encrypted recording is not ready</Text>
        </View>
        <Text style={[styles.duration, { color: colors.mutedForeground }]}>00:00</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close voice note panel">
          <Feather name="x" size={17} color={colors.mutedForeground} />
        </Pressable>
      </View>
      <View style={styles.waveform} accessibilityLabel="Idle voice note waveform">
        {waveform.map((height, index) => (
          <WaveBar key={index} height={height} active={false} index={index} color={colors.primary} />
        ))}
      </View>
      <View style={styles.controls}>
        <Pressable
          onPress={onCheckMicrophone}
          style={[styles.recordButton, { backgroundColor: colors.muted }]}
          accessibilityRole="button"
          accessibilityLabel="Check microphone permission"
        >
          <Feather name="lock" size={15} color={colors.mutedForeground} />
        </Pressable>
        <View style={styles.speedRow}>
          {['1x', '1.5x', '2x'].map((speed) => (
            <View key={speed} style={[styles.speed, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.speedText, { color: colors.mutedForeground }]}>{speed}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.locked, { color: colors.mutedForeground }]}>Locked</Text>
      </View>
      <Text style={[styles.disclosure, { color: colors.mutedForeground }]}>
        QuietLink won’t record to a plaintext temporary file. Voice notes stay locked until encrypted microphone capture and playback are available.
      </Text>
      <Pressable onPress={onCheckMicrophone} style={styles.permissionLink} accessibilityRole="button">
        <Feather name="mic" size={13} color={colors.primary} />
        <Text style={[styles.permissionText, { color: colors.primary }]}>Check microphone permission</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 18, marginHorizontal: 12, marginBottom: 8, padding: 13 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 13, fontWeight: '700' },
  subtitle: { fontSize: 10, marginTop: 3 },
  duration: { fontSize: 11, fontVariant: ['tabular-nums'] },
  waveform: { height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 12 },
  waveBar: { width: 3, borderRadius: 4 },
  controls: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 10 },
  recordButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  speedRow: { flex: 1, flexDirection: 'row', gap: 6 },
  speed: { minWidth: 38, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 9, opacity: 0.65 },
  speedText: { fontSize: 10, fontWeight: '700' },
  locked: { fontSize: 10, fontWeight: '700' },
  disclosure: { fontSize: 10, lineHeight: 15, marginTop: 10 },
  permissionLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, alignSelf: 'flex-start' },
  permissionText: { fontSize: 10, fontWeight: '700' },
});
