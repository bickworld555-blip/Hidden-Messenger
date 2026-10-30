import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { VoiceNotePanel } from '@/components/VoiceNotePanel';
import { SOUND_ASSETS } from '@/components/SoundPreviewButton';
import { useAppSettings } from '@/context/AppSettingsContext';
import { useMessages } from '@/context/MessageContext';
import { useColors } from '@/hooks/useColors';
import type { ChatMessage } from '@/context/MessageContext';
import { pickAndEncryptLocalMedia, type LocalMediaKind } from '@/storage/secureMedia';
import { requestDevicePermission } from '@/services/devicePermissions';
import { useAudioPlayer } from 'expo-audio';

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
        {message.imageUri ? (
          <View style={[styles.lockedMedia, { backgroundColor: colors.secondary }]}>
            <Feather name="lock" size={18} color={colors.primary} />
            <Text style={[styles.lockedMediaText, { color: colors.secondaryForeground }]}>Encrypted media preview unavailable</Text>
          </View>
        ) : null}
        {message.imageUri ? null : <Text style={[styles.messageText, { color: message.outgoing ? colors.primaryForeground : colors.foreground }]}>{message.text}</Text>}
        {message.imageUri && message.text ? <Text style={[styles.imageCaption, { color: message.outgoing ? colors.primaryForeground : colors.foreground }]}>{message.text}</Text> : null}
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
  const { threads, messages, sendMessage, deleteThread, markRead, storageStatus, messagingStatus } = useMessages();
  const { settings } = useAppSettings();
  const thread = threads.find((item) => item.id === id);
  const conversationMessages = useMemo(() => messages.filter((message) => message.conversationId === id), [messages, id]);
  const [draft, setDraft] = useState('');
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const sentSoundPlayer = useAudioPlayer(SOUND_ASSETS.sent);

  useEffect(() => { markRead(id); }, [id, markRead]);

  if (!thread) {
    return (
      <View style={[styles.missing, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.foreground, fontSize: 16 }}>Conversation not found</Text>
        <Pressable onPress={() => router.back()}><Text style={{ color: colors.primary, marginTop: 12 }}>Go back</Text></Pressable>
      </View>
    );
  }

  const onSend = async () => {
    if (!draft.trim() || messagingStatus !== 'ready') return;
    const sent = await sendMessage(id, draft);
    if (sent) {
      setDraft('');
      if (settings.chatSoundsEnabled) sentSoundPlayer.play();
    }
  };

  const checkMicrophoneForVoiceNotes = async (): Promise<boolean> => {
    try {
      const permission = await requestDevicePermission('microphone');
      if (permission.status === 'granted') return true;
      if (permission.status === 'unavailable') {
        Alert.alert('Microphone unavailable', 'Request microphone access from the native iOS or Android app. This web preview cannot record securely.');
      } else if (permission.status === 'denied' && !permission.canAskAgain) {
        Alert.alert('Microphone access denied', 'Open Hidden Messenger in device settings to allow microphone access.');
      } else {
        Alert.alert('Microphone access needed', 'Allow microphone access to record a local encrypted voice note.');
      }
    } catch {
      Alert.alert('Microphone unavailable', 'Hidden Messenger could not check microphone permission.');
    }
    return false;
  };

  const onDelete = () => Alert.alert(
    'Delete this conversation?',
    'This removes the conversation and its local media keys. Encrypted files may remain in flash storage; secure overwrite cannot be guaranteed.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteThread(id); router.back(); } },
    ],
  );

  const attachmentAction = async (kind: LocalMediaKind, label: string) => {
    setAttachmentOpen(false);
    if (storageStatus !== 'encrypted') {
      Alert.alert('Encrypted storage unavailable', 'Local media import requires the native SQLCipher vault. No plaintext fallback is available.');
      return;
    }
    if (mediaBusy) return;
    setMediaBusy(true);
    try {
      const saved = await pickAndEncryptLocalMedia(id, kind);
      if (saved) {
        const sizeMb = (saved.plaintextBytes / (1024 * 1024)).toFixed(1);
        Alert.alert(
          'Saved encrypted on this device',
          `${label} (${sizeMb} MB) was encrypted locally. It was not sent; media sharing remains locked pending E2EE review.`,
        );
      }
    } catch (error) {
      Alert.alert(
        'Could not save media',
        error instanceof Error ? error.message : 'Local media encryption failed. No plaintext cache fallback was used.',
      );
    } finally {
      setMediaBusy(false);
    }
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
        <Pressable onPress={() => router.push({ pathname: '/call/[id]', params: { id, name: thread.name, mode: 'audio', role: 'host' } })} hitSlop={10} accessibilityLabel="Start verified voice call">
          <Feather name="phone" size={19} color={colors.primary} />
        </Pressable>
        <Pressable onPress={() => router.push({ pathname: '/call/[id]', params: { id, name: thread.name, mode: 'video', role: 'host' } })} hitSlop={10} accessibilityLabel="Start verified video call" style={{ marginLeft: 15 }}>
          <Feather name="video" size={20} color={colors.primary} />
        </Pressable>
        <Pressable onPress={onDelete} hitSlop={10} accessibilityLabel="Delete conversation" style={{ marginLeft: 15 }}>
          <Feather name="more-vertical" size={19} color={colors.foreground} />
        </Pressable>
      </View>

      <View style={[styles.prototypeBanner, { backgroundColor: colors.accent }]}>
        <Feather name="lock" size={13} color={colors.primary} />
        <Text style={[styles.prototypeText, { color: colors.accentForeground }]}>
          {messagingStatus === 'locked'
            ? storageStatus === 'encrypted'
              ? 'Text messages stay on this device · QR-verified WebRTC calls are separate'
              : 'Text messages are unavailable · local media requires native SQLCipher'
            : 'Secure messaging enabled'}
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
            { icon: 'image' as const, label: 'Photo', kind: 'image' as const },
            { icon: 'video' as const, label: 'Video', kind: 'video' as const },
            { icon: 'headphones' as const, label: 'Audio', kind: 'audio' as const },
          ].map((item) => (
            <Pressable
              key={item.label}
              onPress={() => void attachmentAction(item.kind, item.label)}
              style={[styles.attachmentOption, mediaBusy && { opacity: 0.55 }]}
              disabled={mediaBusy || storageStatus !== 'encrypted'}
              accessibilityLabel={`Encrypt ${item.label.toLowerCase()} locally`}
            >
              <View style={[styles.attachmentIcon, { backgroundColor: colors.accent }]}><Feather name={item.icon} size={17} color={colors.primary} /></View>
              <Text style={[styles.attachmentLabel, { color: colors.foreground }]}>{mediaBusy ? 'Encrypting' : item.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {voicePanelOpen ? (
        <VoiceNotePanel
          conversationId={id}
          storageReady={storageStatus === 'encrypted'}
          onCheckMicrophone={checkMicrophoneForVoiceNotes}
          onClose={() => setVoicePanelOpen(false)}
        />
      ) : null}

      <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 8), borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <Pressable onPress={() => setAttachmentOpen((value) => !value)} style={styles.composerIcon} disabled={storageStatus !== 'encrypted' || mediaBusy} accessibilityLabel="Open local media options">
          <Feather name={attachmentOpen ? 'x' : 'plus'} size={22} color={storageStatus === 'encrypted' ? colors.primary : colors.mutedForeground} />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={messagingStatus === 'locked' ? 'Text messaging unavailable' : 'Message'}
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
          multiline
          maxLength={2000}
          editable={messagingStatus === 'ready'}
          accessibilityLabel="Message"
          onFocus={() => setAttachmentOpen(false)}
        />
        {draft.trim() ? (
          <Pressable onPress={onSend} disabled={messagingStatus !== 'ready'} style={[styles.sendButton, { backgroundColor: messagingStatus === 'ready' ? colors.primary : colors.muted }]} accessibilityLabel="Send message">
            <Feather name="arrow-up" size={19} color={colors.primaryForeground} />
          </Pressable>
        ) : (
          <Pressable onPress={() => { setVoicePanelOpen((value) => !value); setAttachmentOpen(false); }} style={styles.composerIcon} disabled={mediaBusy} accessibilityLabel="Open voice note controls">
            <Feather name={voicePanelOpen ? 'x' : 'mic'} size={20} color={colors.primary} />
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
  lockedMedia: { width: 225, minHeight: 96, maxWidth: '100%', borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14 },
  lockedMediaText: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
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
