import {expect, test} from 'bun:test';
import {TerminalControl, type Session} from '@kitlangton/terminal-control';
import {Effect, Schema} from 'effect';
import {
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {FleetRecord} from '../../src/subagent/records';
import {executorIdentity} from '../../src/subagent/processes';
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
type WriterHost = Awaited<ReturnType<typeof launchPi>>;

interface RecordHost {
  readonly agent: string;
  readonly terminal: Session;
}

interface ObserverHost {
  readonly driver: TerminalControl;
  readonly agent: string;
  readonly terminal: Session;
  readonly close: () => Promise<void>;
}

async function makeSessionControlExtension(): Promise<{
  readonly path: string;
  readonly cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'pi-stuff-observer-ext-'));
  const path = join(directory, 'session-controls.ts');
  await writeFile(
    path,
    `import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export default function (pi: ExtensionAPI) {
  pi.registerCommand('host-session-file', {
    description: 'Record the active public session file for the test.',
    handler: async (_args, ctx) => {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (sessionFile === undefined) throw new Error('Session file is unavailable.');
      await writeFile(join(ctx.cwd, 'host-session-file'), sessionFile);
      ctx.ui.notify('HOST_SESSION_FILE:' + sessionFile, 'info');
    },
  });
}
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

async function fleetRecords(agentDirectory: string): Promise<FleetRecord[]> {
  const paths = await recordPaths(
    join(agentDirectory, 'pi-stuff', 'subagents'),
  );
  const records: FleetRecord[] = [];
  for (const path of paths) {
    try {
      records.push(
        Schema.decodeUnknownSync(FleetRecordJson)(await readFile(path, 'utf8')),
      );
    } catch {
      // Atomic replacement can make one poll observe a partial file.
    }
  }
  return records;
}

async function waitForRecord(
  host: RecordHost,
  predicate: (record: FleetRecord) => boolean,
): Promise<FleetRecord> {
  let matched: FleetRecord | undefined;
  await host.terminal.screen.waitUntil(
    async () => {
      matched = (await fleetRecords(host.agent)).find(predicate);
      return matched !== undefined;
    },
    {timeoutMs: 20000},
  );
  if (matched === undefined)
    throw new Error('Expected a persisted fleet record.');
  return matched;
}

async function saveCurrentSessionFile(host: WriterHost): Promise<string> {
  const marker = join(host.directory, 'host-session-file');
  await host.command('/host-session-file');
  await host.terminal.screen.waitUntil(
    async () => {
      try {
        return (await readFile(marker, 'utf8')).length > 0;
      } catch {
        return false;
      }
    },
    {timeoutMs: 15000},
  );
  return readFile(marker, 'utf8');
}

function hostEnvironment(directory: string, agent: string) {
  return {
    HOME: directory,
    PATH: '/usr/bin:/bin',
    TERM: 'xterm-256color',
    PI_CODING_AGENT_DIR: agent,
    PI_CODING_AGENT_SESSION_DIR: join(directory, 'sessions'),
    PI_OFFLINE: '1',
    PI_TELEMETRY: '0',
    EXA_API_KEY: '',
    NO_PROXY: '127.0.0.1,localhost',
    XDG_CONFIG_HOME: join(directory, 'config'),
    XDG_DATA_HOME: join(directory, 'data'),
    RTK_DB_PATH: join(directory, 'rtk.db'),
    RTK_TEE: '0',
    RTK_TELEMETRY_DISABLED: '1',
    MISE_OFFLINE: '1',
    MISE_NO_HOOKS: '1',
    MISE_AUTO_INSTALL: '0',
    MISE_DATA_DIR: join(directory, 'mise-data'),
    MISE_INSTALLS_DIR:
      process.env.PI_TEST_MISE_INSTALLS ?? join(directory, 'mise-installs'),
    MISE_GLOBAL_CONFIG_FILE:
      process.env.PI_TEST_MISE_CONFIG ?? join(directory, 'mise.toml'),
    MISE_CONFIG_DIR: join(directory, 'mise-config'),
    MISE_SYSTEM_CONFIG_DIR: join(directory, 'mise-system'),
    MISE_CACHE_DIR: join(directory, 'mise-cache'),
    MISE_STATE_DIR: join(directory, 'mise-state'),
  };
}

async function launchObserver(
  host: WriterHost,
  sessionFile: string,
  extraExtension: string,
): Promise<ObserverHost> {
  const driver = await TerminalControl.make({
    binaryPath: resolve('node_modules/.bin/termctrl'),
    env: {
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      ALL_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
      all_proxy: undefined,
      DISPLAY: undefined,
      WAYLAND_DISPLAY: undefined,
      DBUS_SESSION_BUS_ADDRESS: undefined,
    },
  });
  let terminal: Session | undefined;
  const close = async () => {
    try {
      await terminal?.stop();
    } finally {
      await driver.close();
    }
  };
  try {
    terminal = await driver.launch({
      command: [
        process.env.PI_TEST_HOST ?? process.execPath,
        ...(process.env.PI_TEST_HOST
          ? []
          : [
              resolve(
                'node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
              ),
            ]),
        '--offline',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--no-themes',
        '--no-context-files',
        '--no-approve',
        '--tools',
        'bash,read,subagent,web_search,fetch_content,get_search_content',
        '--provider',
        'fixture',
        '--model',
        'fixture',
        '--tui-mode',
        'fullscreen',
        '--session',
        sessionFile,
        '-e',
        resolve('.'),
        '-e',
        resolve('tests/system/fixtures/host-controls.ts'),
        '-e',
        extraExtension,
      ],
      cwd: host.directory,
      viewport: {cols: 100, rows: 30},
      inheritEnv: false,
      env: hostEnvironment(host.directory, host.agent),
    });
    await terminal.screen.waitForText('fixture', {timeoutMs: 20000});
    return {driver, agent: host.agent, terminal, close};
  } catch (error) {
    await close();
    throw error;
  }
}

async function sendModelTurn(
  host: ObserverHost,
  marker: string,
  completion: string,
): Promise<void> {
  await host.terminal.keyboard.type(marker);
  await host.terminal.keyboard.press('Enter');
  await host.terminal.screen.waitForText(completion, {timeoutMs: 20000});
}

async function processAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function findPiProcess(
  directory: string,
  agent: string,
): Promise<number> {
  const entries = await readdir('/proc', {withFileTypes: true});
  const expectedAgent = `PI_CODING_AGENT_DIR=${agent}`;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
    const pid = Number(entry.name);
    try {
      const cwd = await readlink(`/proc/${entry.name}/cwd`);
      if (resolve(cwd) !== resolve(directory)) continue;
      const environment = await readFile(`/proc/${entry.name}/environ`, 'utf8');
      if (!environment.split('\0').includes(expectedAgent)) continue;
      const commandLine = await readFile(`/proc/${entry.name}/cmdline`, 'utf8');
      if (!commandLine.includes('--tui-mode')) continue;
      if (pid === process.pid) continue;
      return pid;
    } catch {
      // Processes can disappear while /proc is being scanned.
    }
  }
  throw new Error(`Could not find the Pi process for ${directory}.`);
}

async function killPiAbruptly(
  host: WriterHost,
  writerPid?: number,
): Promise<number> {
  const pid = writerPid ?? (await findPiProcess(host.directory, host.agent));
  process.kill(pid, 'SIGKILL');
  await host.terminal.screen.waitUntil(async () => !(await processAlive(pid)), {
    timeoutMs: 10000,
  });
  expect(await processAlive(pid)).toBe(false);
  return pid;
}

function latestMarker(request: ModelRequest, markers: readonly string[]) {
  const users = request.messages
    .filter(message => message.role === 'user')
    .map(message => JSON.stringify(message.content ?? ''))
    .join('\n');
  return markers
    .map(marker => ({marker, position: users.lastIndexOf(marker)}))
    .filter(candidate => candidate.position >= 0)
    .toSorted((left, right) => right.position - left.position)[0]?.marker;
}

async function selectVisibleAction(
  host: ObserverHost,
  label: string,
): Promise<void> {
  const lines = (
    await host.terminal.screen.capture({
      allowIncomplete: true,
      settleMs: 0,
      deadlineMs: 0,
    })
  ).text
    .split('\n')
    .filter(line => line.includes('● ') || line.includes('○ '));
  const current = lines.findIndex(line => line.includes('● '));
  const target = lines.findIndex(line => line.includes(label));
  expect(target).toBeGreaterThanOrEqual(0);
  expect(current).toBeGreaterThanOrEqual(0);
  if (target > current)
    await host.terminal.keyboard.type('j'.repeat(target - current));
  else if (target < current)
    await host.terminal.keyboard.type('k'.repeat(current - target));
  await host.terminal.keyboard.press('Enter');
}

test('a second Pi observes one writer live, cannot dispatch, and leaves it operational after close', async () => {
  const controls = await makeSessionControlExtension();
  const slowStarted = Promise.withResolvers<void>();
  const releaseSlow = Promise.withResolvers<Response>();
  let slowObserved = false;
  const slowServer = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== '/slow')
        return new Response(null, {status: 404});
      slowObserved = true;
      slowStarted.resolve();
      request.signal.addEventListener(
        'abort',
        () => releaseSlow.resolve(new Response(null, {status: 499})),
        {once: true},
      );
      return releaseSlow.promise;
    },
  });
  let writer: WriterHost | undefined;
  let observer: ObserverHost | undefined;
  let activeModelCalls = 0;
  let forbiddenChildCalls = 0;
  const childStages = new Map<string, number>();
  const childModel = async (
    request: ModelRequest,
  ): Promise<FixtureReply | Response | undefined> => {
    const history = JSON.stringify(request.messages);
    if (history.includes('SUBAGENT_ASSIGNMENT')) {
      const marker = latestMarker(request, [
        'WRITER_OBSERVER_PROGRESS',
        'WRITER_OBSERVER_SECOND',
        'MUST_NOT_RUN',
      ]);
      if (marker === 'MUST_NOT_RUN') {
        forbiddenChildCalls++;
        return {text: 'FORBIDDEN_CHILD_EXECUTED'};
      }
      if (marker === undefined) return undefined;
      const stage = childStages.get(marker) ?? 0;
      childStages.set(marker, stage + 1);
      if (marker === 'WRITER_OBSERVER_PROGRESS' && stage === 0) {
        activeModelCalls++;
        return {
          tool: 'fetch_content',
          arguments: JSON.stringify({
            urls: [`${slowServer.url}slow`],
            mode: 'raw',
          }),
        };
      }
      if (
        stage === 0 ||
        (marker === 'WRITER_OBSERVER_PROGRESS' && stage === 1)
      ) {
        return {
          tool: 'subagent',
          arguments: JSON.stringify({
            command: 'finish',
            outcome: 'fulfilled',
            text: `Completed ${marker}.`,
          }),
        };
      }
      return {text: `Completed ${marker}.`};
    }
    return undefined;
  };

  try {
    writer = await launchPi(
      '{}',
      controls.path,
      'subagent',
      'fullscreen',
      childModel,
    );
    // A persisted assistant turn makes the shared session appendable for the
    // second Pi. A brand-new header-only session is intentionally created with
    // wx by Pi and cannot accept a concurrent first turn.
    await writer.invoke('subagent', '{"command":"inspect"}');
    const sessionFile = await saveCurrentSessionFile(writer);
    observer = await launchObserver(writer, sessionFile, controls.path);
    await observer.terminal.keyboard.type('/agents fleet');
    await observer.terminal.keyboard.press('Enter');
    await observer.terminal.screen.waitForText('Fleet', {timeoutMs: 10000});

    const admission = Schema.decodeUnknownSync(AdmissionJson)(
      await writer.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'observer-progress',
              prompt: 'WRITER_OBSERVER_PROGRESS',
              workspace: 'live',
              tools: ['subagent', 'fetch_content'],
              extensions: ['pi-stuff:web'],
            },
          ],
        }),
      ),
    );
    const taskId = admission.tasks[0]?.taskId;
    expect(taskId).toBeDefined();
    if (taskId === undefined) throw new Error('Writer admission had no task.');

    await writer.terminal.screen.waitUntil(() => slowObserved, {
      timeoutMs: 20000,
    });
    const activeRecord = await waitForRecord(writer, record =>
      record.tasks.some(task => task.id === taskId),
    );
    expect(activeRecord.tasks).toHaveLength(1);
    expect(activeModelCalls).toBe(1);

    await observer.terminal.screen.waitForText('observer-progress', {
      timeoutMs: 15000,
    });
    await observer.terminal.keyboard.type('j');
    await observer.terminal.keyboard.press('Enter');
    await observer.terminal.screen.waitForText('Progress', {timeoutMs: 10000});
    await observer.terminal.screen.waitForText('fetch_content', {
      timeoutMs: 10000,
    });
    await observer.terminal.keyboard.type('a');
    await observer.terminal.screen.waitForText('Actions', {timeoutMs: 10000});
    await selectVisibleAction(observer, 'Message assignment');
    await observer.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 10000,
    });
    await observer.terminal.keyboard.type('OBSERVER_WRITE_ATTEMPT');
    await observer.terminal.keyboard.press('Enter');
    const rejected = await observer.terminal.screen.waitUntil(
      screen =>
        screen.text.includes('message failed') &&
        screen.text.includes('Inspection only'),
      {timeoutMs: 10000},
    );
    expect(rejected.text).toContain('OBSERVER_WRITE_ATTEMPT');
    expect(forbiddenChildCalls).toBe(0);
    expect(activeModelCalls).toBe(1);
    expect(
      await fleetRecords(writer.agent).then(records =>
        records.flatMap(record => record.tasks),
      ),
    ).toHaveLength(1);

    releaseSlow.resolve(new Response('slow result'));
    const completedRecord = await waitForRecord(writer, record =>
      record.tasks.some(
        task => task.id === taskId && task.outcome === 'fulfilled',
      ),
    );
    expect(completedRecord.tasks.find(task => task.id === taskId)?.report).toBe(
      'Completed WRITER_OBSERVER_PROGRESS.',
    );

    await observer.terminal.keyboard.press('Escape');
    await observer.terminal.screen.waitForText('Agents / Actions', {
      timeoutMs: 10000,
    });
    await observer.terminal.keyboard.press('Escape');
    await observer.terminal.screen.waitForText('Agents / observer-progress', {
      timeoutMs: 10000,
    });
    await observer.terminal.screen.waitForText('Done', {timeoutMs: 15000});

    await observer.close();
    observer = undefined;

    const secondAdmission = Schema.decodeUnknownSync(AdmissionJson)(
      await writer.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'writer-after-observer',
              prompt: 'WRITER_OBSERVER_SECOND',
              workspace: 'live',
              tools: ['subagent'],
            },
          ],
        }),
      ),
    );
    const secondTaskId = secondAdmission.tasks[0]?.taskId;
    expect(secondTaskId).toBeDefined();
    if (secondTaskId === undefined)
      throw new Error('Writer second admission had no task.');
    const finalRecord = await waitForRecord(writer, record =>
      record.tasks.some(
        task => task.id === secondTaskId && task.outcome === 'fulfilled',
      ),
    );
    expect(finalRecord.tasks).toHaveLength(2);
  } finally {
    releaseSlow.resolve(new Response(null, {status: 499}));
    await observer?.close();
    await writer?.close();
    await controls.cleanup();
    await slowServer.stop(true);
  }
}, 90000);

test('an abrupt writer crash is recovered once and requires explicit follow-up', async () => {
  const controls = await makeSessionControlExtension();
  const releaseSlow = Promise.withResolvers<Response>();
  let slowObserved = false;
  const slowServer = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== '/slow')
        return new Response(null, {status: 404});
      slowObserved = true;
      request.signal.addEventListener(
        'abort',
        () => releaseSlow.resolve(new Response(null, {status: 499})),
        {once: true},
      );
      return releaseSlow.promise;
    },
  });
  let writer: WriterHost | undefined;
  let reopened: ObserverHost | undefined;
  let watching: ObserverHost | undefined;
  let retainedAgentId: string | undefined;
  let recoveryResponse: string | undefined;
  let initialModelCalls = 0;
  let recoveryChildCalls = 0;
  const childStages = new Map<string, number>();
  const childModel = async (
    request: ModelRequest,
  ): Promise<FixtureReply | Response | undefined> => {
    const history = JSON.stringify(request.messages);
    if (history.includes('SUBAGENT_ASSIGNMENT')) {
      const marker = latestMarker(request, [
        'WRITER_CRASH_ACTIVE',
        'EXPLICIT_RECOVERY',
      ]);
      if (marker === undefined) return undefined;
      const stage = childStages.get(marker) ?? 0;
      childStages.set(marker, stage + 1);
      if (marker === 'WRITER_CRASH_ACTIVE' && stage === 0) {
        initialModelCalls++;
        return {
          tool: 'fetch_content',
          arguments: JSON.stringify({
            urls: [`${slowServer.url}slow`],
            mode: 'raw',
          }),
        };
      }
      if (marker === 'EXPLICIT_RECOVERY' && stage === 0) {
        recoveryChildCalls++;
        return {
          tool: 'subagent',
          arguments: JSON.stringify({
            command: 'finish',
            outcome: 'fulfilled',
            text: 'Recovered explicitly after the crash.',
          }),
        };
      }
      if (marker === 'EXPLICIT_RECOVERY')
        return {text: 'Explicit recovery completed.'};
      return undefined;
    }

    if (!history.includes('REOPEN_RECOVERY')) return undefined;
    const last = request.messages.at(-1);
    if (last?.role === 'tool') {
      recoveryResponse = Schema.is(Schema.String)(last.content)
        ? last.content
        : JSON.stringify(last.content ?? null);
      return {text: 'REOPEN_RECOVERY_DONE'};
    }
    if (retainedAgentId === undefined)
      throw new Error('Recovery model turn started without a retained agent.');
    return {
      tool: 'subagent',
      arguments: JSON.stringify({
        command: 'followup',
        agentId: retainedAgentId,
        text: 'EXPLICIT_RECOVERY',
        recovery: true,
      }),
    };
  };

  try {
    writer = await launchPi(
      '{}',
      controls.path,
      'subagent',
      'fullscreen',
      childModel,
    );
    await writer.invoke('subagent', '{"command":"inspect"}');
    const sessionFile = await saveCurrentSessionFile(writer);
    const admission = Schema.decodeUnknownSync(AdmissionJson)(
      await writer.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'crash-active',
              prompt: 'WRITER_CRASH_ACTIVE',
              workspace: 'live',
              tools: ['subagent', 'fetch_content'],
              extensions: ['pi-stuff:web'],
            },
          ],
        }),
      ),
    );
    const taskId = admission.tasks[0]?.taskId;
    retainedAgentId = admission.tasks[0]?.agentId;
    expect(taskId).toBeDefined();
    expect(retainedAgentId).toBeDefined();
    if (taskId === undefined || retainedAgentId === undefined)
      throw new Error('Crash admission had incomplete identities.');

    await writer.terminal.screen.waitUntil(() => slowObserved, {
      timeoutMs: 20000,
    });
    const active = await waitForRecord(writer, record =>
      record.tasks.some(
        task => task.id === taskId && task.phase === 'executing',
      ),
    );
    expect(active.tasks).toHaveLength(1);
    expect(initialModelCalls).toBe(1);

    const writerPid = await findPiProcess(writer.directory, writer.agent);
    watching = await launchObserver(writer, sessionFile, controls.path);
    await watching.terminal.keyboard.type('/agents fleet');
    await watching.terminal.keyboard.press('Enter');
    await watching.terminal.screen.waitForText('crash-active', {
      timeoutMs: 10000,
    });
    const killedPid = await killPiAbruptly(writer, writerPid);
    expect(await Effect.runPromise(executorIdentity(killedPid))).toBeNull();
    // A dead executor produces no filesystem event. An already-open observer
    // must still stop presenting its last saved task as currently executing.
    await watching.terminal.screen.waitForText('Unknown', {
      timeoutMs: 10000,
    });
    expect(initialModelCalls).toBe(1);
    expect(recoveryChildCalls).toBe(0);
    await watching.close();
    watching = undefined;
    reopened = await launchObserver(writer, sessionFile, controls.path);
    const interrupted = await waitForRecord(reopened, record =>
      record.tasks.some(
        task => task.id === taskId && task.outcome === 'interrupted',
      ),
    );
    const interruptedTask = interrupted.tasks.find(task => task.id === taskId);
    expect(interruptedTask?.phase).toBe('ended');
    expect(interruptedTask?.stopOutcome).toBe('interrupted');
    expect(interruptedTask?.durability).toBe('saved');
    expect(
      interrupted.agents.find(agent => agent.id === retainedAgentId)?.held,
    ).toBe(true);
    expect(initialModelCalls).toBe(1);
    expect(recoveryChildCalls).toBe(0);

    await sendModelTurn(reopened, 'REOPEN_RECOVERY', 'REOPEN_RECOVERY_DONE');
    if (recoveryResponse === undefined)
      throw new Error('Explicit recovery did not return an admission result.');
    const recovery = Schema.decodeUnknownSync(AdmissionJson)(recoveryResponse);
    const recoveryTaskId = recovery.tasks[0]?.taskId;
    expect(recoveryTaskId).toBeDefined();
    if (recoveryTaskId === undefined)
      throw new Error('Explicit recovery had no new task.');
    expect(recoveryTaskId).not.toBe(taskId);
    const recovered = await waitForRecord(reopened, record =>
      record.tasks.some(
        task => task.id === recoveryTaskId && task.outcome === 'fulfilled',
      ),
    );
    expect(recoveryChildCalls).toBe(1);
    expect(recovered.tasks).toHaveLength(2);
    expect(recovered.tasks.find(task => task.id === taskId)?.outcome).toBe(
      'interrupted',
    );
    expect(
      recovered.tasks.find(task => task.id === recoveryTaskId)?.report,
    ).toBe('Recovered explicitly after the crash.');
  } finally {
    releaseSlow.resolve(new Response(null, {status: 499}));
    await watching?.close();
    await reopened?.close();
    await writer?.close();
    await controls.cleanup();
    await slowServer.stop(true);
  }
}, 90000);
