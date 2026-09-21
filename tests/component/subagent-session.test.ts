import {expect, test} from 'bun:test';
import {
  parseSessionEntries,
  SessionManager,
  type SessionEntry,
  type SessionHeader,
} from '@earendil-works/pi-coding-agent';
import type {AssistantMessage} from '@earendil-works/pi-ai';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {openSavedSession} from '../../src/subagent/session';

const emptyAssistant: AssistantMessage = {
  role: 'assistant',
  content: [{type: 'text', text: ''}],
  api: 'fixture',
  provider: 'fixture',
  model: 'fixture',
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  },
  stopReason: 'stop',
  timestamp: 1,
};

async function createSavedSession(
  cwd: string,
  sessionDir: string,
  id: string,
): Promise<string> {
  const manager = SessionManager.create(cwd, sessionDir, {id});
  const file = manager.getSessionFile();
  if (file === undefined)
    throw new Error('Native session did not allocate a file.');
  manager.appendMessage({
    role: 'user',
    content: 'Keep this saved context.',
    timestamp: 1,
  });
  manager.appendMessage(emptyAssistant);
  return file;
}

function nativeFixtureEntries(
  content: string,
): [SessionHeader, SessionEntry, SessionEntry] {
  const entries = parseSessionEntries(content);
  const header = entries[0];
  const first = entries[1];
  const second = entries[2];
  if (
    entries.length !== 3 ||
    header === undefined ||
    header.type !== 'session' ||
    first === undefined ||
    first.type === 'session' ||
    second === undefined ||
    second.type === 'session'
  )
    throw new Error('Native fixture did not contain the expected entries.');
  return [header, first, second];
}

async function rewriteNativeFixture(
  file: string,
  edit: (
    entries: [SessionHeader, SessionEntry, SessionEntry],
  ) => [SessionHeader, SessionEntry, SessionEntry],
): Promise<string> {
  const entries = edit(nativeFixtureEntries(await readFile(file, 'utf8')));
  const content = `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`;
  await writeFile(file, content);
  return content;
}

