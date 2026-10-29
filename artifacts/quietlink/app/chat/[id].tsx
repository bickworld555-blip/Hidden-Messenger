import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { useMessages } from '@/context/MessageContext';
import { useColors } from '@/hooks/useColors';
import type { ChatMessage } from '@/context/MessageContext';

function MessageBubble({ message }: { message: ChatMessage }) {
  const colors = useColors();
  return (
    <View style={[styles.messageLine, message.outgoing ? styles.outgoingLine : styles.incomingLine]}>
      <View style={[
        styles.bubble,
        message.outgoing
          ? { backgroundColor: colors.primary, borderBottomRightRadius: 5 }
          : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderBottomLeftRadius: 5 },
      ]}>
        {message.imageUri ? <Image source={{ uri: message.imageUri }} style={styles.sharedImage} resizeMode="cover" /> : null}
        {message.imageUri ? null : <Text style={[styles.messageText, { color: message.outgoing ? colors.primaryForeground : colors.foreground }]}>{message.text}</Text>}
        {message.imageUri ? <Text style={[styles.imageCaption, { color: message.outgoing ? colors.primaryForeground : colors.foreground }]}>{message.text}</Text> : null}
        <View style={styles.messageMeta}>
          <Text style={[styles.messageTime, { color: message.outgoing ? 'rgba(255,255,255,0.72)' : colors.mutedForeground }]}>{message.time}</Text>
          {message.outgoing ? <Feather name={message.status === 'read' ? 'check' : 'check'} size={13} color="rgba(255,255,255,0.78)" /> : null}
        </View>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = String(params.id ?? '');
  const { threads, messages, sendMessage, sendPhoto, deleteThread, markRead, storageStatus } = useMessages();
  const thread = threads.find((item) => item.id === id);
  const conversationMessages = useMemo(() => messages.filter((message) => message.conversationId === id), [messages, id]);
  const [draft, setDraft] = useState('');
  const [attachmentOpen, setAttachmentOpen] = useState(false);

  useEffect(() => { markRead(id); }, [id, markRead]);

  if (!thread) {
    return (
      <View style={[styles.missing, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.foreground, fontSize: 16 }}>Conversation not found</Text>
        <Pressable onPress={() => router.back()}><Text style={{ color: colors.primary, marginTop: 12 }}>Go back</Text></Pressable>
      </View>
    );
  }

  const onSend = () => {
    if (!draft.trim()) return;
    sendMessage(id, draft);
    setDraft('');
  };

  const onDelete = () => Alert.alert(
    'Delete this conversation?',
    'This removes the sample conversation from this running preview. Secure database deletion is not available here.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteThread(id); router.back(); } },
    ],
  );

  const attachmentAction = async (label: string) => {
    setAttachmentOpen(false);
    if (label === 'Photo') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Photo access needed', 'Allow photo access to choose an image for this local preview.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.8 });
      if (!result.canceled && result.assets[0]) sendPhoto(id, result.assets[0].uri);
      return;
    }
    Alert.alert(label, 'Media sharing is part of the UI preview; files are not uploaded or stored.');
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 6), borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back to chats">
          <Feather name="chevron-left" size={25} color={colors.primary} />
        </Pressable>
        <Avatar initials={thread.initials} color={thread.color} size={39} />
        <View style={styles.headerCopy}>
          <Text numberOfLines={1} style={[styles.headerName, { color: colors.foreground }]}>{thread.name}</Text>
          <Text style={[styles.headerStatus, { color: colors.mutedForeground }]}>{thread.online ? 'Online · preview' : 'Private conversation'}</Text>
        </View>
        <Pressable onPress={() => router.push({ pathname: '/call/[id]', params: { id, name: thread.name, mode: 'audio' } })} hitSlop={10} accessibilityLabel="Start voice call">
          <Feather name="phone" size={19} color={colors.primary} />
        </Pressable>
        <Pressable onPress={() => router.push({ pathname: '/call/[id]', params: { id, name: thread.name, mode: 'video' } })} hitSlop={10} accessibilityLabel="Start video call" style={{ marginLeft: 15 }}>
          <Feather name="video" size={20} color={colors.primary} />
        </Pressable>
        <Pressable onPress={onDelete} hitSlop={10} accessibilityLabel="Delete conversation" style={{ marginLeft: 15 }}>
          <Feather name="more-vertical" size={19} color={colors.foreground} />
        </Pressable>
      </View>

      <View style={[styles.prototypeBanner, { backgroundColor: colors.accent }]}>
        <Feather name="lock" size={13} color={colors.primary} />
        <Text style={[styles.prototypeText, { color: colors.accentForeground }]}>
          {storageStatus === 'encrypted'
            ? 'Text saved in the encrypted vault · media preview only'
            : 'Preview conversation · nothing is sent or saved'}
        </Text>
      </View>

      <FlatList
        inverted
        data={[...conversationMessages].reverse()}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        contentContainerStyle={styles.messagesContent}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<View style={{ height: 10 }} />}
      />

      {attachmentOpen ? (
        <View style={[styles.attachmentPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {[
            { icon: 'image' as const, label: 'Photo' },
            { icon: 'file' as const, label: 'File' },
            { icon: 'map-pin' as const, label: 'Location' },
            { icon: 'mic' as const, label: 'Voice note' },
          ].map((item) => (
            <Pressable key={item.label} onPress={() => attachmentAction(item.label)} style={styles.attachmentOption}>
              <View style={[styles.attachmentIcon, { backgroundColor: colors.accent }]}><Feather name={item.icon} size={17} color={colors.primary} /></View>
              <Text style={[styles.attachmentLabel, { color: colors.foreground }]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 8), borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <Pressable onPress={() => setAttachmentOpen((value) => !value)} style={styles.composerIcon} accessibilityLabel="Open attachment options">
          <Feather name={attachmentOpen ? 'x' : 'plus'} size={22} color={colors.primary} />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
          multiline
          maxLength={2000}
          accessibilityLabel="Message"
          onFocus={() => setAttachmentOpen(false)}
        />
        {draft.trim() ? (
          <Pressable onPress={onSend} style={[styles.sendButton, { backgroundColor: colors.primary }]} accessibilityLabel="Send message">
            <Feather name="arrow-up" size={19} color={colors.primaryForeground} />
          </Pressable>
        ) : (
          <Pressable onPress={() => attachmentAction('Voice message')} style={styles.composerIcon} accessibilityLabel="Record voice message">
            <Feather name="mic" size={20} color={colors.primary} />
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 98, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  headerCopy: { flex: 1, gap: 3 },
  headerName: { fontSize: 14, fontWeight: '700' },
  headerStatus: { fontSize: 10.5 },
  prototypeBanner: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  prototypeText: { fontSize: 10, fontWeight: '600' },
  messagesContent: { paddingHorizontal: 15, paddingTop: 12, paddingBottom: 14 },
  messageLine: { width: '100%', marginVertical: 4 },
  incomingLine: { alignItems: 'flex-start' },
  outgoingLine: { alignItems: 'flex-end' },
  bubble: { maxWidth: '84%', borderRadius: 18, paddingHorizontal: 13, paddingTop: 9, paddingBottom: 6, minWidth: 95 },
  sharedImage: { width: 225, height: 190, borderRadius: 12, maxWidth: '100%' },
  imageCaption: { fontSize: 12, marginTop: 7 },
  messageText: { fontSize: 14, lineHeight: 20 },
  messageMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 },
  messageTime: { fontSize: 9 },
  composerWrap: { minHeight: 59, flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 11, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  composerIcon: { width: 34, height: 39, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 39, maxHeight: 110, borderRadius: 19, borderWidth: 1, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 8, fontSize: 14 },
  sendButton: { width: 37, height: 37, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 1 },
  attachmentPanel: { borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderTopLeftRadius: 18, borderTopRightRadius: 18, flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 15, marginHorizontal: 10 },
  attachmentOption: { alignItems: 'center', gap: 6, minWidth: 54 },
  attachmentIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  attachmentLabel: { fontSize: 10 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
