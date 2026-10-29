import { Platform } from 'react-native';

const DATABASE_NAME = 'quietlink-vault.db';
const KEY_ALIAS = 'quietlink.sqlcipher.key.v1';
const DEMO_SUPPRESSED_KEY = 'quietlink.demo-suppressed.v1';

type SQLiteDatabase = import('expo-sqlite').SQLiteDatabase;

let databasePromise: Promise<SQLiteDatabase> | null = null;

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

export async function shouldSeedDemoContent() {
  const SecureStore = await import('expo-secure-store');
  return (await SecureStore.getItemAsync(DEMO_SUPPRESSED_KEY)) !== 'true';
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function getOrCreateDatabaseKey() {
  const SecureStore = await import('expo-secure-store');
  const Crypto = await import('expo-crypto');
  const existingKey = await SecureStore.getItemAsync(KEY_ALIAS);
  if (existingKey) {
    if (!/^[0-9a-f]{64}$/i.test(existingKey)) {
      throw new Error('Stored vault key has an invalid format. Refusing to open the database.');
    }
    return existingKey;
  }

  const key = toHex(await Crypto.getRandomBytesAsync(32));
  await SecureStore.setItemAsync(KEY_ALIAS, key);
  return key;
}

async function initializeDatabase() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error('The encrypted local vault is available only in an iOS or Android native build.');
  }

  const SQLite = await import('expo-sqlite');
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  try {
    const cipher = await database.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
    if (!cipher?.cipher_version) {
      throw new Error('SQLCipher is not present in this app binary. Use a rebuilt native app; never continue with plaintext SQLite.');
    }

    const key = await getOrCreateDatabaseKey();
    // The key is generated locally and accepted only as exactly 32 bytes encoded as hex.
    // SQLCipher PRAGMA key does not support bind parameters.
    await database.execAsync(`PRAGMA key = "x'${key}'"`);

    // Force a read so an incorrect key or a non-SQLCipher database fails closed.
    await database.getFirstAsync<{ name: string | null }>('SELECT name FROM sqlite_master LIMIT 1');
    await database.execAsync(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = DELETE;
      PRAGMA secure_delete = ON;
      PRAGMA temp_store = MEMORY;
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        initials TEXT NOT NULL,
        color TEXT NOT NULL,
        online INTEGER NOT NULL DEFAULT 0,
        last_message TEXT NOT NULL DEFAULT '',
        last_time TEXT NOT NULL DEFAULT '',
        unread_count INTEGER NOT NULL DEFAULT 0,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        is_group INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
        delivery_state TEXT NOT NULL CHECK (delivery_state IN ('queued', 'sent', 'delivered', 'read'))
      );
      CREATE INDEX IF NOT EXISTS messages_by_conversation_time
        ON messages(conversation_id, created_at);
      PRAGMA user_version = 1;
    `);
    return database;
  } catch (error) {
    await database.closeAsync();
    throw error;
  }
}

/**
 * Opens the local message vault only when this native binary includes SQLCipher.
 * Expo Go and web intentionally fail closed rather than silently storing plaintext.
 */
export function openSecureChatDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = initializeDatabase().catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

export async function saveLocalMessage(message: {
  id: string;
  conversationId: string;
  body: string;
  createdAt: number;
  direction: 'incoming' | 'outgoing';
  deliveryState: 'queued' | 'sent' | 'delivered' | 'read';
}) {
  const db = await openSecureChatDatabase();
  await db.runAsync(
    `INSERT INTO messages (id, conversation_id, body, created_at, direction, delivery_state)
     VALUES (?, ?, ?, ?, ?, ?)`,
    message.id,
    message.conversationId,
    message.body,
    message.createdAt,
    message.direction,
    message.deliveryState,
  );
}

export async function ensureLocalConversation(conversation: {
  id: string;
  title: string;
  initials: string;
  color: string;
  online?: boolean;
  lastMessage?: string;
  lastTime?: string;
  unread?: number;
  pinned?: boolean;
  group?: boolean;
}) {
  const db = await openSecureChatDatabase();
  await db.runAsync(
    `INSERT INTO conversations (
      id, title, initials, color, online, last_message, last_time, unread_count, is_pinned, is_group, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      initials = excluded.initials,
      color = excluded.color,
      online = excluded.online,
      last_message = excluded.last_message,
      last_time = excluded.last_time,
      unread_count = excluded.unread_count,
      is_pinned = excluded.is_pinned,
      is_group = excluded.is_group`,
    conversation.id,
    conversation.title,
    conversation.initials,
    conversation.color,
    conversation.online ? 1 : 0,
    conversation.lastMessage ?? '',
    conversation.lastTime ?? '',
    conversation.unread ?? 0,
    conversation.pinned ? 1 : 0,
    conversation.group ? 1 : 0,
    Date.now(),
  );
}

export async function listLocalConversations() {
  const db = await openSecureChatDatabase();
  return db.getAllAsync<LocalConversation>(
    'SELECT id, title, initials, color, online, last_message, last_time, unread_count, is_pinned, is_group FROM conversations ORDER BY created_at ASC',
  );
}

export async function listLocalMessages(conversationId: string) {
  const db = await openSecureChatDatabase();
  return db.getAllAsync<{
    id: string;
    conversation_id: string;
    body: string;
    created_at: number;
    direction: 'incoming' | 'outgoing';
    delivery_state: 'queued' | 'sent' | 'delivered' | 'read';
  }>(
    'SELECT id, conversation_id, body, created_at, direction, delivery_state FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    conversationId,
  );
}

export async function listAllLocalMessages() {
  const db = await openSecureChatDatabase();
  return db.getAllAsync<{
    id: string;
    conversation_id: string;
    body: string;
    created_at: number;
    direction: 'incoming' | 'outgoing';
    delivery_state: 'queued' | 'sent' | 'delivered' | 'read';
  }>('SELECT id, conversation_id, body, created_at, direction, delivery_state FROM messages ORDER BY created_at ASC');
}

export async function updateLocalUnread(conversationId: string, unreadCount: number) {
  const db = await openSecureChatDatabase();
  await db.runAsync(
    'UPDATE conversations SET unread_count = ? WHERE id = ?',
    Math.max(0, Math.floor(unreadCount)),
    conversationId,
  );
}

export async function deleteLocalConversation(conversationId: string) {
  const db = await openSecureChatDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM messages WHERE conversation_id = ?', conversationId);
    await db.runAsync('DELETE FROM conversations WHERE id = ?', conversationId);
  });
}

/**
 * Best-effort vault reset: removes the database and wrapped key.
 * This is cryptographic erasure at the app layer, not a guarantee against
 * filesystem snapshots, flash wear-leveling, backups, or data already exported.
 */
export async function destroyLocalVault() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error('The encrypted local vault is available only in an iOS or Android native build.');
  }
  const SQLite = await import('expo-sqlite');
  const SecureStore = await import('expo-secure-store');
  const activeDatabase = databasePromise;
  databasePromise = null;
  if (activeDatabase) {
    try {
      await (await activeDatabase).closeAsync();
    } catch {
      // Continue with best-effort deletion if an open connection failed.
    }
  }
  await SQLite.deleteDatabaseAsync(DATABASE_NAME);
  await SecureStore.deleteItemAsync(KEY_ALIAS);
  await SecureStore.setItemAsync(DEMO_SUPPRESSED_KEY, 'true');
}
