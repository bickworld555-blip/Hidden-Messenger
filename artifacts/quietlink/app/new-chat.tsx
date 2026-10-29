import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { useMessages, type ChatThread } from '@/context/MessageContext';
import { useColors } from '@/hooks/useColors';

const contacts: ChatThread[] = [
  { id: 'nina', name: 'Nina Patel', initials: 'NP', color: '#A9A077', lastMessage: 'Start a private conversation', time: '', unread: 0, online: true },
  { id: 'leo', name: 'Leo Santos', initials: 'LS', color: '#7E9DB4', lastMessage: 'Start a private conversation', time: '', unread: 0 },
  { id: 'aria', name: 'Aria Wilson', initials: 'AW', color: '#C58E94', lastMessage: 'Start a private conversation', time: '', unread: 0 },
  { id: 'dev', name: 'Dev Mehta', initials: 'DM', color: '#8AA98A', lastMessage: 'Start a private conversation', time: '', unread: 0 },
];

export default function NewChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { startConversation } = useMessages();
  const open = (contact: ChatThread) => {
    startConversation(contact);
    router.replace({ pathname: '/chat/[id]', params: { id: contact.id } });
  };
  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 12) }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Close">
          <Feather name="x" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>New conversation</Text>
        <View style={{ width: 24 }} />
      </View>
      <Text style={[styles.note, { color: colors.mutedForeground }]}>Sample contacts for the preview. A real account directory is not connected.</Text>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}>
        {contacts.map((contact) => (
          <Pressable key={contact.id} onPress={() => open(contact)} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.secondary : colors.background }]}>
            <Avatar initials={contact.initials} color={contact.color} size={48} />
            <View style={[styles.copy, { borderBottomColor: colors.border }]}>
              <Text style={[styles.name, { color: colors.foreground }]}>{contact.name}</Text>
              <Text style={[styles.detail, { color: colors.mutedForeground }]}>Hidden Messenger ID not verified</Text>
            </View>
            <Feather name="message-circle" size={19} color={colors.primary} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 19 },
  title: { fontSize: 18, fontWeight: '700' },
  note: { paddingHorizontal: 20, paddingBottom: 12, fontSize: 12, lineHeight: 17 },
  row: { minHeight: 70, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 13 },
  copy: { flex: 1, minHeight: 70, justifyContent: 'center', gap: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 14, fontWeight: '600' },
  detail: { fontSize: 11 },
});
