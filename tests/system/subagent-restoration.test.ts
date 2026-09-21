import {expect, test} from 'bun:test';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import {RunSnapshot, TaskSnapshot} from '../../src/subagent/records';
import type {SubagentParameters} from '../../src/subagent/protocol';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const Sidecar = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    runs: Schema.Array(RunSnapshot),
  }),
);
type Sidecar = typeof Sidecar.Type;
const decodeTask = Schema.decodeUnknownSync(
  Schema.fromJsonString(TaskSnapshot),
);
const decodeRun = Schema.decodeUnknownSync(Schema.fromJsonString(RunSnapshot));
const decodeSidecar = Schema.decodeUnknownSync(Sidecar);
const decodeHeader = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      type: Schema.Literal('session'),
      parentSession: Schema.optional(Schema.String),
    }),
  ),
);

function messageText(message: PiFixtureRequest['messages'][number]): string {
  const content = message.content;
  if (content === undefined || content === null) return '';
  if (Schema.is(Schema.String)(content)) return content;
  return content.map(block => block.text ?? '').join('');
}

function latestUserText(request: PiFixtureRequest): string {
  return (
    request.messages
      .filter(message => message.role === 'user')
      .map(messageText)
      .at(-1) ?? ''
  );
}

function requestText(request: PiFixtureRequest): string {
  return request.messages.map(messageText).join('\n');
}

function toolNames(request: PiFixtureRequest): string[] {
  return request.tools?.map(tool => tool.function.name) ?? [];
}

function taskById(run: RunSnapshot, taskId: string): TaskSnapshot {
  const task = run.tasks.find(candidate => candidate.id === taskId);
  if (task === undefined)
    throw new Error(`Run ${run.id} did not include task ${taskId}.`);
  return task;
}

async function invokeRun(
  host: Awaited<ReturnType<typeof launchPi>>,
  input: SubagentParameters,
): Promise<RunSnapshot> {
  return decodeRun(await host.invoke('subagent', JSON.stringify(input)));
}

async function invokeTask(
  host: Awaited<ReturnType<typeof launchPi>>,
  input: SubagentParameters,
): Promise<TaskSnapshot> {
  return decodeTask(await host.invoke('subagent', JSON.stringify(input)));
}

async function invokeRaw(
  host: Awaited<ReturnType<typeof launchPi>>,
  input: SubagentParameters,
): Promise<string> {
  return host.invoke('subagent', JSON.stringify(input));
}

async function sessionFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await sessionFiles(path)));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(path);
  }
  return found;
}

async function parentSessionFile(
  host: Awaited<ReturnType<typeof launchPi>>,
): Promise<string> {
  const candidates = await sessionFiles(join(host.directory, 'sessions'));
  for (const file of candidates) {
    const firstLine = (await readFile(file, 'utf8')).split(/\r?\n/, 1)[0];
    if (firstLine === undefined) continue;
    const header = decodeHeader(firstLine);
    if (header.type === 'session' && header.parentSession === undefined)
      return file;
  }
  throw new Error('Could not locate the parent Pi session file.');
}

async function readSidecar(path: string): Promise<Sidecar> {
  return decodeSidecar(await readFile(path, 'utf8'));
}

function responseFor(
  request: PiFixtureRequest,
  reports: ReadonlyMap<string, string>,
): ReturnType<PiFixtureResponseCallback> {
  if (toolNames(request).includes('subagent')) return undefined;
  const latest = latestUserText(request);
  for (const [marker, report] of reports) {
    if (latest.includes(marker)) return {type: 'content', content: report};
  }
  return undefined;
}

