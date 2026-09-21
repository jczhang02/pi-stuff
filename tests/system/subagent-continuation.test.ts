import {expect, test} from 'bun:test';
import {rm, writeFile} from 'node:fs/promises';
import {Schema} from 'effect';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const Usage = Schema.Struct({
  input: Schema.optional(Schema.Number),
  output: Schema.optional(Schema.Number),
  cacheRead: Schema.optional(Schema.Number),
  cacheWrite: Schema.optional(Schema.Number),
  cost: Schema.optional(Schema.Number),
  turns: Schema.Number,
});

const Question = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  expiresAt: Schema.Number,
});

const HistoryEntry = Schema.Struct({
  requestId: Schema.String,
  task: Schema.String,
  status: Schema.String,
  finalText: Schema.String,
  startEntryId: Schema.optional(Schema.String),
  endEntryId: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.Number),
  endedAt: Schema.optional(Schema.Number),
  sessionId: Schema.optional(Schema.String),
  sessionFile: Schema.optional(Schema.String),
  usage: Schema.optional(Usage),
});

const TaskSnapshot = Schema.Struct({
  id: Schema.String,
  agent: Schema.String,
  task: Schema.String,
  cwd: Schema.String,
  needs: Schema.Array(Schema.String),
  status: Schema.String,
  finalText: Schema.String,
  requestId: Schema.String,
  history: Schema.Array(HistoryEntry),
  pendingInstructions: Schema.Array(Schema.String),
  configurationNotes: Schema.Array(Schema.String),
  startEntryId: Schema.optional(Schema.String),
  endEntryId: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.Number),
  endedAt: Schema.optional(Schema.Number),
  sessionId: Schema.optional(Schema.String),
  sessionFile: Schema.optional(Schema.String),
  question: Schema.optional(Question),
  usage: Schema.optional(Usage),
  cumulativeUsage: Schema.optional(Usage),
  error: Schema.optional(Schema.String),
});

const RunSnapshot = Schema.Struct({
  id: Schema.String,
  mode: Schema.String,
  status: Schema.String,
  tasks: Schema.Array(TaskSnapshot),
});

type RunSnapshot = Schema.Schema.Type<typeof RunSnapshot>;
type TaskSnapshot = Schema.Schema.Type<typeof TaskSnapshot>;

type DispatchInput = Readonly<{
  command: 'dispatch';
  agent?: string;
  task?: string;
  tasks?: readonly Readonly<{
    id: string;
    agent: string;
    task: string;
    needs?: readonly string[];
  }>[];
  autoAwait: boolean;
  notifyPerTask: boolean;
}>;

type QueryInput = Readonly<{
  command: 'status' | 'result' | 'wait' | 'cancel';
  runId: string;
  taskId?: string;
}>;

type ContinuationInput = Readonly<{
  command: 'resume' | 'follow-up';
  runId: string;
  taskId: string;
  message: string;
  autoAwait: boolean;
}>;

type SubagentInput = DispatchInput | QueryInput | ContinuationInput;

function messageText(message: PiFixtureRequest['messages'][number]): string {
  const content = message.content;
  if (content === undefined || content === null) return '';
  if (Schema.is(Schema.String)(content)) return content;
  return content.map(block => block.text ?? '').join('');
}

function userTexts(request: PiFixtureRequest): string[] {
  return request.messages
    .filter(message => message.role === 'user')
    .map(messageText);
}

function latestUserText(request: PiFixtureRequest): string {
  return userTexts(request).at(-1) ?? '';
}

function requestText(request: PiFixtureRequest): string {
  return request.messages.map(messageText).join('\n');
}

function toolNames(request: PiFixtureRequest): string[] {
  return request.tools?.map(tool => tool.function.name) ?? [];
}

function decodeRun(serialized: string): RunSnapshot {
  return Schema.decodeUnknownSync(RunSnapshot)(JSON.parse(serialized));
}

function decodeTask(serialized: string): TaskSnapshot {
  return Schema.decodeUnknownSync(TaskSnapshot)(JSON.parse(serialized));
}

async function invokeRun(
  host: Awaited<ReturnType<typeof launchPi>>,
  input: SubagentInput,
): Promise<RunSnapshot> {
  return decodeRun(await host.invoke('subagent', JSON.stringify(input)));
}

async function invokeTask(
  host: Awaited<ReturnType<typeof launchPi>>,
  input: QueryInput,
): Promise<TaskSnapshot> {
  return decodeTask(await host.invoke('subagent', JSON.stringify(input)));
}

