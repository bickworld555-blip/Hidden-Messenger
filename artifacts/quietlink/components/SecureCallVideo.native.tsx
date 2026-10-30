import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import type { MediaStream } from 'react-native-webrtc';
import { useColors } from '@/hooks/useColors';
import { getSecureCallTransportAvailability } from '@/services/secureCallSession';

type RtcViewComponent = typeof import('react-native-webrtc').RTCView;

type Props = {
  stream: MediaStream | null;
  style?: ViewStyle;
  mirror?: boolean;
  label?: string;
};

export default function SecureCallVideo({
  stream,
  style,
  label = 'Video unavailable',
}: Props) {
  const colors = useColors();
  const [RtcView, setRtcView] = useState<RtcViewComponent | null>(null);
  const availability = getSecureCallTransportAvailability();

  useEffect(() => {
    let mounted = true;
    if (!availability.available || !stream) {
      setRtcView(null);
      return () => {
        mounted = false;
      };
    }
    void import('react-native-webrtc')
      .then((module) => {
        if (mounted && module.RTCView) setRtcView(() => module.RTCView);
      })
      .catch(() => {
        if (mounted) setRtcView(null);
      });
    return () => {
      mounted = false;
    };
  }, [availability.available, stream]);

  if (stream && RtcView && availability.available) {
    return (
      <RtcView
        streamURL={stream.toURL()}
        objectFit="cover"
        style={[styles.placeholder, style]}
      />
    );
  }

  return (
    <View style={[styles.placeholder, { backgroundColor: colors.card }, style]}>
      <Text style={{ color: colors.mutedForeground }}>
        {stream
          ? (availability.reason ??
            'Native video is unavailable in this build.')
          : label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
