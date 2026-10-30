import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Linking, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { useMessages, type ChatThread } from '@/context/MessageContext';
import { useColors } from '@/hooks/useColors';
import {
  getLocalContactPermission,
  readLocalPhoneContacts,
  requestLocalContactPermission,
  type LocalContactPermission,
  type LocalPhoneContact,
} from '@/services/localContacts';

export default function NewChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { threads } = useMessages();
  const [query, setQuery] = useState('');
  const [permission, setPermission] = useState<LocalContactPermission>({ status: 'undetermined', canAskAgain: true });
  const [contacts, setContacts] = useState<LocalPhoneContact[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshContacts = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const currentPermission = await getLocalContactPermission();
      setPermission(currentPermission);
      if (currentPermission.status === 'granted' || currentPermission.status === 'limited') {
        setContacts(await readLocalPhoneContacts());
      } else {
        setContacts([]);
      }
    } catch {
      setError('Hidden Messenger could not read contacts on this device.');
      setContacts([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshContacts();
  }, [refreshContacts]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshContacts();
    });
    return () => subscription.remove();
  }, [refreshContacts]);

  const filteredThreads = useMemo(() => threads.filter((thread) => (
    thread.name.toLowerCase().includes(query.toLowerCase())
    || thread.lastMessage.toLowerCase().includes(query.toLowerCase())
  )), [threads, query]);
  const filteredContacts = useMemo(() => contacts.filter((contact) => (
    contact.name.toLowerCase().includes(query.toLowerCase())
    || contact.phoneNumber.toLowerCase().includes(query.toLowerCase())
  )), [contacts, query]);

  const allowContacts = async () => {
    setBusy(true);
    setError(null);
    try {
      const requested = await requestLocalContactPermission();
      setPermission(requested);
      if (requested.status === 'granted' || requested.status === 'limited') {
        setContacts(await readLocalPhoneContacts());
      }
    } catch {
      setError('Contact access could not be enabled. You can still open an existing conversation.');
    } finally {
      setBusy(false);
    }
  };

  const openSettings = async () => {
    try {
      await Linking.openSettings();
    } catch {
      setError('Device settings could not be opened from this build.');
    }
  };

  const invite = async (contact: LocalPhoneContact) => {
    setError(null);
    const recipient = contact.phoneNumber.replace(/[^\d+]/g, '');
    const message = `I'm using Hidden Messenger. Join me when you have it so we can connect privately.`;
    const body = encodeURIComponent(message);
    const separator = Platform.OS === 'ios' ? '&' : '?';
    try {
      await Linking.openURL(`sms:${recipient}${separator}body=${body}`);
    } catch {
      try {
        await Share.share({ message });
      } catch {
        setError(`Could not open an invitation for ${contact.name}.`);
      }
    }
  };

  const openConversation = (thread: ChatThread) => {
    router.replace({ pathname: '/chat/[id]', params: { id: thread.id } });
  };

  const listHeader = (
    <View>
      <Text style={[styles.note, { color: colors.mutedForeground }]}>
        Contact details stay on this device. Membership is not checked, and the address book is never uploaded.
      </Text>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>Recent conversations</Text>
      {filteredThreads.length ? filteredThreads.map((thread) => (
        <Pressable
          key={thread.id}
          onPress={() => openConversation(thread)}
          style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.secondary : colors.background }]}
          accessibilityRole="button"
          accessibilityLabel={`Open conversation with ${thread.name}`}
        >
          <Avatar initials={thread.initials} color={thread.color} size={46} />
          <View style={[styles.copy, { borderBottomColor: colors.border }]}>
            <Text numberOfLines={1} style={[styles.name, { color: colors.foreground }]}>{thread.name}</Text>
            <Text numberOfLines={1} style={[styles.detail, { color: colors.mutedForeground }]}>{thread.lastMessage}</Text>
          </View>
          <Text style={[styles.openLabel, { color: colors.primary }]}>Open</Text>
        </Pressable>
      )) : <Text style={[styles.emptyRecent, { color: colors.mutedForeground }]}>No matching conversations.</Text>}

      <View style={styles.contactHeading}>
        <Text style={[styles.sectionTitle, styles.contactSectionTitle, { color: colors.mutedForeground }]}>Contacts on this device</Text>
        {permission.status === 'granted' || permission.status === 'limited'
          ? <Text style={[styles.count, { color: colors.mutedForeground }]}>{contacts.length}</Text>
          : null}
      </View>

      {permission.status === 'unavailable' ? (
        <View style={[styles.permissionCard, { backgroundColor: colors.secondary }]}>
          <Feather name="smartphone" size={18} color={colors.primary} />
          <Text style={[styles.permissionCopy, { color: colors.secondaryForeground }]}>Contact browsing is available in the Android and iOS apps. Existing conversations remain available here.</Text>
        </View>
      ) : permission.status === 'denied' && !permission.canAskAgain ? (
        <Pressable onPress={() => void openSettings()} style={[styles.permissionCard, { backgroundColor: colors.secondary }]}>
          <Feather name="settings" size={18} color={colors.primary} />
          <Text style={[styles.permissionAction, { color: colors.primary }]}>Open device settings to allow contacts</Text>
        </Pressable>
      ) : permission.status !== 'granted' && permission.status !== 'limited' ? (
        <Pressable onPress={() => void allowContacts()} disabled={busy} style={[styles.permissionCard, { backgroundColor: colors.secondary, opacity: busy ? 0.65 : 1 }]}>
          {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="users" size={18} color={colors.primary} />}
          <Text style={[styles.permissionAction, { color: colors.primary }]}>{busy ? 'Loading contacts…' : 'Allow on-device contacts'}</Text>
        </Pressable>
      ) : null}

      {error ? <Text style={[styles.error, { color: '#C34F58' }]}>{error}</Text> : null}
      {busy && (permission.status === 'granted' || permission.status === 'limited')
        ? <View style={styles.loading}><ActivityIndicator size="small" color={colors.primary} /></View>
        : null}
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 12) }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.foreground }]}>Select contact</Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
            {permission.status === 'granted' || permission.status === 'limited' ? `${contacts.length} contacts` : 'Local contacts only'}
          </Text>
        </View>
        <Feather name="search" size={20} color={colors.foreground} />
      </View>
      <View style={[styles.searchBox, { backgroundColor: colors.secondary }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search contacts"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.searchInput, { color: colors.foreground }]}
          accessibilityLabel="Search contacts and conversations"
        />
        {query ? <Pressable onPress={() => setQuery('')} hitSlop={8}><Feather name="x-circle" size={16} color={colors.mutedForeground} /></Pressable> : null}
      </View>
      <FlatList
        data={permission.status === 'granted' || permission.status === 'limited' ? filteredContacts : []}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={permission.status === 'granted' || permission.status === 'limited'
          ? <Text style={[styles.emptyContacts, { color: colors.mutedForeground }]}>{busy ? '' : 'No phone contacts found.'}</Text>
          : undefined}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Avatar initials={item.name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase()} color="#839E9A" size={46} />
            <View style={[styles.copy, { borderBottomColor: colors.border }]}>
              <Text numberOfLines={1} style={[styles.name, { color: colors.foreground }]}>{item.name}</Text>
              <Text numberOfLines={1} style={[styles.detail, { color: colors.mutedForeground }]}>{item.phoneNumber}</Text>
            </View>
            <Pressable
              onPress={() => void invite(item)}
              style={styles.inviteButton}
              accessibilityRole="button"
              accessibilityLabel={`Invite ${item.name} by SMS`}
            >
              <Text style={[styles.inviteLabel, { color: colors.primary }]}>Invite</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 19 },
  headerCopy: { flex: 1, gap: 2 },
  title: { fontSize: 17, fontWeight: '700' },
  headerSubtitle: { fontSize: 11 },
  searchBox: { height: 43, flexDirection: 'row', alignItems: 'center', gap: 9, marginHorizontal: 17, marginBottom: 7, paddingHorizontal: 12, borderRadius: 13 },
  searchInput: { flex: 1, height: '100%', fontSize: 13 },
  note: { paddingHorizontal: 18, paddingTop: 9, paddingBottom: 13, fontSize: 11, lineHeight: 16 },
  sectionTitle: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 5, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  contactHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginRight: 18 },
  contactSectionTitle: { paddingBottom: 7 },
  count: { fontSize: 11 },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 12 },
  copy: { flex: 1, minHeight: 68, justifyContent: 'center', gap: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 14, fontWeight: '600' },
  detail: { fontSize: 11 },
  openLabel: { fontSize: 11, fontWeight: '700', paddingHorizontal: 7 },
  inviteButton: { minWidth: 54, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  inviteLabel: { fontSize: 13, fontWeight: '700' },
  permissionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 18, marginVertical: 8, padding: 14, borderRadius: 13 },
  permissionCopy: { flex: 1, fontSize: 11, lineHeight: 16 },
  permissionAction: { fontSize: 12, fontWeight: '700' },
  error: { marginHorizontal: 18, marginTop: 5, fontSize: 11, lineHeight: 15 },
  loading: { paddingVertical: 11 },
  emptyRecent: { paddingHorizontal: 18, paddingVertical: 10, fontSize: 11 },
  emptyContacts: { paddingHorizontal: 18, paddingVertical: 16, fontSize: 12, textAlign: 'center' },
});
