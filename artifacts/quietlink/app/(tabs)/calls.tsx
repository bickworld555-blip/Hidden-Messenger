import React from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useColors } from '@/hooks/useColors';

const calls = [
  { id: 'maya', name: 'Maya Chen', initials: 'MC', color: '#D7A68F', kind: 'video' as const, incoming: true, time: 'Today, 8:46' },
  { id: 'eli', name: 'Eli Morgan', initials: 'EM', color: '#A399C5', kind: 'audio' as const, incoming: false, time: 'Yesterday, 18:12' },
  { id: 'sam', name: 'Samira Rahman', initials: 'SR', color: '#82A2B3', kind: 'audio' as const, incoming: true, time: 'Monday, 11:03' },
];

export default function CallsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 10) }]}>
      <View style={styles.headerWrap}>
        <ScreenHeader title="Calls" subtitle="Recent voice and video calls" />
        <View style={[styles.notice, { backgroundColor: colors.accent }]}>
          <Feather name="info" size={15} color={colors.primary} />
          <Text style={[styles.noticeText, { color: colors.accentForeground }]}>Call screens are a preview; no audio or video is connected.</Text>
        </View>
      </View>
      <FlatList
        data={calls}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 90, paddingTop: 10 }}
        renderItem={({ item }) => (
          <View style={[styles.callRow, { borderBottomColor: colors.border }]}>
            <Avatar initials={item.initials} color={item.color} size={50} />
            <View style={styles.callCopy}>
              <Text style={[styles.name, { color: colors.foreground }]}>{item.name}</Text>
              <View style={styles.callMeta}>
                <Feather name={item.incoming ? 'corner-down-left' : 'corner-up-right'} size={13} color={item.incoming ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{item.time} · {item.kind === 'video' ? 'Video' : 'Voice'}</Text>
              </View>
            </View>
            <Pressable onPress={() => router.push({ pathname: '/call/[id]', params: { id: item.id, name: item.name, mode: item.kind } })} hitSlop={12} accessibilityRole="button" accessibilityLabel={`Call ${item.name}`}>
              <Feather name={item.kind === 'video' ? 'video' : 'phone'} size={20} color={colors.primary} />
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerWrap: { paddingHorizontal: 20 },
  notice: { flexDirection: 'row', gap: 9, alignItems: 'center', borderRadius: 12, padding: 12, marginTop: 13 },
  noticeText: { fontSize: 11.5, flex: 1, lineHeight: 16 },
  callRow: { minHeight: 77, flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  callCopy: { flex: 1, gap: 5 },
  name: { fontSize: 15, fontWeight: '600' },
  callMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 11.5 },
});
