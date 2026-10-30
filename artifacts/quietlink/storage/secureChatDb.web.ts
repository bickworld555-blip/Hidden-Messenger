export type LocalConversation = {
  id: string;
  title: string;
  initials: string;
  color: string;
  online: number;
  last_message: string;
  last_time: string;
  unread_count: number;
  is_pinned: number;
  is_group: number;
};

export type LocalVoiceNoteSummary = {
  id: string;
  conversation_id: string;
  sample_rate: number;
  channels: number;
  total_bytes: number;
  chunk_count: number;
  created_at: number;
};

const unavailable = () => new Error('Encrypted chat storage requires the native iOS or Android SQLCipher build.');

export async function openSecureChatDatabase(): Promise<never> {
  throw unavailable();
}

export async function shouldSeedDemoContent(): Promise<never> {
  throw unavailable();
}

export async function saveLocalMessage(): Promise<never> {
  throw unavailable();
}

export async function ensureLocalConversation(): Promise<never> {
  throw unavailable();
}

export async function listLocalConversations(): Promise<LocalConversation[]> {
  throw unavailable();
}

export async function listAllLocalMessages(): Promise<never[]> {
  throw unavailable();
}

export async function listLocalMessages(): Promise<never[]> {
  throw unavailable();
}

export async function updateLocalUnread(): Promise<never> {
  throw unavailable();
}

export async function saveLocalMediaAttachment(): Promise<never> {
  throw unavailable();
}

export async function getLocalMediaAttachment(): Promise<never> {
  throw unavailable();
}

export async function listLocalMediaAttachments(): Promise<never[]> {
  throw unavailable();
}

export async function saveLocalVoiceNote(): Promise<never> {
  throw unavailable();
}

export async function getLocalVoiceNote(): Promise<never> {
  throw unavailable();
}

export async function listLocalVoiceNotes(): Promise<never[]> {
  throw unavailable();
}

export async function deleteLocalVoiceNote(): Promise<never> {
  throw unavailable();
}

export async function deleteLocalConversation(): Promise<never> {
  throw unavailable();
}

export async function destroyLocalVault(): Promise<never> {
  throw unavailable();
}