test('restores a completed child and follows up through the retained native session', async () => {
  const childRequests: PiFixtureRequest[] = [];
  const reports = new Map([
    ['RESTORE_INITIAL', 'RESTORE_INITIAL_REPORT'],
    ['RESTORE_FOLLOWUP', 'RESTORE_FOLLOWUP_REPORT'],
  ]);
  const responseCallback: PiFixtureResponseCallback = request => {
    if (!toolNames(request).includes('subagent')) childRequests.push(request);
    return responseFor(request, reports);
  };
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    responseCallback,
  );
  try {
    const initial = await invokeRun(host, {
      command: 'dispatch',
      agent: 'restorer',
      task: 'RESTORE_INITIAL',
      autoAwait: true,
      notifyPerTask: false,
    });
    const first = taskById(initial, 'task_1');
    expect(initial.status).toBe('completed');
    expect(first.status).toBe('completed');
    expect(first.finalText).toContain('RESTORE_INITIAL_REPORT');
    expect(first.history).toHaveLength(0);
    expect(first.sessionId).toBeDefined();
    expect(first.sessionFile).toBeDefined();
    expect(childRequests).toHaveLength(1);

    const parentFile = await parentSessionFile(host);
    const sidecarFile = `${parentFile}.pi-stuff-subagents.json`;
    await readSidecar(sidecarFile);
    const legacyFile = parentFile.replace(/\.jsonl$/, '.subagents.json');
    await writeFile(legacyFile, 'LEGACY_SUBAGENT_SENTINEL');
    const childRequestsBeforeReload = childRequests.length;

    await host.reload();
    const restored = await invokeTask(host, {
      command: 'result',
      runId: initial.id,
      taskId: 'task_1',
    });
    expect(restored.status).toBe('completed');
    expect(restored.requestId).toBe(first.requestId);
    expect(restored.finalText).toBe(first.finalText);
    expect(restored.history).toHaveLength(0);
    expect(restored.sessionId).toBe(first.sessionId);
    expect(restored.sessionFile).toBe(first.sessionFile);
    expect(childRequests).toHaveLength(childRequestsBeforeReload);

    const continued = await invokeRun(host, {
      command: 'follow-up',
      runId: initial.id,
      taskId: 'task_1',
      message: 'RESTORE_FOLLOWUP',
      autoAwait: true,
    });
    const current = taskById(continued, 'task_1');
    expect(continued.status).toBe('completed');
    expect(current.status).toBe('completed');
    expect(current.finalText).toContain('RESTORE_FOLLOWUP_REPORT');
    expect(current.requestId).not.toBe(first.requestId);
    expect(current.sessionId).toBe(first.sessionId);
    expect(current.sessionFile).toBe(first.sessionFile);
    expect(current.history).toHaveLength(1);
    expect(current.history[0]?.requestId).toBe(first.requestId);
    expect(current.history[0]?.finalText).toBe(first.finalText);
    expect(childRequests).toHaveLength(childRequestsBeforeReload + 1);
    const followupRequest = childRequests.at(-1);
    if (followupRequest === undefined)
      throw new Error('Missing provider request for restored follow-up.');
    expect(requestText(followupRequest)).toContain('RESTORE_INITIAL_REPORT');
    expect(await readFile(legacyFile, 'utf8')).toBe('LEGACY_SUBAGENT_SENTINEL');
    const saved = await readSidecar(sidecarFile);
    const savedRun = saved.runs.find(run => run.id === initial.id);
    if (savedRun === undefined) throw new Error('Restored run was not saved.');
    expect(taskById(savedRun, 'task_1').history).toHaveLength(1);
  } finally {
    await host.close();
  }
}, 60000);