async function invokeRaw(
  host: Awaited<ReturnType<typeof launchPi>>,
  input: SubagentInput,
): Promise<string> {
  return host.invoke('subagent', JSON.stringify(input));
}

function taskById(run: RunSnapshot, taskId: string): TaskSnapshot {
  const task = run.tasks.find(candidate => candidate.id === taskId);
  if (task === undefined)
    throw new Error(`Run ${run.id} did not include task ${taskId}.`);
  return task;
}

async function waitForTask(
  host: Awaited<ReturnType<typeof launchPi>>,
  runId: string,
  taskId: string,
  predicate: (task: TaskSnapshot) => boolean,
  timeoutMs: number,
): Promise<TaskSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let task = await invokeTask(host, {
    command: 'result',
    runId,
    taskId,
  });
  while (!predicate(task) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
    task = await invokeTask(host, {
      command: 'result',
      runId,
      taskId,
    });
  }
  return task;
}

test('follows up a completed reviewer in place and preserves history and usage', async () => {
  const childRequests: PiFixtureRequest[] = [];
  const responseCallback: PiFixtureResponseCallback = request => {
    if (toolNames(request).includes('subagent')) return undefined;
    childRequests.push(request);
    const latest = latestUserText(request);
    if (latest.includes('FOLLOWUP_REVIEW'))
      return {
        type: 'content',
        content: `FOLLOWUP_REPORT:${latest}`,
        usage: {input: 13, output: 5},
      };
    if (latest.includes('DEPENDENT_REVIEW'))
      return {
        type: 'content',
        content: `DEPENDENT_REPORT:${latest}`,
        usage: {input: 17, output: 3},
      };
    if (latest.includes('INITIAL_REVIEW'))
      return {
        type: 'content',
        content: `INITIAL_REPORT:${latest}`,
        usage: {input: 11, output: 7},
      };
    return undefined;
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
      tasks: [
        {
          id: 'reviewer',
          agent: 'reviewer',
          task: 'INITIAL_REVIEW',
        },
        {
          id: 'dependent',
          agent: 'dependent',
          task: 'DEPENDENT_REVIEW',
          needs: ['reviewer'],
        },
      ],
      autoAwait: true,
      notifyPerTask: false,
    });
    expect(initial.status).toBe('completed');
    const first = taskById(initial, 'reviewer');
    const dependent = taskById(initial, 'dependent');
    expect(first.status).toBe('completed');
    expect(first.finalText).toContain('INITIAL_REPORT');
    expect(first.history).toHaveLength(0);
    expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.sessionId).toBeDefined();
    expect(first.sessionFile).toBeDefined();
    expect(first.startEntryId).toBeDefined();
    expect(first.endEntryId).toBeDefined();
    expect(first.usage?.input).toBe(11);
    expect(first.usage?.output).toBe(7);
    expect(first.usage?.turns).toBe(1);
    expect(first.cumulativeUsage?.input).toBe(11);
    expect(first.cumulativeUsage?.output).toBe(7);
    expect(first.cumulativeUsage?.turns).toBe(1);
    expect(first.startedAt).toBeDefined();
    expect(first.endedAt).toBeDefined();
    expect(dependent.status).toBe('completed');
    expect(dependent.finalText).toContain('DEPENDENT_REPORT');
    const dependentRequests = () =>
      childRequests.filter(request =>
        latestUserText(request).includes('DEPENDENT_REVIEW'),
      ).length;
    expect(dependentRequests()).toBe(1);

    const completedResume = await invokeRaw(host, {
      command: 'resume',
      runId: initial.id,
      taskId: 'reviewer',
      message: 'RESUME_COMPLETED_REVIEW',
      autoAwait: true,
    });
    expect(completedResume.toLowerCase()).toMatch(/resume|completed|available/);
    const afterRejectedResume = await invokeTask(host, {
      command: 'result',
      runId: initial.id,
      taskId: 'reviewer',
    });
    expect(afterRejectedResume.requestId).toBe(first.requestId);
    expect(afterRejectedResume.history).toHaveLength(0);
    expect(
      childRequests.some(request =>
        latestUserText(request).includes('RESUME_COMPLETED_REVIEW'),
      ),
    ).toBe(false);

    const continued = await invokeRun(host, {
      command: 'follow-up',
      runId: initial.id,
      taskId: 'reviewer',
      message: 'FOLLOWUP_REVIEW',
      autoAwait: true,
    });
    expect(continued.status).toBe('completed');
    const current = await invokeTask(host, {
      command: 'result',
      runId: initial.id,
      taskId: 'reviewer',
    });
    expect(current.status).toBe('completed');
    expect(current.finalText).toContain('FOLLOWUP_REPORT');
    expect(current.requestId).not.toBe(first.requestId);
    expect(current.history).toHaveLength(1);
    const previous = current.history[0];
    if (previous === undefined) throw new Error('Missing follow-up history.');
    expect(previous.requestId).toBe(first.requestId);
    expect(previous.status).toBe('completed');
    expect(previous.finalText).toContain('INITIAL_REPORT');
    expect(previous.startedAt).toBe(first.startedAt);
    expect(previous.endedAt).toBe(first.endedAt);
    expect(previous.sessionId).toBe(first.sessionId);
    expect(previous.sessionFile).toBe(first.sessionFile);
    expect(previous.startEntryId).toBe(first.startEntryId);
    expect(previous.endEntryId).toBe(first.endEntryId);
    expect(previous.usage?.input).toBe(11);
    expect(previous.usage?.output).toBe(7);
    expect(current.sessionId).toBe(first.sessionId);
    expect(current.sessionFile).toBe(first.sessionFile);
    expect(current.startEntryId).not.toBe(first.startEntryId);
    expect(current.endEntryId).not.toBe(first.endEntryId);
    expect(current.usage?.input).toBe(13);
    expect(current.usage?.output).toBe(5);
    expect(current.usage?.turns).toBe(1);
    expect(current.cumulativeUsage?.input).toBe(24);
    expect(current.cumulativeUsage?.output).toBe(12);
    expect(current.cumulativeUsage?.turns).toBe(2);
    expect(dependentRequests()).toBe(1);

    const followupRequest = childRequests.find(request =>
      latestUserText(request).includes('FOLLOWUP_REVIEW'),
    );
    if (followupRequest === undefined)
      throw new Error('Missing provider request for follow-up.');
    expect(requestText(followupRequest)).toContain('INITIAL_REVIEW');
    expect(requestText(followupRequest)).toContain('INITIAL_REPORT');
  } finally {
    await host.close();
  }
}, 60000);

