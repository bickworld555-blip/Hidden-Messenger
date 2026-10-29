import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function Avatar({
  initials,
  color,
  size = 52,
  ring = false,
}: {
  initials: string;
  color: string;
  size?: number;
  ring?: boolean;
}) {
  return (
    <View style={[styles.outer, ring && styles.ring, { width: size + (ring ? 6 : 0), height: size + (ring ? 6 : 0), borderRadius: (size + 6) / 2 }]}>
      <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
        <Text style={[styles.initials, { fontSize: size * 0.29 }]}>{initials}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 2, borderColor: '#0A8A75' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#FFFFFF', fontWeight: '700', letterSpacing: 0.3 },
});
