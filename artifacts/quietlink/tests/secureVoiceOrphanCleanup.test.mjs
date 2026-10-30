import assert from 'node:assert/strict';
import test from 'node:test';

import { removeOrphanedVoiceNoteFiles } from '../storage/voiceNoteOrphanCleanup.ts';

const orphanId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const storedId = '11111111-1111-4111-8111-111111111111';
const activeId = '22222222-2222-4222-8222-222222222222';

function fakeFile(name, operations, { throwsOnDelete = false } = {}) {
  let exists = true;
  return {
    name,
    get exists() {
      return exists;
    },
    delete() {
      operations.push(`delete:${name}`);
      if (throwsOnDelete) throw new Error('delete failed');
      exists = false;
    },
  };
}

test('opens the encrypted vault before reading metadata or listing voice files', async () => {
  const operations = [];
  const result = await removeOrphanedVoiceNoteFiles({
    openEncryptedVault: async () => operations.push('open-vault'),
    listVoiceNoteIds: async () => {
      operations.push('read-rows');
      return [storedId];
    },
    listDirectoryFiles: async () => {
      operations.push('list-directory');
      return [fakeFile(`${orphanId}.hmvn`, operations)];
    },
    activeVoiceNoteIds: new Set(),
  });

  assert.deepEqual(operations, [
    'open-vault',
    'read-rows',
    'list-directory',
    `delete:${orphanId}.hmvn`,
  ]);
  assert.deepEqual(result, { examined: 1, preserved: 0, removed: 1, failed: 0 });
});

test('does not inspect the voice directory when encrypted vault opening fails', async () => {
  const operations = [];
  await assert.rejects(
    removeOrphanedVoiceNoteFiles({
      openEncryptedVault: async () => {
        operations.push('open-vault');
        throw new Error('SQLCipher unavailable');
      },
      listVoiceNoteIds: async () => {
        operations.push('read-rows');
        return [];
      },
      listDirectoryFiles: async () => {
        operations.push('list-directory');
        return [];
      },
      activeVoiceNoteIds: new Set(),
    }),
    /SQLCipher unavailable/,
  );
  assert.deepEqual(operations, ['open-vault']);
});

test('preserves files with a SQLCipher row or an active in-memory writer', async () => {
  const operations = [];
  const files = [
    fakeFile(`${storedId}.hmvn`, operations),
    fakeFile(`${activeId}.hmvn`, operations),
  ];
  const result = await removeOrphanedVoiceNoteFiles({
    openEncryptedVault: async () => undefined,
    listVoiceNoteIds: async () => [storedId.toUpperCase()],
    listDirectoryFiles: async () => files,
    activeVoiceNoteIds: new Set([activeId.toUpperCase()]),
  });

  assert.deepEqual(operations, []);
  assert.deepEqual(result, { examined: 2, preserved: 2, removed: 0, failed: 0 });
});

test('ignores unmanaged names and reports deletion failures without stopping cleanup', async () => {
  const operations = [];
  const files = [
    fakeFile(`${orphanId}.hmvn`, operations, { throwsOnDelete: true }),
    fakeFile('not-a-uuid.hmvn', operations),
    fakeFile(`${orphanId}.tmp`, operations),
  ];
  const result = await removeOrphanedVoiceNoteFiles({
    openEncryptedVault: async () => undefined,
    listVoiceNoteIds: async () => [],
    listDirectoryFiles: async () => files,
    activeVoiceNoteIds: new Set(),
  });

  assert.deepEqual(operations, [`delete:${orphanId}.hmvn`]);
  assert.deepEqual(result, { examined: 1, preserved: 0, removed: 0, failed: 1 });
});

test('does not list the directory when encrypted note metadata cannot be read', async () => {
  const operations = [];
  await assert.rejects(
    removeOrphanedVoiceNoteFiles({
      openEncryptedVault: async () => operations.push('open-vault'),
      listVoiceNoteIds: async () => {
        operations.push('read-rows');
        throw new Error('metadata read failed');
      },
      listDirectoryFiles: async () => {
        operations.push('list-directory');
        return [];
      },
      activeVoiceNoteIds: new Set(),
    }),
    /metadata read failed/,
  );
  assert.deepEqual(operations, ['open-vault', 'read-rows']);
});
