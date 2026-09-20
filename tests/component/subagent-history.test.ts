import {expect, test} from 'bun:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {
  readParentHistory,
  type ParentHistorySnapshot,
} from '../../src/subagent/session';
import {decodeSessionRecord} from '../../src/subagent/session-records';
import {
  decodeParentHistory,
  prepareHistoryEntries,
} from '../../src/subagent/session-history';

test('current-host system changes, usage and compaction survive retained history without losing fields', () => {
  const timestamp = '2026-09-20T00:00:00Z';
  const system = {
    role: 'system',
    content: '',
    sections: {preamble: 'Original policy', removed: null},
    toolsAdded: [
      {
        name: 'read',
        description: 'Read files',
        parameters: {type: 'object', properties: {path: {type: 'string'}}},
      },
    ],
    toolsRemoved: [{name: 'write'}],
    timestamp: 1,
  } as const;
  const entries = [
    {type: 'message', id: 'system', parentId: null, timestamp, message: system},
    {
      type: 'usage',
      id: 'accounting',
      parentId: 'system',
      timestamp,
      kind: 'cache_warm',
      provider: 'fixture',
      model: 'fixture',
      usage: {
        input: 1,
        output: 0,
        cacheRead: 0,
        cacheWrite: 1,
        totalTokens: 1,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0.01,
          total: 0.01,
        },
      },
    },
    {
      type: 'compaction',
      id: 'compact',
      parentId: 'accounting',
      timestamp,
      summary: 'Retained task summary.',
      firstKeptEntryId: 'system',
      tokensBefore: 100,
      systemMessage: system,
    },
  ] as const;
  for (const entry of entries)
    expect(decodeSessionRecord(JSON.stringify(entry))).toEqual(entry);
  const snapshot = decodeParentHistory(
    JSON.stringify({
      type: 'parent-history',
      version: 1,
      sourceSessionId: 'parent',
      cwd: '/project',
      entries,
    }),
  );
  const copied = prepareHistoryEntries(snapshot);
  expect(copied[0]).toMatchObject({type: 'message', message: system});
  expect(copied[1]).toMatchObject({type: 'usage', kind: 'cache_warm'});
  expect(copied[2]).toMatchObject({type: 'compaction', systemMessage: system});
  expect(copied[0]?.id).not.toBe('system');
  expect(copied[2]?.parentId).toBe(copied[1]?.id);
  expect(copied[2]).toMatchObject({firstKeptEntryId: copied[0]?.id});
  expect(() =>
    decodeSessionRecord(
      JSON.stringify({
        ...entries[0],
        message: {...system, sections: {broken: 42}},
      }),
    ),
  ).toThrow();
  expect(() =>
    decodeSessionRecord(
      JSON.stringify({
        ...entries[2],
        systemMessage: {...system, toolsAdded: [{name: 'invalid'}]},
      }),
    ),
  ).toThrow();
});

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
