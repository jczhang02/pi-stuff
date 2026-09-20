import {expect, test} from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {Schema} from 'effect';
import {FleetRecord} from '../../src/subagent/records';
import {
  launchPi,
  type FixtureReply,
  type ModelRequest,
} from './fixtures/pi-terminal';

const FleetRecordJson = Schema.fromJsonString(FleetRecord);
const AdmissionJson = Schema.fromJsonString(
  Schema.Struct({
    status: Schema.Literal('accepted'),
    dispatchId: Schema.String,
    tasks: Schema.Array(
      Schema.Struct({taskId: Schema.String, agentId: Schema.String}),
    ),
  }),
);
const WaitJson = Schema.fromJsonString(
  Schema.Struct({waitStatus: Schema.String}),
);
const OwnerJson = Schema.fromJsonString(
  Schema.Struct({
    pid: Schema.Number,
    boot: Schema.String,
    started: Schema.String,
    nonce: Schema.String,
    sessionId: Schema.String,
  }),
);

type PersistenceHost = Awaited<ReturnType<typeof launchPi>>;

async function makeExtension(observer: boolean): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'pi-stuff-persistence-ext-'));
  const observerSource = observer
    ? `
  pi.events.on('pi-stuff:subagent', () => {
    appendFileSync(join(process.cwd(), 'observer-seen'), 'observer\\n');
    throw new Error('observer failure fixture');
  });
`
    : '';
  const path = join(directory, 'controls.ts');
  await writeFile(
    path,
    `import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {appendFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

async function saveSessionFile(ctx: {
  cwd: string;
  sessionManager: {getSessionFile: () => string | undefined};
}) {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (sessionFile === undefined) throw new Error('Session file is unavailable.');
  await writeFile(join(ctx.cwd, 'host-session-file'), sessionFile);
  return sessionFile;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand('host-session-file', {
    description: 'Record the active session file for persistence tests.',
    handler: async (_args, ctx) => {
      const sessionFile = await saveSessionFile(ctx);
      ctx.ui.notify('HOST_SESSION_FILE:' + sessionFile, 'info');
    },
  });
${observerSource}}
`,
  );
  return {
    path,
    cleanup: async () => {
      await rm(directory, {recursive: true, force: true});
    },
  };
}

async function recordPaths(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, {withFileTypes: true});
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name === 'records.json') paths.push(path);
    if (entry.isDirectory()) paths.push(...(await recordPaths(path)));
  }
  return paths;
}

async function waitForRecordPath(host: PersistenceHost): Promise<string> {
  let path: string | undefined;
  await host.terminal.screen.waitUntil(
    async () => {
      path = (await recordPaths(join(host.agent, 'pi-stuff', 'subagents')))[0];
      return path !== undefined;
    },
    {timeoutMs: 15000},
  );
  if (path === undefined) throw new Error('Fleet records were not created.');
  return path;
}

async function readFleetRecord(path: string): Promise<FleetRecord> {
  return Schema.decodeUnknownSync(FleetRecordJson)(
    await readFile(path, 'utf8'),
  );
}

async function waitForFleet(host: PersistenceHost): Promise<void> {
  for (let attempt = 0; attempt < 16; attempt++) {
    const result = Schema.decodeUnknownSync(WaitJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({command: 'wait', timeoutMs: 5000}),
      ),
    );
    if (result.waitStatus === 'settled') return;
    if (
      result.waitStatus !== 'changed' &&
      result.waitStatus !== 'message' &&
      result.waitStatus !== 'expired'
    )
      throw new Error(`Fleet wait ended with ${result.waitStatus}.`);
  }
  throw new Error('Fleet did not settle after 16 event-driven waits.');
}

async function waitForFile(
  host: PersistenceHost,
  path: string,
  predicate: (value: string) => boolean,
): Promise<string> {
  let value = '';
  await host.terminal.screen.waitUntil(
    async () => {
      try {
        value = await readFile(path, 'utf8');
        return predicate(value);
      } catch {
        return false;
      }
    },
    {timeoutMs: 15000},
  );
  return value;
}

