import React, { useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useMessages } from '@/context/MessageContext';
import { useColors } from '@/hooks/useColors';

const filters = ['All', 'Unread', 'Groups'] as const;

export default function ChatsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { threads, storageStatus } = useMessages();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof filters)[number]>('All');
  const filteredThreads = useMemo(() => threads.filter((thread) => {
    const matchesQuery = thread.name.toLowerCase().includes(query.toLowerCase()) || thread.lastMessage.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === 'All' || (filter === 'Unread' ? thread.unread > 0 : thread.group);
    return matchesQuery && matchesFilter;
  }), [threads, query, filter]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 10) }]}>
      <View style={styles.page}>
        <ScreenHeader
          title="Chats"
          subtitle="Private conversations, kept simple"
          rightIcon="edit-3"
          onRightPress={() => router.push('/new-chat')}
        />
        <View style={[styles.searchBox, { backgroundColor: colors.secondary }]}>
          <Feather name="search" size={17} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search conversations"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            returnKeyType="search"
            accessibilityLabel="Search conversations"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Feather name="x-circle" size={17} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.filterRow}>
          {filters.map((item) => {
            const selected = filter === item;
            return (
              <Pressable
                key={item}
                onPress={() => setFilter(item)}
                style={[styles.filterChip, { backgroundColor: selected ? colors.accent : colors.card, borderColor: selected ? colors.accent : colors.border }]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.filterText, { color: selected ? colors.accentForeground : colors.mutedForeground }]}>{item}</Text>
              </Pressable>
            );
          })}
          <View style={styles.privateTag}>
            <Feather name="lock" size={12} color={colors.primary} />
            <Text style={[styles.privateLabel, { color: colors.primary }]}>{storageStatus === 'encrypted' ? 'Encrypted on device' : 'Memory-only preview'}</Text>
          </View>
        </View>
      </View>
      <FlatList
        data={filteredThreads}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 88 }]}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}
            style={({ pressed }) => [styles.threadRow, { backgroundColor: pressed ? colors.secondary : colors.background }]}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.lastMessage}`}
          >
            <View style={styles.avatarWrap}>
              <Avatar initials={item.initials} color={item.color} size={54} />
              {item.online ? <View style={[styles.onlineDot, { borderColor: colors.background }]} /> : null}
            </View>
            <View style={[styles.threadDetails, { borderBottomColor: colors.border }]}>
              <View style={styles.threadTop}>
                <View style={styles.nameLine}>
                  <Text numberOfLines={1} style={[styles.name, { color: colors.foreground }]}>{item.name}</Text>
                  {item.pinned ? <Feather name="bookmark" size={12} color={colors.mutedForeground} /> : null}
                </View>
                <Text style={[styles.time, { color: item.unread ? colors.primary : colors.mutedForeground }]}>{item.time}</Text>
              </View>
              <View style={styles.threadBottom}>
                <Text numberOfLines={1} style={[styles.preview, { color: item.unread ? colors.foreground : colors.mutedForeground, fontWeight: item.unread ? '600' : '400' }]}>{item.lastMessage}</Text>
                {item.unread > 0 ? (
                  <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
                    <Text style={styles.unreadText}>{item.unread}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="message-circle" size={25} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No conversations found</Text>
            <Text style={[styles.emptyCopy, { color: colors.mutedForeground }]}>Try another name or filter.</Text>
          </View>
        }
      />
      <Pressable
        onPress={() => router.push('/new-chat')}
        style={({ pressed }) => [styles.composeButton, { backgroundColor: colors.primary, bottom: insets.bottom + 78, opacity: pressed ? 0.86 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel="Start a new conversation"
      >
        <Feather name="plus" size={24} color={colors.primaryForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { paddingHorizontal: 20 },
  searchBox: { height: 45, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, marginTop: 15 },
  searchInput: { flex: 1, height: '100%', fontSize: 14 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 13, marginBottom: 9 },
  filterChip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7 },
  filterText: { fontSize: 12, fontWeight: '600' },
  privateTag: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4 },
  privateLabel: { fontSize: 10, fontWeight: '600' },
  listContent: { paddingTop: 2 },
  threadRow: { minHeight: 78, flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 19 },
  avatarWrap: { width: 66, position: 'relative' },
  onlineDot: { position: 'absolute', width: 13, height: 13, borderRadius: 7, right: 8, bottom: 1, backgroundColor: '#42B883', borderWidth: 2 },
  threadDetails: { flex: 1, minHeight: 77, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  threadTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  name: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  time: { fontSize: 11, fontWeight: '500' },
  threadBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 6 },
  preview: { fontSize: 12.5, flex: 1 },
  unreadBadge: { minWidth: 19, height: 19, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  composeButton: { position: 'absolute', right: 19, width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: '#10221D', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 36, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginTop: 5 },
  emptyCopy: { fontSize: 13 },
});