test('marks an interrupted restored task stopped and invalidates stale questions', async () => {
  const childRequests: PiFixtureRequest[] = [];
  const reports = new Map([
    ['INTERRUPTED_INITIAL', 'INTERRUPTED_INITIAL_REPORT'],
    ['INTERRUPTED_FOLLOWUP', 'INTERRUPTED_FOLLOWUP_REPORT'],
    ['INTERRUPTED_RESUME', 'INTERRUPTED_RESUME_REPORT'],
  ]);
  const responseCallback: PiFixtureResponseCallback = request => {
    if (!toolNames(request).includes('subagent')) childRequests.push(request);
    return responseFor(request, reports);
  };
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    responseCallback,
  );
  try {
    const initial = await invokeRun(host, {
      command: 'dispatch',
      agent: 'interrupted-restorer',
      task: 'INTERRUPTED_INITIAL',
      autoAwait: true,
      notifyPerTask: false,
    });
    const continued = await invokeRun(host, {
      command: 'follow-up',
      runId: initial.id,
      taskId: 'task_1',
      message: 'INTERRUPTED_FOLLOWUP',
      autoAwait: true,
    });
    const current = taskById(continued, 'task_1');
    const parentFile = await parentSessionFile(host);
    const sidecarFile = `${parentFile}.pi-stuff-subagents.json`;
    const sidecar = await readSidecar(sidecarFile);
    const storedRun = sidecar.runs.find(run => run.id === initial.id);
    if (storedRun === undefined) throw new Error('Run was not persisted.');
    const storedTask = taskById(storedRun, 'task_1');
    storedRun.status = 'running';
    storedTask.status = 'running';
    storedTask.question = {
      id: 'stale-question',
      text: 'This question must not survive a restart.',
      expiresAt: Date.now() + 60_000,
    };
    storedTask.pendingInstructions = ['STALE_PENDING_INSTRUCTION'];
    await writeFile(sidecarFile, `${JSON.stringify(sidecar)}\n`);
    const childRequestsBeforeReload = childRequests.length;

    await host.reload();
    const stopped = await invokeTask(host, {
      command: 'result',
      runId: initial.id,
      taskId: 'task_1',
    });
    expect(stopped.status).toBe('stopped');
    expect(stopped.error).toMatch(/Interrupted/);
    expect(stopped.question).toBeUndefined();
    expect(stopped.pendingInstructions).toEqual(['STALE_PENDING_INSTRUCTION']);
    expect(stopped.finalText).toBe(current.finalText);
    expect(stopped.history).toHaveLength(1);
    expect(stopped.history[0]?.finalText).toContain(
      'INTERRUPTED_INITIAL_REPORT',
    );
    expect(childRequests).toHaveLength(childRequestsBeforeReload);

    const reply = await invokeRaw(host, {
      command: 'reply',
      runId: initial.id,
      taskId: 'task_1',
      questionId: 'stale-question',
      message: 'STALE_REPLY_MUST_FAIL',
    });
    expect(reply.toLowerCase()).toMatch(/question|stopped|awaiting|unknown/);
    expect(childRequests).toHaveLength(childRequestsBeforeReload);
    const resumed = await invokeRun(host, {
      command: 'resume',
      runId: initial.id,
      taskId: 'task_1',
      message: 'INTERRUPTED_RESUME',
      autoAwait: true,
    });
    const next = taskById(resumed, 'task_1');
    expect(next.status).toBe('completed');
    expect(next.finalText).toContain('INTERRUPTED_RESUME_REPORT');
    expect(next.pendingInstructions).toEqual([]);
    expect(next.history.at(-1)?.pendingInstructions).toEqual([
      'STALE_PENDING_INSTRUCTION',
    ]);
    expect(childRequests).toHaveLength(childRequestsBeforeReload + 1);
    const request = childRequests.at(-1);
    if (!request) throw new Error('Missing resumed child request.');
    expect(requestText(request)).not.toContain('STALE_PENDING_INSTRUCTION');
  } finally {
    await host.close();
  }
}, 60000);

