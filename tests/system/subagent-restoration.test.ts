import {expect, test} from 'bun:test';
import {access, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {launchTerminal, type Session} from 'tuistory';
import {
  createSubagentRestorationFixture,
  type SidecarRun,
} from './fixtures/subagent-restoration';

type Fixture = Awaited<ReturnType<typeof createSubagentRestorationFixture>>;

function environment(directory: string, agentDir: string) {
  return {
    ...Object.fromEntries(
      Object.keys(process.env).map(key => [key, undefined]),
    ),
    PATH: process.env.PATH,
    HOME: directory,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: 'C.UTF-8',
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: `${agentDir}/sessions`,
    PI_OFFLINE: '1',
    PI_TELEMETRY: '0',
    NO_PROXY: 'localhost,127.0.0.1',
  };
}

function screen(terminal: Session): string {
  return terminal
    .getTerminalData()
    .lines.slice(-terminal.currentRows)
    .map(line => line.spans.map(span => span.text).join(''))
    .join('\n');
}

async function waitScreen(
  terminal: Session,
  marker: string,
  timeout = 15_000,
): Promise<void> {
  await terminal.text({
    timeout,
    trimEnd: true,
    waitFor: () => screen(terminal).includes(marker),
  });
}

async function send(terminal: Session, text: string): Promise<void> {
  await terminal.type(text);
  await terminal.press('enter');
}

async function launch(
  fixture: Fixture,
  extraArgs: readonly string[] = [],
): Promise<Session> {
  const host = process.env.PI_TEST_HOST ?? process.execPath;
  return launchTerminal({
    command: host,
    args: [
      ...(process.env.PI_TEST_HOST
        ? []
        : [
            resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
          ]),
      ...extraArgs,
      '--offline',
      '--no-extensions',
      '--no-skills',
      '--no-context-files',
      '--no-prompt-templates',
      '--no-themes',
      '--no-approve',
      '--provider',
      'restoration',
      '--model',
      'restoration-fixture',
      '-e',
      resolve('src/pi/index.ts'),
    ],
    cwd: fixture.cwd,
    cols: 140,
    rows: 42,
    env: environment(fixture.directory, fixture.agentDir),
  });
}

async function closeTerminal(
  terminal: Session,
  fixture: Fixture,
): Promise<void> {
  try {
    terminal.killProcess();
    await terminal.waitForExit(10_000);
  } finally {
    terminal.close();
    await fixture.close();
  }
}

async function gracefulExit(terminal: Session): Promise<void> {
  await terminal.press(['ctrl', 'c']);
  await terminal.press(['ctrl', 'd']);
  expect(await terminal.waitForExit(10_000)).toBe(true);
  terminal.close();
}

async function waitRun(
  fixture: Fixture,
  runId: string,
  predicate: (run: SidecarRun) => boolean,
  timeout = 15_000,
): Promise<SidecarRun> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const run = (await fixture.readSidecar()).find(item => item.id === runId);
    if (run && predicate(run)) return run;
    await Bun.sleep(50);
  }
  const run = (await fixture.readSidecar()).find(item => item.id === runId);
  throw new Error(
    `Timed out waiting for run ${runId}; current status ${run?.status ?? 'missing'}.`,
  );
}