async function saveCurrentSessionFile(host: PersistenceHost): Promise<string> {
  const marker = join(host.directory, 'host-session-file');
  await host.command('/host-session-file');
  return waitForFile(host, marker, value => value.length > 0);
}

function completionModel(reports: ReadonlyMap<string, string>) {
  const stages = new Map<string, number>();
  return (request: ModelRequest): FixtureReply | undefined => {
    const history = JSON.stringify(request.messages);
    if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
    const users = request.messages
      .filter(message => message.role === 'user')
      .map(message => JSON.stringify(message.content ?? ''))
      .join('\n');
    const marker = [...reports.keys()]
      .map(candidate => ({
        candidate,
        position: users.lastIndexOf(candidate),
      }))
      .filter(candidate => candidate.position >= 0)
      .toSorted((left, right) => right.position - left.position)[0]?.candidate;
    if (marker === undefined)
      throw new Error('No persistence fixture marker matched the child.');
    const report = reports.get(marker);
    if (report === undefined) throw new Error(`No report for ${marker}.`);
    const stage = stages.get(marker) ?? 0;
    if (stage === 0) {
      stages.set(marker, 1);
      return {
        tool: 'subagent',
        arguments: JSON.stringify({
          command: 'finish',
          outcome: 'fulfilled',
          text: report,
        }),
      };
    }
    stages.set(marker, stage + 1);
    return {text: `Completed ${marker}.`};
  };
}

async function restoreRecords(
  recordsPath: string,
  backupPath: string,
): Promise<void> {
  let backupExists = false;
  try {
    await stat(backupPath);
    backupExists = true;
  } catch {
    backupExists = false;
  }
  if (!backupExists) return;
  await rm(recordsPath, {recursive: true, force: true});
  await rename(backupPath, recordsPath);
}

test('real Pi blocks /new on a core records save failure, then repairs and departs without replay', async () => {
  const controls = await makeExtension(false);
  const slowStarted = Promise.withResolvers<void>();
  const slowAborted = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== '/slow')
        return new Response(null, {status: 404});
      slowStarted.resolve();
      return new Promise<Response>(resolve => {
        request.signal.addEventListener(
          'abort',
          () => {
            slowAborted.resolve();
            resolve(new Response(null, {status: 499}));
          },
          {once: true},
        );
      });
    },
  });
  let host: PersistenceHost | undefined;
  let recordsPath = '';
  let backupPath = '';
  try {
    let modelCalls = 0;
    host = await launchPi(
      '{}',
      controls.path,
      'subagent',
      'fullscreen',
      async request => {
        const history = JSON.stringify(request.messages);
        if (
          history.includes('SUBAGENT_ASSIGNMENT') &&
          history.includes('PERSISTENCE_ACTIVE')
        ) {
          modelCalls++;
          return {
            tool: 'fetch_content',
            arguments: JSON.stringify({
              urls: [`${server.url}slow`],
              mode: 'raw',
            }),
          };
        }
        return undefined;
      },
    );
    const admission = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'persistence-active',
              prompt: 'PERSISTENCE_ACTIVE',
              workspace: 'live',
              tools: ['subagent', 'fetch_content'],
              extensions: ['pi-stuff:web'],
            },
          ],
        }),
      ),
    );
    const taskId = admission.tasks[0]?.taskId;
    if (taskId === undefined)
      throw new Error('Active task admission was incomplete.');
    await slowStarted.promise;
    const originalSession = await saveCurrentSessionFile(host);
    recordsPath = await waitForRecordPath(host);
    backupPath = `${recordsPath}.backup`;
    await rename(recordsPath, backupPath);
    await mkdir(recordsPath);

    const cancelResult = await host.invoke(
      'subagent',
      JSON.stringify({command: 'cancel', taskId}),
    );
    expect(cancelResult).toContain('"status":"rejected"');
    expect(cancelResult).toContain('EISDIR');
    await slowAborted.promise;
    await host.terminal.screen.waitForText('Subagent save failed', {
      timeoutMs: 15000,
    });

    await host.terminal.keyboard.type('/new');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText(
      'Subagents could not stop and save',
      {timeoutMs: 15000},
    );
    expect(await saveCurrentSessionFile(host)).toBe(originalSession);
    expect(modelCalls).toBe(1);

    await restoreRecords(recordsPath, backupPath);
    await host.terminal.keyboard.type('/new');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('New session started', {
      timeoutMs: 15000,
    });
    const record = await readFleetRecord(recordsPath);
    const task = record.tasks.find(candidate => candidate.id === taskId);
    expect(task?.phase).toBe('ended');
    expect(task?.outcome).toBe('interrupted');
    expect(task?.stopOutcome).toBe('interrupted');
    expect(task?.durability).toBe('saved');
    expect(modelCalls).toBe(1);
  } finally {
    if (recordsPath !== '' && backupPath !== '')
      await restoreRecords(recordsPath, backupPath);
    await host?.close();
    slowAborted.resolve();
    await server.stop(true);
    await controls.cleanup();
  }
}, 60000);

