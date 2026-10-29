import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import {
  deleteLocalConversation as deleteSecureConversation,
  ensureLocalConversation,
  listAllLocalMessages,
  listLocalConversations,
  openSecureChatDatabase,
  saveLocalMessage,
  updateLocalUnread,
} from '@/storage/secureChatDb';

export type ChatMessage = {
  id: string;
  conversationId: string;
  text: string;
  imageUri?: string;
  time: string;
  outgoing: boolean;
  status: 'queued' | 'sent' | 'delivered' | 'read';
};

export type ChatThread = {
  id: string;
  name: string;
  initials: string;
  color: string;
  online?: boolean;
  lastMessage: string;
  time: string;
  unread: number;
  pinned?: boolean;
  group?: boolean;
};

const initialThreads: ChatThread[] = [
  { id: 'maya', name: 'Maya Chen', initials: 'MC', color: '#D7A68F', online: true, lastMessage: 'That little café by the water?', time: '9:41', unread: 2, pinned: true },
  { id: 'design', name: 'Design Circle', initials: 'DC', color: '#84AFA6', lastMessage: 'Noah: I sent the updated board', time: '9:26', unread: 4, pinned: true, group: true },
  { id: 'eli', name: 'Eli Morgan', initials: 'EM', color: '#A399C5', lastMessage: 'Voice message · 0:18', time: 'Yesterday', unread: 0 },
  { id: 'family', name: 'Weekend crew', initials: 'WC', color: '#D49B7E', lastMessage: 'You: see you Saturday', time: 'Yesterday', unread: 0, group: true },
  { id: 'sam', name: 'Samira Rahman', initials: 'SR', color: '#82A2B3', lastMessage: 'Photo', time: 'Tue', unread: 0 },
  { id: 'jules', name: 'Jules Park', initials: 'JP', color: '#C995AD', lastMessage: 'Thanks for checking in', time: 'Mon', unread: 0 },
  { id: 'omar', name: 'Omar Haddad', initials: 'OH', color: '#B79C68', lastMessage: 'Are we still on for Friday?', time: 'Sun', unread: 0 },
];

const initialMessages: ChatMessage[] = [
  { id: 'm1', conversationId: 'maya', text: 'Morning! Did you get a chance to look at the weekend plans?', time: '9:32', outgoing: false, status: 'read' },
  { id: 'm2', conversationId: 'maya', text: 'Just did. Saturday looks perfect.', time: '9:35', outgoing: true, status: 'read' },
  { id: 'm3', conversationId: 'maya', text: 'I found a quiet little café by the water too.', time: '9:38', outgoing: false, status: 'read' },
  { id: 'm4', conversationId: 'maya', text: 'That sounds like exactly what we need.', time: '9:39', outgoing: true, status: 'read' },
  { id: 'm5', conversationId: 'maya', text: 'That little café by the water?', time: '9:41', outgoing: false, status: 'read' },
  { id: 'd1', conversationId: 'design', text: 'I added the notes from yesterday’s review.', time: '9:13', outgoing: false, status: 'read' },
  { id: 'd2', conversationId: 'design', text: 'Great, I’ll take a look before lunch.', time: '9:18', outgoing: true, status: 'delivered' },
  { id: 'd3', conversationId: 'design', text: 'Noah: I sent the updated board', time: '9:26', outgoing: false, status: 'read' },
];

type MessageContextValue = {
  threads: ChatThread[];
  messages: ChatMessage[];
  storageStatus: 'loading' | 'encrypted' | 'memory-only';
  storageError: string | null;
  sendMessage: (conversationId: string, text: string) => void;
  sendPhoto: (conversationId: string, imageUri: string) => void;
  startConversation: (thread: ChatThread) => void;
  deleteThread: (conversationId: string) => void;
  markRead: (conversationId: string) => void;
};

const MessageContext = createContext<MessageContextValue | null>(null);