test('resumes a stopped questioner in the same session and keeps the stopped request', async () => {
  const childRequests: PiFixtureRequest[] = [];
  const responseCallback: PiFixtureResponseCallback = request => {
    if (toolNames(request).includes('subagent')) return undefined;
    childRequests.push(request);
    const latest = latestUserText(request);
    if (latest.includes('QUESTIONER_RESUME'))
      return {
        type: 'content',
        content: `RESUMED_REPORT:${latest}`,
        usage: {input: 19, output: 4},
      };
    if (latest.includes('QUESTIONER_INITIAL'))
      return {
        type: 'tool_call',
        name: 'ask_parent',
        arguments: JSON.stringify({question: 'Resume this questioner.'}),
      };
    return undefined;
  };
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    responseCallback,
  );
  try {
    const dispatched = await invokeRun(host, {
      command: 'dispatch',
      agent: 'questioner',
      task: 'QUESTIONER_INITIAL',
      autoAwait: false,
      notifyPerTask: false,
    });
    const waiting = await waitForTask(
      host,
      dispatched.id,
      'task_1',
      task => task.status === 'awaiting_parent',
      5000,
    );
    expect(waiting.status).toBe('awaiting_parent');
    expect(waiting.sessionId).toBeDefined();
    expect(waiting.sessionFile).toBeDefined();

    await invokeRun(host, {
      command: 'cancel',
      runId: dispatched.id,
      taskId: 'task_1',
    });
    const stopped = await waitForTask(
      host,
      dispatched.id,
      'task_1',
      task => task.status === 'stopped',
      5000,
    );
    expect(stopped.status).toBe('stopped');
    expect(stopped.history).toHaveLength(0);
    expect(stopped.usage?.input).toBeUndefined();
    expect(stopped.usage?.output).toBeUndefined();
    expect(stopped.usage?.turns).toBeGreaterThan(0);
    expect(stopped.cumulativeUsage?.input).toBeUndefined();
    expect(stopped.cumulativeUsage?.output).toBeUndefined();
    expect(stopped.cumulativeUsage?.turns).toBeGreaterThan(0);
    const stoppedBeforeResume = {
      requestId: stopped.requestId,
      finalText: stopped.finalText,
      sessionId: stopped.sessionId,
      sessionFile: stopped.sessionFile,
      startEntryId: stopped.startEntryId,
      endEntryId: stopped.endEntryId,
      startedAt: stopped.startedAt,
      endedAt: stopped.endedAt,
    };
    expect(stoppedBeforeResume.sessionId).toBeDefined();
    expect(stoppedBeforeResume.sessionFile).toBeDefined();

    const resumed = await invokeRun(host, {
      command: 'resume',
      runId: dispatched.id,
      taskId: 'task_1',
      message: 'QUESTIONER_RESUME',
      autoAwait: true,
    });
    expect(resumed.status).toBe('completed');
    const current = await invokeTask(host, {
      command: 'result',
      runId: dispatched.id,
      taskId: 'task_1',
    });
    expect(current.status).toBe('completed');
    expect(current.finalText).toContain('RESUMED_REPORT');
    expect(current.requestId).not.toBe(stoppedBeforeResume.requestId);
    expect(current.sessionId).toBe(stoppedBeforeResume.sessionId);
    expect(current.sessionFile).toBe(stoppedBeforeResume.sessionFile);
    expect(current.history).toHaveLength(1);
    expect(current.history[0]?.status).toBe('stopped');
    expect(current.history[0]?.requestId).toBe(stoppedBeforeResume.requestId);
    expect(current.history[0]?.finalText).toBe(stoppedBeforeResume.finalText);
    expect(current.history[0]?.startedAt).toBe(stoppedBeforeResume.startedAt);
    expect(current.history[0]?.endedAt).toBe(stoppedBeforeResume.endedAt);
    expect(current.usage?.input).toBe(19);
    expect(current.usage?.output).toBe(4);
    expect(current.cumulativeUsage?.input).toBe(19);
    expect(current.cumulativeUsage?.output).toBe(4);
    const resumedRequest = childRequests.find(request =>
      latestUserText(request).includes('QUESTIONER_RESUME'),
    );
    if (resumedRequest === undefined)
      throw new Error('Missing provider request for resume.');
    expect(requestText(resumedRequest)).toContain('QUESTIONER_INITIAL');
  } finally {
    await host.close();
  }
}, 60000);