test('real Pi isolates observer failures from durable fulfilled results and scheduling', async () => {
  const controls = await makeExtension(true);
  let host: PersistenceHost | undefined;
  try {
    host = await launchPi(
      '{}',
      controls.path,
      'subagent',
      'fullscreen',
      completionModel(
        new Map([
          ['OBSERVER_FIRST', 'First observer result.'],
          ['OBSERVER_SECOND', 'Second observer result.'],
        ]),
      ),
    );
    const admission = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'observer-first',
              prompt: 'OBSERVER_FIRST',
              workspace: 'live',
              tools: ['subagent'],
            },
            {
              name: 'observer-second',
              prompt: 'OBSERVER_SECOND',
              workspace: 'live',
              tools: ['subagent'],
            },
          ],
        }),
      ),
    );
    const taskIds = admission.tasks.map(task => task.taskId);
    expect(taskIds).toHaveLength(2);
    await waitForFleet(host);
    const observerMarker = join(host.directory, 'observer-seen');
    await waitForFile(host, observerMarker, value => value.length > 0);
    const recordsPath = await waitForRecordPath(host);
    const record = await readFleetRecord(recordsPath);
    for (const taskId of taskIds) {
      const task = record.tasks.find(candidate => candidate.id === taskId);
      expect(task?.phase).toBe('ended');
      expect(task?.outcome).toBe('fulfilled');
      expect(task?.durability).toBe('saved');
    }
  } finally {
    await host?.close();
    await controls.cleanup();
  }
}, 60000);

test('losing executor ownership waits for active tools and still blocks departure on unsaved records', async () => {
  const controls = await makeExtension(false);
  let childCalls = 0;
  const host = await launchPi(
    '{}',
    controls.path,
    'subagent',
    'fullscreen',
    request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      childCalls++;
      return {
        tool: 'bash',
        arguments: JSON.stringify({
          command:
            'trap "" TERM; printf started > slow-started; sleep 2; printf stopped > slow-stopped',
        }),
      };
    },
  );
  try {
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {
            name: 'lost-owner',
            prompt: 'Run the one slow command.',
            workspace: 'direct',
            tools: ['bash', 'subagent'],
          },
        ],
      }),
    );
    await waitForFile(host, join(host.directory, 'slow-started'), value =>
      value.includes('started'),
    );
    const originalSession = await saveCurrentSessionFile(host);
    const recordsPath = await waitForRecordPath(host);
    const ownerPath = join(dirname(recordsPath), 'executor.lock');
    const owner = Schema.decodeUnknownSync(OwnerJson)(
      await readFile(ownerPath, 'utf8'),
    );
    await writeFile(
      ownerPath,
      JSON.stringify({...owner, nonce: `${owner.nonce}-replacement`}),
    );
    await host.terminal.screen.waitForText('Subagent save failed', {
      timeoutMs: 15000,
    });
    await host.terminal.keyboard.type('/new');
    await host.terminal.keyboard.press('Enter');
    await Bun.sleep(150);
    const whileStopping = await host.terminal.screen.text();
    expect(whileStopping).not.toContain('New session started');
    expect(whileStopping).not.toContain('Subagents could not stop and save');
    await waitForFile(host, join(host.directory, 'slow-stopped'), value =>
      value.includes('stopped'),
    );
    await host.terminal.screen.waitForText(
      'Subagents could not stop and save',
      {timeoutMs: 15000},
    );
    expect(await saveCurrentSessionFile(host)).toBe(originalSession);
    expect(childCalls).toBe(1);
  } finally {
    await host.close();
    await controls.cleanup();
  }
}, 60000);