test.each(['corrupt JSON', 'read-only record with write tools'])(
  'reports %s and preserves its bytes across later dispatch',
  async corruption => {
    const childRequests: PiFixtureRequest[] = [];
    const reports = new Map([['CORRUPT_AFTER_RELOAD', 'CORRUPT_REPORT']]);
    const responseCallback: PiFixtureResponseCallback = request => {
      if (!toolNames(request).includes('subagent')) childRequests.push(request);
      return responseFor(request, reports);
    };
    const host = await launchPi(
      '{}',
      undefined,
      'subagent',
      'fullscreen',
      responseCallback,
    );
    try {
      const initial = await invokeRun(host, {
        command: 'dispatch',
        agent: 'corrupt-sidecar-seed',
        task: 'CORRUPT_SIDEcar_SEED',
        autoAwait: true,
        notifyPerTask: false,
      });
      const parentFile = await parentSessionFile(host);
      const sidecarFile = `${parentFile}.pi-stuff-subagents.json`;
      await readSidecar(sidecarFile);
      const saved = await readSidecar(sidecarFile);
      let corruptBytes = '{"version":1,"runs":[';
      if (corruption === 'read-only record with write tools') {
        const savedRun = saved.runs.find(run => run.id === initial.id);
        if (!savedRun) throw new Error('Missing seed record.');
        const task = taskById(savedRun, 'task_1');
        expect(task.write).toBe(false);
        task.tools.push('bash');
        corruptBytes = JSON.stringify(saved);
      }
      await writeFile(sidecarFile, corruptBytes);

      await host.reload();
      const screen = await host.terminal.screen.text();
      expect(screen).toContain('Invalid subagent records');
      expect(childRequests).toHaveLength(1);
      const rejected = await invokeRaw(host, {
        command: 'follow-up',
        runId: initial.id,
        taskId: 'task_1',
        message: 'MUST_NOT_EXECUTE_INVALID_RECORD',
        autoAwait: true,
      });
      expect(rejected).toContain('Unknown run');
      expect(childRequests).toHaveLength(1);

      const dispatched = await invokeRun(host, {
        command: 'dispatch',
        agent: 'after-corrupt-sidecar',
        task: 'CORRUPT_AFTER_RELOAD',
        autoAwait: true,
        notifyPerTask: false,
      });
      expect(dispatched.status).toBe('completed');
      expect(dispatched.persistenceError).toContain('Invalid subagent records');
      expect(taskById(dispatched, 'task_1').finalText).toContain(
        'CORRUPT_REPORT',
      );
      expect(await readFile(sidecarFile, 'utf8')).toBe(corruptBytes);
      expect(initial.id).not.toBe(dispatched.id);
    } finally {
      await host.close();
    }
  },
  60000,
);

test('retries a failed save without losing completed continuation records', async () => {
  const reports = new Map([
    ['SAVE_INITIAL', 'SAVE_INITIAL_REPORT'],
    ['SAVE_FOLLOWUP', 'SAVE_FOLLOWUP_REPORT'],
  ]);
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => responseFor(request, reports),
  );
  let blockedPath: string | undefined;
  try {
    const initial = await invokeRun(host, {
      command: 'dispatch',
      agent: 'save-retry',
      task: 'SAVE_INITIAL',
      autoAwait: true,
      notifyPerTask: false,
    });
    const sidecar = `${await parentSessionFile(host)}.pi-stuff-subagents.json`;
    await rename(sidecar, `${sidecar}.backup`);
    await mkdir(sidecar);
    blockedPath = sidecar;
    const continued = await invokeRun(host, {
      command: 'follow-up',
      runId: initial.id,
      taskId: 'task_1',
      message: 'SAVE_FOLLOWUP',
      autoAwait: true,
    });
    expect(continued.status).toBe('completed');
    expect(continued.persistenceError).toContain(
      'Could not save subagent records',
    );
    expect(taskById(continued, 'task_1').finalText).toContain(
      'SAVE_FOLLOWUP_REPORT',
    );
    expect(taskById(continued, 'task_1').history).toHaveLength(1);
    await rm(sidecar, {recursive: true});
    blockedPath = undefined;
    await rename(`${sidecar}.backup`, sidecar);
    const retried = await invokeRun(host, {
      command: 'result',
      runId: initial.id,
    });
    expect(retried.persistenceError).toBeUndefined();
    const saved = await readSidecar(sidecar);
    const run = saved.runs.find(run => run.id === initial.id);
    if (!run) throw new Error('Retried save omitted the run.');
    expect(taskById(run, 'task_1').history).toHaveLength(1);
    expect(taskById(run, 'task_1').finalText).toContain('SAVE_FOLLOWUP_REPORT');
  } finally {
    if (blockedPath) await rm(blockedPath, {recursive: true});
    await host.close();
  }
}, 60000);
