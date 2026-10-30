import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { getSecureCallTransportAvailability } from '@/services/secureCallSession';

type Props = {
  stream: { toURL(): string } | null;
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
  const reason = getSecureCallTransportAvailability().reason;

  return (
    <View style={[styles.placeholder, { backgroundColor: colors.card }, style]}>
      <Text style={{ color: colors.mutedForeground }}>
        {stream
          ? (reason ?? 'Secure video requires a native WebRTC build.')
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