test('failed admission persistence starts no child and leaves no consumed quota after repair', async () => {
  let childRequests = 0;
  const model = completionModel(
    new Map([['AFTER_REPAIR', 'Admitted after repair.']]),
  );
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      if (JSON.stringify(request.messages).includes('SUBAGENT_ASSIGNMENT'))
        childRequests++;
      return model(request);
    },
  );
  let recordsPath = '';
  let backupPath = '';
  try {
    await host.invoke('subagent', '{"command":"inspect"}');
    recordsPath = await waitForRecordPath(host);
    backupPath = `${recordsPath}.backup`;
    const before = await readFleetRecord(recordsPath);
    await rename(recordsPath, backupPath);
    await mkdir(recordsPath);
    const rejected = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: Array.from({length: 64}, (_, index) => ({
          name: `unrecorded-${index}`,
          prompt: 'NEVER_ADMITTED',
          workspace: 'live',
        })),
      }),
    );
    expect(rejected).toContain('"status":"rejected"');
    expect(rejected).toContain('EISDIR');
    expect(childRequests).toBe(0);
    await restoreRecords(recordsPath, backupPath);
    await host.command('/new');
    await host.terminal.screen.waitForText('New session started', {
      timeoutMs: 15000,
    });
    const repaired = await readFleetRecord(recordsPath);
    expect(repaired.agents).toEqual(before.agents);
    expect(repaired.tasks).toEqual(before.tasks);
    expect(repaired.dispatches).toEqual(before.dispatches);
    expect(repaired.storageError).toBeNull();
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [{name: 'repaired', prompt: 'AFTER_REPAIR', workspace: 'live'}],
      }),
    );
    await waitForFleet(host);
    expect(childRequests).toBeGreaterThan(0);
  } finally {
    if (recordsPath && backupPath)
      await restoreRecords(recordsPath, backupPath);
    await host.close();
  }
}, 60000);

test('startup isolation failure retains admission while unrelated live work completes', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    completionModel(
      new Map([['LIVE_SURVIVES_STARTUP', 'Independent work completed.']]),
    ),
  );
  try {
    const admission = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {name: 'snapshot', prompt: 'REQUIRES_GIT', workspace: 'snapshot'},
            {name: 'live', prompt: 'LIVE_SURVIVES_STARTUP', workspace: 'live'},
          ],
        }),
      ),
    );
    expect(admission.tasks).toHaveLength(2);
    await waitForFleet(host);
    const record = await readFleetRecord(await waitForRecordPath(host));
    const failed = record.tasks.find(
      task => task.id === admission.tasks[0]?.taskId,
    );
    const completed = record.tasks.find(
      task => task.id === admission.tasks[1]?.taskId,
    );
    expect(failed?.outcome).toBe('failed');
    expect(failed?.workspaceDirectory).toBeNull();
    expect(completed?.outcome).toBe('fulfilled');
    expect(completed?.durability).toBe('saved');
    expect(record.dispatches[0]?.admitted).toBe(2);
  } finally {
    await host.close();
  }
}, 60000);
