import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import type { RingtoneName } from '@/context/AppSettingsContext';
import { useColors } from '@/hooks/useColors';

export type SoundPreviewTone = RingtoneName | 'ringback' | 'ended' | 'sent' | 'incoming';

export const SOUND_ASSETS = {
  soft: require('../assets/audio/ringtone-soft.wav'),
  classic: require('../assets/audio/ringtone-classic.wav'),
  pulse: require('../assets/audio/ringtone-pulse.wav'),
  ringback: require('../assets/audio/ringback.wav'),
  ended: require('../assets/audio/call-ended.wav'),
  sent: require('../assets/audio/message-sent.wav'),
  incoming: require('../assets/audio/message-incoming.wav'),
} satisfies Record<SoundPreviewTone, number>;

export function SoundPreviewButton({ tone, label }: { tone: SoundPreviewTone; label: string }) {
  const colors = useColors();
  const player = useAudioPlayer(SOUND_ASSETS[tone]);
  const status = useAudioPlayerStatus(player);

  const togglePreview = () => {
    try {
      if (status.playing) {
        player.pause();
      } else {
        void setAudioModeAsync({ playsInSilentMode: true });
        player.seekTo(0);
        player.play();
      }
    } catch {
      // Sound preview is optional; a playback failure must not affect chat state.
    }
  };

  return (
    <Pressable
      onPress={togglePreview}
      style={({ pressed }) => [
        styles.button,
        { borderColor: colors.border, backgroundColor: pressed ? colors.secondary : colors.card },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${status.playing ? 'Stop' : 'Preview'} ${label}`}
    >
      <Feather name={status.playing ? 'square' : 'play'} size={13} color={colors.primary} />
      <Text style={[styles.label, { color: colors.foreground }]}>{status.playing ? 'Stop' : 'Preview'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 34,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  label: { fontSize: 11, fontWeight: '600' },
});