test('opens a native saved session with empty assistant text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-session-'));
  try {
    const file = await createSavedSession(
      directory,
      directory,
      'saved-session',
    );
    const before = await readFile(file, 'utf8');

    const manager = await Effect.runPromise(
      openSavedSession(file, directory, 'saved-session'),
    );

    expect(manager.getSessionId()).toBe('saved-session');
    const assistant = manager
      .buildSessionContext()
      .messages.find(message => message.role === 'assistant');
    expect(assistant?.role).toBe('assistant');
    if (assistant?.role === 'assistant')
      expect(assistant.content).toEqual([{type: 'text', text: ''}]);
    expect(await readFile(file, 'utf8')).toBe(before);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('rejects missing, empty, malformed and mismatched sessions without rewriting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-session-'));
  try {
    const missing = join(directory, 'missing.jsonl');
    await expect(
      Effect.runPromise(openSavedSession(missing, directory, 'missing')),
    ).rejects.toThrow();
    await expect(readFile(missing, 'utf8')).rejects.toThrow();

    const empty = join(directory, 'empty.jsonl');
    await writeFile(empty, '');
    await expect(
      Effect.runPromise(openSavedSession(empty, directory, 'empty')),
    ).rejects.toThrow();
    expect(await readFile(empty, 'utf8')).toBe('');

    const malformed = join(directory, 'malformed.jsonl');
    const malformedContent = '{not-json}\n';
    await writeFile(malformed, malformedContent);
    await expect(
      Effect.runPromise(openSavedSession(malformed, directory, 'malformed')),
    ).rejects.toThrow();
    expect(await readFile(malformed, 'utf8')).toBe(malformedContent);

    const headerOnly = join(directory, 'header-only.jsonl');
    const headerOnlyContent = `${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'header-only',
      timestamp: '2026-09-21T00:00:00.000Z',
      cwd: directory,
    })}\n`;
    await writeFile(headerOnly, headerOnlyContent);
    await expect(
      Effect.runPromise(openSavedSession(headerOnly, directory, 'header-only')),
    ).rejects.toThrow(/has no context/);
    expect(await readFile(headerOnly, 'utf8')).toBe(headerOnlyContent);

    const partiallyMalformed = await createSavedSession(
      directory,
      directory,
      'partially-malformed',
    );
    const partiallyMalformedContent = `${await readFile(
      partiallyMalformed,
      'utf8',
    )}{not-json}\n`;
    await writeFile(partiallyMalformed, partiallyMalformedContent);
    await expect(
      Effect.runPromise(
        openSavedSession(partiallyMalformed, directory, 'partially-malformed'),
      ),
    ).rejects.toThrow(/invalid/);
    expect(await readFile(partiallyMalformed, 'utf8')).toBe(
      partiallyMalformedContent,
    );

    const valid = await createSavedSession(
      directory,
      directory,
      'actual-session',
    );
    const validContent = await readFile(valid, 'utf8');
    await expect(
      Effect.runPromise(openSavedSession(valid, directory, 'other-session')),
    ).rejects.toThrow(/does not match expected id/);
    expect(await readFile(valid, 'utf8')).toBe(validContent);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('rejects cyclic, duplicate, empty and broken native tree envelopes before traversal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-session-'));
  try {
    const cyclic = await createSavedSession(
      directory,
      directory,
      'cyclic-session',
    );
    const cyclicContent = await rewriteNativeFixture(
      cyclic,
      ([header, first, second]) => [
        header,
        {...first, id: 'cycle-first', parentId: 'cycle-second'},
        {...second, id: 'cycle-second', parentId: 'cycle-first'},
      ],
    );
    await expect(
      Effect.runPromise(openSavedSession(cyclic, directory, 'cyclic-session')),
    ).rejects.toThrow(/parent/);
    expect(await readFile(cyclic, 'utf8')).toBe(cyclicContent);

    const broken = await createSavedSession(
      directory,
      directory,
      'broken-session',
    );
    const brokenContent = await rewriteNativeFixture(
      broken,
      ([header, first, second]) => [
        header,
        first,
        {...second, parentId: 'missing-parent'},
      ],
    );
    await expect(
      Effect.runPromise(openSavedSession(broken, directory, 'broken-session')),
    ).rejects.toThrow(/parent/);
    expect(await readFile(broken, 'utf8')).toBe(brokenContent);

    const duplicate = await createSavedSession(
      directory,
      directory,
      'duplicate-session',
    );
    const duplicateContent = await rewriteNativeFixture(
      duplicate,
      ([header, first, second]) => [header, first, {...second, id: first.id}],
    );
    await expect(
      Effect.runPromise(
        openSavedSession(duplicate, directory, 'duplicate-session'),
      ),
    ).rejects.toThrow(/duplicated/);
    expect(await readFile(duplicate, 'utf8')).toBe(duplicateContent);

    const emptyId = await createSavedSession(
      directory,
      directory,
      'empty-entry-id',
    );
    const emptyIdContent = await rewriteNativeFixture(
      emptyId,
      ([header, first, second]) => [
        header,
        {...first, id: ''},
        {...second, parentId: ''},
      ],
    );
    await expect(
      Effect.runPromise(openSavedSession(emptyId, directory, 'empty-entry-id')),
    ).rejects.toThrow(/envelope/);
    expect(await readFile(emptyId, 'utf8')).toBe(emptyIdContent);

    const nestedHeader = await createSavedSession(
      directory,
      directory,
      'nested-header',
    );
    const [header, first, second] = nativeFixtureEntries(
      await readFile(nestedHeader, 'utf8'),
    );
    const nestedHeaderContent = `${[
      header,
      first,
      {...header, id: 'middle', parentId: first.id},
      {...second, parentId: 'middle'},
    ]
      .map(entry => JSON.stringify(entry))
      .join('\n')}\n`;
    await writeFile(nestedHeader, nestedHeaderContent);
    await expect(
      Effect.runPromise(
        openSavedSession(nestedHeader, directory, 'nested-header'),
      ),
    ).rejects.toThrow(/envelope/);
    expect(await readFile(nestedHeader, 'utf8')).toBe(nestedHeaderContent);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
