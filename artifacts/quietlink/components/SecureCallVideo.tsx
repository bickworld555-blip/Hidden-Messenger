import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import type { MediaStream } from 'react-native-webrtc';
import { useColors } from '@/hooks/useColors';

type RtcViewComponent = typeof import('react-native-webrtc').RTCView;

type Props = {
  stream: MediaStream | null;
  style?: ViewStyle;
  mirror?: boolean;
  label?: string;
};

export default function SecureCallVideo({ stream, style, label = 'Video unavailable' }: Props) {
  const colors = useColors();
  const [RtcView, setRtcView] = useState<RtcViewComponent | null>(null);

  useEffect(() => {
    let mounted = true;
    if (Platform.OS === 'web' || !stream) {
      setRtcView(null);
      return () => {
        mounted = false;
      };
    }
    void import('react-native-webrtc')
      .then((module) => {
        if (mounted) setRtcView(() => module.RTCView);
      })
      .catch(() => {
        if (mounted) setRtcView(null);
      });
    return () => {
      mounted = false;
    };
  }, [stream]);

  if (stream && RtcView) {
    return <RtcView streamURL={stream.toURL()} objectFit="cover" style={[styles.placeholder, style]} />;
  }
  return (
    <View style={[styles.placeholder, { backgroundColor: colors.card }, style]}>
      <Text style={{ color: colors.mutedForeground }}>{stream ? 'Native video is unavailable in this preview.' : label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