function task(run: SidecarRun, id: string) {
  const found = run.tasks.find(item => item.id === id);
  if (!found) throw new Error(`Missing task ${id} in run ${run.id}.`);
  return found;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

type Mutation =
  | 'worktree-metadata'
  | 'unknown-tools'
  | 'missing-session'
  | 'missing-session-path'
  | 'empty-session'
  | 'wrong-session-id';

interface MutableTask {
  id: string;
  sessionId?: string;
  sessionFile?: string;
  tools?: string[];
}

interface MutableRun {
  id: string;
  tasks: MutableTask[];
}

async function mutateRecoveryState(
  mutation: Mutation,
  sidecarPath: string,
  runId: string,
  sessionFile: string,
): Promise<void> {
  if (mutation === 'missing-session') {
    await rm(sessionFile, {force: true});
  } else if (mutation === 'empty-session') {
    await writeFile(sessionFile, '');
  } else if (mutation === 'wrong-session-id') {
    const text = await readFile(sessionFile, 'utf8');
    const lines = text.split('\n');
    // SAFETY: Real Pi created this fixture-owned JSONL file. Its first line
    // is the session header; only this test writes it after graceful exit.
    const header = JSON.parse(lines[0] ?? '') as {id?: unknown; type?: unknown};
    if (header.type !== 'session')
      throw new Error('Child session did not start with a session header.');
    header.id = 'restoration-wrong-session-id';
    lines[0] = JSON.stringify(header);
    await writeFile(sessionFile, lines.join('\n'));
  }

  // SAFETY: waitRun decoded this fixture-owned sidecar's runs and tasks
  // before graceful shutdown. No other writer remains; preserve its fields
  // while changing only the selected task's recovery metadata.
  const raw = JSON.parse(await readFile(sidecarPath, 'utf8')) as MutableRun[];
  const run = raw.find(candidate => candidate.id === runId);
  const child = run?.tasks.find(candidate => candidate.id === 'task_1');
  if (!child) throw new Error(`Missing mutable task task_1 in run ${runId}.`);
  if (mutation === 'worktree-metadata') child.tools = ['bash'];
  if (mutation === 'unknown-tools') child.tools = ['unknown-tool'];
  if (mutation === 'missing-session-path') delete child.sessionFile;
  await writeFile(sidecarPath, `${JSON.stringify(raw, null, 2)}\n`);
}

const recoveryCases = [
  {
    mutation: 'worktree-metadata',
    label: 'write-capable tools without worktree metadata',
    error: 'Missing child worktree metadata',
  },
  {
    mutation: 'unknown-tools',
    label: 'unknown saved child tools',
    error: 'Unknown child tools',
  },
  {
    mutation: 'missing-session',
    label: 'a missing child session file',
    error: 'ENOENT',
  },
  {
    mutation: 'missing-session-path',
    label: 'a saved child with no conversation file path',
    error: 'Saved child session is missing its conversation file path',
  },
  {
    mutation: 'empty-session',
    label: 'an empty child session file',
    error: 'Saved child session is empty',
  },
  {
    mutation: 'wrong-session-id',
    label: 'a child session with a different header id',
    error: 'Saved child session is empty',
  },
] as const;

for (const recoveryCase of recoveryCases) {
  test(`restored child rejects ${recoveryCase.label} before SDK execution`, async () => {
    const fixture = await createSubagentRestorationFixture();
    let terminal: Session | undefined;
    try {
      terminal = await launch(fixture);
      await waitScreen(terminal, 'restoration-fixture');
      await send(terminal, 'restoration create');
      await waitScreen(terminal, 'RESTORATION_READY');
      await fixture.waitFor(() => fixture.runIds.length === 1);
      const runId = fixture.runIds[0];
      if (!runId) throw new Error('Restoration fixture did not create a run.');
      const before = await waitRun(
        fixture,
        runId,
        candidate => candidate.status === 'completed',
      );
      const beforeTask = task(before, 'task_1');
      const sessionId = beforeTask.sessionId;
      const sessionFile = beforeTask.sessionFile;
      if (!sessionId || !sessionFile)
        throw new Error(
          'Restoration fixture did not persist the child session.',
        );
      expect(fixture.childRequests.length).toBe(1);
      const originalHistory = await readFile(sessionFile, 'utf8');
      const sidecarPath = await fixture.sidecarPath();
      const suffix = '.pi-stuff-subagents.json';
      if (!sidecarPath.endsWith(suffix))
        throw new Error('Unexpected subagent sidecar filename.');
      const parentSessionFile = sidecarPath.slice(0, -suffix.length);
      expect(await pathExists(parentSessionFile)).toBe(true);
      const unsafeParentWrite = join(
        fixture.cwd,
        'restoration-parent-write.txt',
      );
      await rm(unsafeParentWrite, {force: true});

      await gracefulExit(terminal);
      terminal = undefined;
      await mutateRecoveryState(
        recoveryCase.mutation,
        sidecarPath,
        runId,
        sessionFile,
      );
      const sessionAfterMutation =
        recoveryCase.mutation === 'missing-session'
          ? undefined
          : await readFile(sessionFile, 'utf8');
      if (recoveryCase.mutation === 'missing-session')
        expect(await pathExists(sessionFile)).toBe(false);
      else if (recoveryCase.mutation === 'empty-session')
        expect(sessionAfterMutation).toBe('');
      else if (
        recoveryCase.mutation === 'worktree-metadata' ||
        recoveryCase.mutation === 'unknown-tools' ||
        recoveryCase.mutation === 'missing-session-path'
      )
        expect(sessionAfterMutation).toBe(originalHistory);

      terminal = await launch(fixture, ['--session', parentSessionFile]);
      await waitScreen(terminal, 'restoration-fixture');
      await send(terminal, 'restoration resume');
      await waitScreen(terminal, 'RESTORATION_RESUME_DONE');
      const after = await waitRun(
        fixture,
        runId,
        candidate => candidate.status === 'failed',
      );
      const afterTask = task(after, 'task_1');
      expect(afterTask.status).toBe('failed');
      expect(afterTask.sessionId).toBe(sessionId);
      if (recoveryCase.mutation === 'missing-session-path')
        expect(afterTask.sessionFile).toBeUndefined();
      else expect(afterTask.sessionFile).toBe(sessionFile);
      expect(afterTask.error).toContain(recoveryCase.error);
      expect(fixture.childRequests.length).toBe(1);
      expect(await pathExists(unsafeParentWrite)).toBe(false);
      if (sessionAfterMutation !== undefined)
        expect(await readFile(sessionFile, 'utf8')).toBe(sessionAfterMutation);
      else expect(await pathExists(sessionFile)).toBe(false);

      if (recoveryCase.mutation === 'missing-session') {
        await writeFile(sessionFile, originalHistory);
        await send(terminal, '/subagents');
        await waitScreen(terminal, 'Message @readonly');
        expect(screen(terminal)).toContain('RESTORATION_CHILD_INITIAL');
        expect(fixture.childRequests.length).toBe(1);
        expect(await pathExists(unsafeParentWrite)).toBe(false);
        await terminal.press(['ctrl', 'c']);
      }

      expect(terminal.isDead).toBe(false);
      await send(terminal, 'restoration parent');
      await waitScreen(terminal, 'RESTORATION_PARENT_ALIVE');
      expect(terminal.isDead).toBe(false);
    } catch (error) {
      if (terminal) console.error(screen(terminal));
      throw error;
    } finally {
      if (terminal) await closeTerminal(terminal, fixture);
      else await fixture.close();
    }
  }, 90_000);
}
