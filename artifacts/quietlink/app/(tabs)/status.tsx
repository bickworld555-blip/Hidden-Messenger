import React from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useColors } from '@/hooks/useColors';

const updates = [
  { id: 'maya', name: 'Maya Chen', initials: 'MC', color: '#D7A68F', time: '12 minutes ago', text: 'A slow morning, finally.' },
  { id: 'sam', name: 'Samira Rahman', initials: 'SR', color: '#82A2B3', time: '1 hour ago', text: 'Little wins count too.' },
  { id: 'jules', name: 'Jules Park', initials: 'JP', color: '#C995AD', time: '3 hours ago', text: 'Out for a walk.' },
];

export default function StatusScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 10) }]}>
      <View style={styles.page}>
        <ScreenHeader title="Status" subtitle="Small moments, shared privately" />
        <View style={[styles.privacyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.privacyIcon, { backgroundColor: colors.accent }]}><Feather name="eye-off" size={17} color={colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.privacyTitle, { color: colors.foreground }]}>Your audience, your choice</Text>
            <Text style={[styles.privacyCopy, { color: colors.mutedForeground }]}>Status sharing is shown with sample content in this preview.</Text>
          </View>
          <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
        </View>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>RECENT UPDATES</Text>
      </View>
      <FlatList
        data={updates}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/status/[id]', params: { id: item.id, name: item.name, text: item.text, color: item.color, initials: item.initials } })}
            style={({ pressed }) => [styles.updateRow, { backgroundColor: pressed ? colors.secondary : colors.background }]}
            accessibilityRole="button"
          >
            <Avatar initials={item.initials} color={item.color} size={48} ring />
            <View style={styles.updateCopy}>
              <Text style={[styles.updateName, { color: colors.foreground }]}>{item.name}</Text>
              <Text style={[styles.updateTime, { color: colors.mutedForeground }]}>{item.time}</Text>
            </View>
            <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
          </Pressable>
        )}
      />
      <Pressable onPress={() => router.push('/new-status')} style={({ pressed }) => [styles.addButton, { backgroundColor: colors.primary, bottom: insets.bottom + 78, opacity: pressed ? 0.86 : 1 }]} accessibilityRole="button" accessibilityLabel="Add a status">
        <Feather name="plus" size={23} color={colors.primaryForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { paddingHorizontal: 20 },
  privacyCard: { borderWidth: 1, borderRadius: 16, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 16, marginBottom: 26 },
  privacyIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  privacyTitle: { fontSize: 12.5, fontWeight: '600' },
  privacyCopy: { fontSize: 10.5, lineHeight: 15, marginTop: 3 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 },
  updateRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 13 },
  updateCopy: { flex: 1, gap: 4 },
  updateName: { fontSize: 14, fontWeight: '600' },
  updateTime: { fontSize: 11 },
  addButton: { position: 'absolute', right: 19, width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: '#10221D', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
});