export function MessageProvider({ children }: { children: React.ReactNode }) {
  const [threads, setThreads] = useState<ChatThread[]>(initialThreads);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [storageStatus, setStorageStatus] = useState<MessageContextValue['storageStatus']>('loading');
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const hydrate = async () => {
      try {
        await openSecureChatDatabase();
        let storedThreads = await listLocalConversations();
        if (storedThreads.length === 0) {
          const seedTime = Date.now();
          for (const thread of initialThreads) {
            await ensureLocalConversation({
              id: thread.id,
              title: thread.name,
              initials: thread.initials,
              color: thread.color,
              online: thread.online,
              lastMessage: thread.lastMessage,
              lastTime: thread.time,
              unread: thread.unread,
              pinned: thread.pinned,
              group: thread.group,
            });
          }
          for (const [index, message] of initialMessages.entries()) {
            await saveLocalMessage({
              id: message.id,
              conversationId: message.conversationId,
              body: message.text,
              createdAt: seedTime + index,
              direction: message.outgoing ? 'outgoing' : 'incoming',
              deliveryState: message.status,
            });
          }
          storedThreads = await listLocalConversations();
        }
        const storedMessages = await listAllLocalMessages();
        if (disposed) return;
        setThreads(storedThreads.map((thread) => ({
          id: thread.id,
          name: thread.title,
          initials: thread.initials,
          color: thread.color,
          online: Boolean(thread.online),
          lastMessage: thread.last_message,
          time: thread.last_time,
          unread: thread.unread_count,
          pinned: Boolean(thread.is_pinned),
          group: Boolean(thread.is_group),
        })));
        setMessages(storedMessages.map((message) => ({
          id: message.id,
          conversationId: message.conversation_id,
          text: message.body,
          time: new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
          outgoing: message.direction === 'outgoing',
          status: message.delivery_state,
        })));
        setStorageStatus('encrypted');
      } catch (error) {
        if (disposed) return;
        setStorageStatus('memory-only');
        setStorageError(error instanceof Error ? error.message : 'Encrypted storage is unavailable.');
      }
    };
    void hydrate();
    return () => { disposed = true; };
  }, []);

  const value = useMemo<MessageContextValue>(() => ({
    threads,
    messages,
    storageStatus,
    storageError,
    sendMessage: (conversationId, text) => {
      const cleanText = text.trim();
      if (!cleanText) return;
      const now = new Date();
      const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const message: ChatMessage = {
        id: `${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
        conversationId,
        text: cleanText,
        time,
        outgoing: true,
        status: 'sent',
      };
      setMessages((current) => [...current, message]);
      setThreads((current) => current.map((thread) => thread.id === conversationId
        ? { ...thread, lastMessage: cleanText, time, unread: 0 }
        : thread));
      if (storageStatus === 'encrypted') {
        const thread = threads.find((item) => item.id === conversationId);
        if (thread) {
          void ensureLocalConversation({
            id: thread.id,
            title: thread.name,
            initials: thread.initials,
            color: thread.color,
            online: thread.online,
            lastMessage: cleanText,
            lastTime: time,
            unread: 0,
            pinned: thread.pinned,
            group: thread.group,
          }).then(() => saveLocalMessage({
            id: message.id,
            conversationId,
            body: cleanText,
            createdAt: now.getTime(),
            direction: 'outgoing',
            deliveryState: 'sent',
          })).catch((error: unknown) => {
            setStorageStatus('memory-only');
            setStorageError(error instanceof Error ? error.message : 'Could not persist the message to the encrypted vault.');
          });
        }
      }
    },
    sendPhoto: (conversationId, imageUri) => {
      const now = new Date();
      const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      setMessages((current) => [...current, {
        id: `${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
        conversationId,
        text: 'Photo',
        imageUri,
        time,
        outgoing: true,
        status: 'sent',
      }]);
      setThreads((current) => current.map((thread) => thread.id === conversationId
        ? { ...thread, lastMessage: 'Photo', time, unread: 0 }
        : thread));
    },
    startConversation: (thread) => {
      setThreads((current) => current.some((item) => item.id === thread.id) ? current : [thread, ...current]);
      if (storageStatus === 'encrypted') {
        void ensureLocalConversation({
          id: thread.id,
          title: thread.name,
          initials: thread.initials,
          color: thread.color,
          online: thread.online,
          lastMessage: thread.lastMessage,
          lastTime: thread.time,
          unread: thread.unread,
          pinned: thread.pinned,
          group: thread.group,
        }).catch((error: unknown) => {
          setStorageStatus('memory-only');
          setStorageError(error instanceof Error ? error.message : 'Could not save the conversation to the encrypted vault.');
        });
      }
    },
    deleteThread: (conversationId) => {
      setThreads((current) => current.filter((thread) => thread.id !== conversationId));
      setMessages((current) => current.filter((message) => message.conversationId !== conversationId));
      if (storageStatus === 'encrypted') {
        void deleteSecureConversation(conversationId).catch((error: unknown) => {
          setStorageStatus('memory-only');
          setStorageError(error instanceof Error ? error.message : 'Could not delete the conversation from the encrypted vault.');
        });
      }
    },
    markRead: (conversationId) => {
      setThreads((current) => {
        if (!current.some((thread) => thread.id === conversationId && thread.unread > 0)) return current;
        return current.map((thread) => thread.id === conversationId ? { ...thread, unread: 0 } : thread);
      });
      if (storageStatus === 'encrypted') {
        void updateLocalUnread(conversationId, 0).catch((error: unknown) => {
          setStorageStatus('memory-only');
          setStorageError(error instanceof Error ? error.message : 'Could not update the conversation in the encrypted vault.');
        });
      }
    },
  }), [threads, messages, storageStatus, storageError]);

  if (storageStatus === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F7F6', gap: 12 }}>
        <ActivityIndicator color="#087E70" />
        <Text style={{ color: '#71817D', fontSize: 12 }}>Checking local storage…</Text>
      </View>
    );
  }

  return <MessageContext.Provider value={value}>{children}</MessageContext.Provider>;
}

export function useMessages() {
  const context = useContext(MessageContext);
  if (!context) throw new Error('useMessages must be used inside MessageProvider');
  return context;
}
