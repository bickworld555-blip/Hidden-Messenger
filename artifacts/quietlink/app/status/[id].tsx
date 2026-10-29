import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export default function StatusViewerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { name = 'Contact', text = '', color = '#547F72' } = useLocalSearchParams<{ id: string; name?: string; text?: string; color?: string }>();
  return (
    <View style={[styles.screen, { backgroundColor: color, paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 12), paddingBottom: insets.bottom + 14 }]}>
      <View style={styles.progress}><View style={styles.progressFill} /></View>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Feather name="x" size={23} color="#FFFFFF" /></Pressable>
        <Text style={styles.name}>{name}</Text>
        <Feather name="more-vertical" size={20} color="#FFFFFF" />
      </View>
      <View style={styles.statusBody}>
        <Text style={styles.statusText}>{text}</Text>
        <Text style={styles.preview}>Sample status · not shared</Text>
      </View>
      <Pressable onPress={() => router.back()} style={styles.closeButton}><Text style={styles.closeText}>Close preview</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16 },
  progress: { height: 2, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden', marginTop: 5 },
  progressFill: { width: '68%', height: '100%', backgroundColor: '#FFFFFF' },
  header: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', flex: 1, marginLeft: 14 },
  statusBody: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, gap: 25 },
  statusText: { color: '#FFFFFF', fontSize: 25, fontWeight: '600', textAlign: 'center', lineHeight: 34 },
  preview: { color: 'rgba(255,255,255,0.76)', fontSize: 11 },
  closeButton: { alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.2)' },
  closeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
});
