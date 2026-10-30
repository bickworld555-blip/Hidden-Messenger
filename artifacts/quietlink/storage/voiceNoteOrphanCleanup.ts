const VOICE_NOTE_FILENAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.hmvn$/i;

export type VoiceNoteCiphertextFile = {
  name: string;
  readonly exists: boolean;
  delete: () => void;
};

export type VoiceNoteOrphanCleanupResult = {
  examined: number;
  preserved: number;
  removed: number;
  failed: number;
};

/**
 * Reconciles only direct, UUID-named voice-note ciphertext files. The vault
 * open and metadata lookup must both succeed before the directory is listed.
 */
export async function removeOrphanedVoiceNoteFiles(input: {
  openEncryptedVault: () => Promise<unknown>;
  listVoiceNoteIds: () => Promise<readonly string[]>;
  listDirectoryFiles: () => Promise<readonly VoiceNoteCiphertextFile[]>;
  activeVoiceNoteIds: ReadonlySet<string>;
}): Promise<VoiceNoteOrphanCleanupResult> {
  await input.openEncryptedVault();
  const storedIds = new Set((await input.listVoiceNoteIds()).map((id) => id.toLowerCase()));
  const files = await input.listDirectoryFiles();
  let examined = 0;
  let preserved = 0;
  let removed = 0;
  let failed = 0;

  for (const file of files) {
    const match = VOICE_NOTE_FILENAME.exec(file.name);
    if (!match) continue;
    examined += 1;
    const id = match[1].toLowerCase();
    if (storedIds.has(id) || input.activeVoiceNoteIds.has(id)) {
      preserved += 1;
      continue;
    }

    try {
      if (file.exists) file.delete();
      if (file.exists) failed += 1;
      else removed += 1;
    } catch {
      failed += 1;
    }
  }

  return { examined, preserved, removed, failed };
}
