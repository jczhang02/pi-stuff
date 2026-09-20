import {expect, test} from 'bun:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {
  readParentHistory,
  type ParentHistorySnapshot,
} from '../../src/subagent/session';

test('saved history validates message payloads, preserves tool arguments and rejects corruption before SDK use', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-history-'));
  const path = join(directory, 'history.json');
  const usage = {
    input: 1,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 3,
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
  };
  const record = {
    type: 'parent-history',
    version: 1,
    sourceSessionId: 'parent',
    cwd: directory,
    entries: [
      {
        type: 'message',
        id: 'one',
        parentId: null,
        timestamp: '2026-09-20T00:00:00Z',
        message: {
          role: 'assistant',
          api: 'openai-responses',
          provider: 'fixture',
          model: 'fixture',
          timestamp: 1,
          usage,
          stopReason: 'toolUse',
          content: [
            {
              type: 'toolCall',
              id: 'call',
              name: 'read',
              arguments: {path: '中文 file.ts'},
            },
          ],
        },
      },
    ],
  } satisfies ParentHistorySnapshot;
  try {
    await writeFile(path, JSON.stringify(record));
    const parsed = await Effect.runPromise(readParentHistory(path));
    expect(parsed.entries[0]).toEqual(record.entries[0]);
    const entry = record.entries[0];
    if (!entry) throw new Error('Missing history fixture.');
    await writeFile(
      path,
      JSON.stringify({
        ...record,
        entries: [
          {
            ...entry,
            message: {...entry.message, content: 'corrupt assistant blocks'},
          },
        ],
      }),
    );
    await expect(Effect.runPromise(readParentHistory(path))).rejects.toThrow();
    await writeFile(
      path,
      JSON.stringify({
        ...record,
        entries: [{...entry, message: {role: 'invented'}}],
      }),
    );
    await expect(Effect.runPromise(readParentHistory(path))).rejects.toThrow();
    await writeFile(path, '{invalid');
    await expect(Effect.runPromise(readParentHistory(path))).rejects.toThrow();
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
