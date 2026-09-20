import {expect, test} from 'bun:test';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

type RecoveryHost = Awaited<ReturnType<typeof launchPi>>;

async function makeSessionControlExtension(): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'pi-stuff-recovery-ext-'));
  const path = join(directory, 'session-controls.ts');
  await writeFile(
    path,
    `import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
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
    description: 'Record the active public session file for the test.',
    handler: async (_args, ctx) => {
      const sessionFile = await saveSessionFile(ctx);
      ctx.ui.notify('HOST_SESSION_FILE:' + sessionFile, 'info');
    },
  });
  pi.registerCommand('host-switch', {
    description: 'Switch to a public session file for the test.',
    handler: async (args, ctx) => {
      const target = args.trim();
      if (target.length === 0) throw new Error('A session path is required.');
      const result = await ctx.switchSession(target, {
        withSession: async replacementCtx => {
          const sessionFile = await saveSessionFile(replacementCtx);
          replacementCtx.ui.notify('HOST_SWITCH:' + sessionFile, 'info');
        },
      });
      if (result.cancelled) ctx.ui.notify('HOST_SWITCH:CANCELLED', 'warning');
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
      // A concurrent atomic replacement can leave a record unreadable for one poll.
    }
  }
  return records;
}

async function waitForRecord(
  host: RecoveryHost,
  predicate: (record: FleetRecord) => boolean,
): Promise<FleetRecord> {
  let matched: FleetRecord | undefined;
  await host.terminal.screen.waitUntil(
    async () => {
      matched = (await fleetRecords(host.agent)).find(predicate);
      return matched !== undefined;
    },
    {timeoutMs: 15000},
  );
  if (matched === undefined)
    throw new Error('Expected persisted fleet record.');
  return matched;
}

async function waitForFleet(host: RecoveryHost): Promise<void> {
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

async function waitForFileValue(
  host: RecoveryHost,
  path: string,
  value: string,
): Promise<void> {
  await host.terminal.screen.waitUntil(
    async () => {
      try {
        return (await readFile(path, 'utf8')) === value;
      } catch {
        return false;
      }
    },
    {timeoutMs: 15000},
  );
}

async function saveCurrentSessionFile(host: RecoveryHost): Promise<string> {
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

async function switchToSession(
  host: RecoveryHost,
  sessionFile: string,
): Promise<void> {
  const marker = join(host.directory, 'host-session-file');
  await host.command(`/host-switch ${sessionFile}`);
  await waitForFileValue(host, marker, sessionFile);
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

function completionModel(
  reports: ReadonlyMap<string, string>,
  onCall?: (marker: string) => void,
) {
  const stages = new Map<string, number>();
  return (request: ModelRequest): FixtureReply | undefined => {
    const history = JSON.stringify(request.messages);
    if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
    const marker = latestMarker(request, [...reports.keys()]);
    if (marker === undefined)
      throw new Error('No recovery fixture marker matched the child request.');
    const report = reports.get(marker);
    if (report === undefined) throw new Error(`No report for ${marker}.`);
    onCall?.(marker);
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

test('real Pi restores a retained child after /new and follows it up after switching back', async () => {
  const controls = await makeSessionControlExtension();
  let host: RecoveryHost | undefined;
  try {
    host = await launchPi(
      '{}',
      controls.path,
      'subagent',
      'fullscreen',
      completionModel(
        new Map([
          ['INITIAL_SAVED_CONTEXT', 'Initial retained report.'],
          ['SWITCHED_FOLLOWUP', 'Follow-up retained report.'],
        ]),
      ),
    );
    const initial = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'retained',
              prompt: 'INITIAL_SAVED_CONTEXT',
              workspace: 'live',
              tools: ['subagent'],
            },
          ],
        }),
      ),
    );
    const taskId = initial.tasks[0]?.taskId;
    const agentId = initial.tasks[0]?.agentId;
    expect(taskId).toBeDefined();
    expect(agentId).toBeDefined();
    if (taskId === undefined || agentId === undefined)
      throw new Error('Initial retained task admission was incomplete.');
    await waitForFleet(host);
    const firstRecord = await waitForRecord(host, record =>
      record.tasks.some(
        task => task.id === taskId && task.outcome === 'fulfilled',
      ),
    );
    const firstTask = firstRecord.tasks.find(task => task.id === taskId);
    expect(firstTask?.durability).toBe('saved');
    expect(firstTask?.report).toBe('Initial retained report.');
    expect(firstTask?.sessionFile).toBeTruthy();
    const originalSession = await saveCurrentSessionFile(host);

    await host.terminal.keyboard.type('/new');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('New session started', {
      timeoutMs: 15000,
    });
    await switchToSession(host, originalSession);

    const followup = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'followup',
          agentId,
          text: 'SWITCHED_FOLLOWUP',
        }),
      ),
    );
    const followupTaskId = followup.tasks[0]?.taskId;
    expect(followupTaskId).toBeDefined();
    await waitForFleet(host);
    const finalRecord = await waitForRecord(host, record =>
      record.tasks.some(
        task => task.id === followupTaskId && task.outcome === 'fulfilled',
      ),
    );
    const finalFirst = finalRecord.tasks.find(task => task.id === taskId);
    const finalFollowup = finalRecord.tasks.find(
      task => task.id === followupTaskId,
    );
    expect(
      finalRecord.tasks.filter(task => task.agentId === agentId),
    ).toHaveLength(2);
    expect(finalFirst?.report).toBe('Initial retained report.');
    expect(finalFirst?.sessionFile).toBe(firstTask?.sessionFile);
    expect(finalFollowup?.agentId).toBe(agentId);
    expect(finalFollowup?.report).toBe('Follow-up retained report.');
    expect(finalFollowup?.durability).toBe('saved');
    expect(finalFollowup?.sessionFile).toBe(firstTask?.sessionFile);
  } finally {
    await host?.close();
    await controls.cleanup();
  }
}, 60000);

test('real Pi marks an active child interrupted at /new, does not replay it on reopen, and requires explicit recovery', async () => {
  const controls = await makeSessionControlExtension();
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
  let activeModelCalls = 0;
  let host: RecoveryHost | undefined;
  try {
    const completion = completionModel(
      new Map([['EXPLICIT_RECOVERY', 'Recovered after parent departure.']]),
    );
    host = await launchPi(
      '{}',
      controls.path,
      'subagent',
      'fullscreen',
      async request => {
        const history = JSON.stringify(request.messages);
        const marker = latestMarker(request, [
          'INTERRUPT_ACTIVE',
          'EXPLICIT_RECOVERY',
        ]);
        if (
          history.includes('SUBAGENT_ASSIGNMENT') &&
          marker === 'INTERRUPT_ACTIVE'
        ) {
          activeModelCalls++;
          return {
            tool: 'fetch_content',
            arguments: JSON.stringify({
              urls: [`${server.url}slow`],
              mode: 'raw',
            }),
          };
        }
        return completion(request);
      },
    );
    const initialResponse = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {
            name: 'interrupted',
            prompt: 'INTERRUPT_ACTIVE',
            workspace: 'live',
            tools: ['subagent', 'fetch_content'],
            extensions: ['pi-stuff:web'],
          },
        ],
      }),
    );
    let initial;
    try {
      initial = Schema.decodeUnknownSync(AdmissionJson)(initialResponse);
    } catch (error) {
      throw new Error(
        `Interrupted admission was rejected: ${initialResponse}`,
        {
          cause: error,
        },
      );
    }
    const taskId = initial.tasks[0]?.taskId;
    const agentId = initial.tasks[0]?.agentId;
    expect(taskId).toBeDefined();
    expect(agentId).toBeDefined();
    if (taskId === undefined || agentId === undefined)
      throw new Error('Interrupted task admission was incomplete.');
    await slowStarted.promise;
    const originalSession = await saveCurrentSessionFile(host);
    await host.terminal.keyboard.type('/new');
    await host.terminal.keyboard.press('Enter');
    await Promise.all([
      slowAborted.promise,
      host.terminal.screen.waitForText('New session started', {
        timeoutMs: 15000,
      }),
    ]);
    const callsBeforeReopen = activeModelCalls;
    await switchToSession(host, originalSession);
    const interruptedRecord = await waitForRecord(host, record =>
      record.tasks.some(
        task => task.id === taskId && task.outcome === 'interrupted',
      ),
    );
    const interruptedTask = interruptedRecord.tasks.find(
      task => task.id === taskId,
    );
    expect(interruptedTask?.phase).toBe('ended');
    expect(interruptedTask?.stopOutcome).toBe('interrupted');
    expect(interruptedTask?.durability).toBe('saved');
    expect(activeModelCalls).toBe(callsBeforeReopen);
    expect(await host.invoke('subagent', '{"command":"inspect"}')).toContain(
      taskId,
    );
    expect(activeModelCalls).toBe(callsBeforeReopen);

    const rejected = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'followup',
        agentId,
        text: 'MUST_REQUIRE_RECOVERY',
      }),
    );
    expect(rejected).toContain('queue is held');
    const recoveryResponse = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'followup',
        agentId,
        text: 'EXPLICIT_RECOVERY',
        recovery: true,
      }),
    );
    let recovery;
    try {
      recovery = Schema.decodeUnknownSync(AdmissionJson)(recoveryResponse);
    } catch (error) {
      throw new Error(`Explicit recovery was rejected: ${recoveryResponse}`, {
        cause: error,
      });
    }
    const recoveryTaskId = recovery.tasks[0]?.taskId;
    expect(recoveryTaskId).toBeDefined();
    await waitForFleet(host);
    const recoveredRecord = await waitForRecord(host, record =>
      record.tasks.some(
        task => task.id === recoveryTaskId && task.outcome === 'fulfilled',
      ),
    );
    const recovered = recoveredRecord.tasks.find(
      task => task.id === recoveryTaskId,
    );
    const retainedInterrupted = recoveredRecord.tasks.find(
      task => task.id === taskId,
    );
    expect(recoveryTaskId).not.toBe(taskId);
    expect(
      recoveredRecord.tasks.filter(task => task.agentId === agentId),
    ).toHaveLength(2);
    expect(retainedInterrupted?.outcome).toBe('interrupted');
    expect(recovered?.outcome).toBe('fulfilled');
    expect(recovered?.report).toBe('Recovered after parent departure.');
  } finally {
    await host?.close();
    slowAborted.resolve();
    await server.stop(true);
    await controls.cleanup();
  }
}, 60000);

test('real Pi refuses a retained follow-up when its required child session file is missing', async () => {
  const reports = new Map([
    ['MISSING_SESSION_INITIAL', 'Initial session to remove.'],
    ['MISSING_SESSION_FOLLOWUP', 'This must never execute.'],
  ]);
  let followupModelCalls = 0;
  let host: RecoveryHost | undefined;
  try {
    host = await launchPi(
      '{}',
      undefined,
      'subagent',
      'fullscreen',
      completionModel(reports, marker => {
        if (marker === 'MISSING_SESSION_FOLLOWUP') followupModelCalls++;
      }),
    );
    const initial = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'missing-session',
              prompt: 'MISSING_SESSION_INITIAL',
              workspace: 'live',
              tools: ['subagent'],
            },
          ],
        }),
      ),
    );
    const taskId = initial.tasks[0]?.taskId;
    const agentId = initial.tasks[0]?.agentId;
    expect(taskId).toBeDefined();
    expect(agentId).toBeDefined();
    if (taskId === undefined || agentId === undefined)
      throw new Error('Missing-session task admission was incomplete.');
    await waitForFleet(host);
    const initialRecord = await waitForRecord(host, record =>
      record.tasks.some(
        task => task.id === taskId && task.outcome === 'fulfilled',
      ),
    );
    const initialTask = initialRecord.tasks.find(task => task.id === taskId);
    const sessionFile = initialTask?.sessionFile;
    expect(sessionFile).toBeTruthy();
    await rm(sessionFile ?? '');

    const followup = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'followup',
          agentId,
          text: 'MISSING_SESSION_FOLLOWUP',
        }),
      ),
    );
    const followupTaskId = followup.tasks[0]?.taskId;
    expect(followupTaskId).toBeDefined();
    await waitForFleet(host);
    const finalRecord = await waitForRecord(host, record =>
      record.tasks.some(
        task => task.id === followupTaskId && task.phase === 'ended',
      ),
    );
    const followupTask = finalRecord.tasks.find(
      task => task.id === followupTaskId,
    );
    expect(followupTask?.outcome).toBe('failed');
    expect(followupTask?.durability).toBe('saved');
    expect(followupTask?.reason).toContain(
      'Required child session file is missing',
    );
    expect(followupModelCalls).toBe(0);
  } finally {
    await host?.close();
  }
}, 60000);
