import {expect, test} from 'bun:test';
import {readFile, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect, Schema} from 'effect';
import {
  readAutoLimit,
  setAutoLimit,
  SettingsError,
} from '../../src/subagent/settings';

async function temporaryAgentDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pi-subagent-settings-'));
}

async function runFailure(
  effect: Effect.Effect<boolean, SettingsError>,
): Promise<SettingsError> {
  try {
    await Effect.runPromise(effect);
  } catch (error) {
    if (Schema.is(SettingsError)(error)) return error;
    throw error;
  }
  throw new Error('Expected the settings operation to fail.');
}

test('auto-limit defaults off when the settings file is missing', async () => {
  const agentDir = await temporaryAgentDir();
  try {
    expect(await Effect.runPromise(readAutoLimit(agentDir))).toBe(false);
  } finally {
    await rm(agentDir, {recursive: true, force: true});
  }
});

test('auto-limit persists changes and retains unrelated settings', async () => {
  const agentDir = await temporaryAgentDir();
  const path = join(agentDir, 'subagents-config.json');
  try {
    await writeFile(
      path,
      JSON.stringify({provider: {name: 'fixture'}, autoLimit: false}),
    );

    expect(await Effect.runPromise(setAutoLimit(agentDir, true))).toBe(true);
    expect(await Effect.runPromise(readAutoLimit(agentDir))).toBe(true);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      provider: {name: 'fixture'},
      autoLimit: true,
    });

    expect(await Effect.runPromise(setAutoLimit(agentDir, false))).toBe(false);
    expect(await Effect.runPromise(readAutoLimit(agentDir))).toBe(false);
  } finally {
    await rm(agentDir, {recursive: true, force: true});
  }
});

test('malformed settings are reported and never overwritten', async () => {
  const agentDir = await temporaryAgentDir();
  const path = join(agentDir, 'subagents-config.json');
  const malformed = '{"autoLimit":';
  try {
    await writeFile(path, malformed);

    const readError = await runFailure(readAutoLimit(agentDir));
    expect(readError.kind).toBe('parse');
    expect(readError.message).toContain(path);
    const writeError = await runFailure(setAutoLimit(agentDir, true));
    expect(writeError.kind).toBe('parse');
    expect(await readFile(path, 'utf8')).toBe(malformed);
  } finally {
    await rm(agentDir, {recursive: true, force: true});
  }
});

test('read and write failures remain typed errors', async () => {
  const root = await temporaryAgentDir();
  const agentFile = join(root, 'agent-file');
  const missingAgentDir = join(root, 'missing-agent-dir');
  try {
    await writeFile(agentFile, 'not a directory');

    const readError = await runFailure(readAutoLimit(agentFile));
    expect(readError.kind).toBe('io');
    const writeError = await runFailure(setAutoLimit(missingAgentDir, true));
    expect(writeError.kind).toBe('io');
    expect(writeError.message).toContain('write');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