test('rejects missing or empty saved sessions without erasing the prior report', async () => {
  const childRequests: PiFixtureRequest[] = [];
  const responseCallback: PiFixtureResponseCallback = request => {
    if (toolNames(request).includes('subagent')) return undefined;
    childRequests.push(request);
    const latest = latestUserText(request);
    if (latest.includes('SAVED_REPORT'))
      return {
        type: 'content',
        content: 'SAVED_REPORT_RESULT',
        usage: {input: 23, output: 6},
      };
    if (latest.includes('SHOULD_NOT_RUN'))
      return {
        type: 'content',
        content: 'UNEXPECTED_CONTINUATION',
        usage: {input: 29, output: 2},
      };
    return undefined;
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
      agent: 'saved-reviewer',
      task: 'SAVED_REPORT',
      autoAwait: true,
      notifyPerTask: false,
    });
    const first = taskById(initial, 'task_1');
    if (first.sessionFile === undefined)
      throw new Error('Completed task did not expose a saved session file.');
    const report = first.finalText;
    const requestId = first.requestId;
    const sessionFile = first.sessionFile;
    expect(first.history).toHaveLength(0);
    expect(first.status).toBe('completed');

    await rm(sessionFile);
    const missing = await invokeRaw(host, {
      command: 'follow-up',
      runId: initial.id,
      taskId: 'task_1',
      message: 'SHOULD_NOT_RUN_MISSING',
      autoAwait: true,
    });
    expect(missing.toLowerCase()).toMatch(/session|saved|continue/);
    const afterMissing = await invokeTask(host, {
      command: 'result',
      runId: initial.id,
      taskId: 'task_1',
    });
    expect(afterMissing.requestId).toBe(requestId);
    expect(afterMissing.finalText).toBe(report);
    expect(afterMissing.history).toHaveLength(0);

    await writeFile(sessionFile, '');
    const empty = await invokeRaw(host, {
      command: 'follow-up',
      runId: initial.id,
      taskId: 'task_1',
      message: 'SHOULD_NOT_RUN_EMPTY',
      autoAwait: true,
    });
    expect(empty.toLowerCase()).toMatch(/session|saved|continue|parse/);
    const afterEmpty = await invokeTask(host, {
      command: 'result',
      runId: initial.id,
      taskId: 'task_1',
    });
    expect(afterEmpty.requestId).toBe(requestId);
    expect(afterEmpty.finalText).toBe(report);
    expect(afterEmpty.history).toHaveLength(0);
    expect(
      childRequests.some(request =>
        latestUserText(request).includes('SHOULD_NOT_RUN'),
      ),
    ).toBe(false);
  } finally {
    await host.close();
  }
}, 60000);
