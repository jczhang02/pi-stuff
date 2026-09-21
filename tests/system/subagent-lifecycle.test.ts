import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const TIMEOUT_MARKER = 'LIFECYCLE_TIMEOUT_TASK';
const CANCELLED_MARKER = 'LIFECYCLE_CANCELLED_TASK';
const SIBLING_MARKER = 'LIFECYCLE_SIBLING_TASK';
const DEPENDENT_MARKER = 'LIFECYCLE_DEPENDENT_TASK';

const Question = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  expiresAt: Schema.Number,
});
const TaskSnapshot = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  finalText: Schema.String,
  needs: Schema.Array(Schema.String),
  error: Schema.optional(Schema.String),
  question: Schema.optional(Question),
});
const RunSnapshot = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  tasks: Schema.Array(TaskSnapshot),
});

type RunSnapshot = Schema.Schema.Type<typeof RunSnapshot>;
type TaskInput = Readonly<{
  id: string;
  agent: string;
  task: string;
  needs?: readonly string[];
}>;
type DispatchInput = Readonly<{
  command: 'dispatch';
  agent?: string;
  task?: string;
  maxRuntimeMs?: number;
  tasks?: readonly TaskInput[];
  concurrency?: number;
  autoAwait?: boolean;
  notifyPerTask?: boolean;
}>;
type QueryInput = Readonly<{
  command: 'status' | 'result' | 'wait' | 'cancel';
  runId: string;
  taskId?: string;
  timeoutMs?: number;
}>;
type SubagentInput = DispatchInput | QueryInput;

function messageText(message: PiFixtureRequest['messages'][number]): string {
  const content = message.content;
  if (content === undefined || content === null) return '';
  if (Schema.is(Schema.String)(content)) return content;
  return content.map(block => block.text ?? '').join('');
}

function requestText(request: PiFixtureRequest): string {
  return request.messages.map(messageText).join('\n');
}

function latestUserText(request: PiFixtureRequest): string {
  return (
    request.messages
      .filter(message => message.role === 'user')
      .map(messageText)
      .at(-1) ?? ''
  );
}

function fixtureCallback(
  asked: string[],
  childPrompts: string[],
): PiFixtureResponseCallback {
  return request => {
    const names = request.tools?.map(tool => tool.function.name) ?? [];
    if (names.includes('subagent')) return undefined;

    const text = requestText(request);
    const taskText = latestUserText(request);
    const lastMessage = request.messages.at(-1);
    if (taskText.includes(TIMEOUT_MARKER)) {
      if (lastMessage?.role === 'tool') {
        childPrompts.push(text);
        return {
          type: 'content',
          content: `TIMEOUT_REPORT:${text}`,
        };
      }
      asked.push(TIMEOUT_MARKER);
      return {
        type: 'tool_call',
        name: 'ask_parent',
        arguments: JSON.stringify({question: 'Hold this child open.'}),
      };
    }

    if (taskText.includes(CANCELLED_MARKER)) {
      if (lastMessage?.role === 'tool') {
        childPrompts.push(text);
        return {
          type: 'content',
          content: `CANCELLED_REPORT:${text}`,
        };
      }
      asked.push(CANCELLED_MARKER);
      return {
        type: 'tool_call',
        name: 'ask_parent',
        arguments: JSON.stringify({question: 'Hold this child open.'}),
      };
    }

    if (taskText.includes(SIBLING_MARKER)) {
      childPrompts.push(text);
      return {
        type: 'content',
        content: `SIBLING_REPORT:${text}`,
      };
    }

    if (taskText.includes(DEPENDENT_MARKER)) {
      childPrompts.push(text);
      return {
        type: 'content',
        content: `DEPENDENT_UNEXPECTED:${text}`,
      };
    }

    return undefined;
  };
}

function decodeRun(serialized: string): RunSnapshot {
  return Schema.decodeUnknownSync(RunSnapshot)(JSON.parse(serialized));
}

async function invokeRun(
  host: Awaited<ReturnType<typeof launchPi>>,
  input: SubagentInput,
): Promise<RunSnapshot> {
  return decodeRun(await host.invoke('subagent', JSON.stringify(input)));
}

async function waitForRun(
  host: Awaited<ReturnType<typeof launchPi>>,
  runId: string,
  predicate: (run: RunSnapshot) => boolean,
  timeoutMs: number,
): Promise<RunSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let run = await invokeRun(host, {command: 'result', runId});
  while (!predicate(run) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
    run = await invokeRun(host, {command: 'result', runId});
  }
  return run;
}

function taskById(run: RunSnapshot, taskId: string) {
  const task = run.tasks.find(candidate => candidate.id === taskId);
  if (task === undefined)
    throw new Error(`Run ${run.id} did not include task ${taskId}.`);
  return task;
}

test('fails a child whose ask_parent call exceeds maxRuntimeMs', async () => {
  const asked: string[] = [];
  const childPrompts: string[] = [];
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    fixtureCallback(asked, childPrompts),
  );
  try {
    const run = await invokeRun(host, {
      command: 'dispatch',
      agent: 'timeout-child',
      task: TIMEOUT_MARKER,
      maxRuntimeMs: 1000,
      autoAwait: true,
      notifyPerTask: false,
    });
    expect(taskById(run, 'task_1').status).toBe('awaiting_parent');
    expect(asked).toContain(TIMEOUT_MARKER);

    const finished = await waitForRun(
      host,
      run.id,
      candidate => candidate.status === 'failed',
      5000,
    );
    const task = taskById(finished, 'task_1');
    expect(finished.status).toBe('failed');
    expect(task.status).toBe('failed');
    expect(task.error?.toLowerCase()).toMatch(/timed out|timeout/);
  } finally {
    await host.close();
  }
}, 60000);

test('cancels one blocked child while its sibling completes and its dependent is skipped', async () => {
  const asked: string[] = [];
  const childPrompts: string[] = [];
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    fixtureCallback(asked, childPrompts),
  );
  try {
    const dispatched = await invokeRun(host, {
      command: 'dispatch',
      tasks: [
        {
          id: 'blocked',
          agent: 'blocked-child',
          task: CANCELLED_MARKER,
        },
        {
          id: 'sibling',
          agent: 'sibling-child',
          task: SIBLING_MARKER,
        },
        {
          id: 'dependent',
          agent: 'dependent-child',
          task: DEPENDENT_MARKER,
          needs: ['blocked'],
        },
      ],
      concurrency: 2,
      autoAwait: false,
      notifyPerTask: false,
    });
    expect(dispatched.status).toBe('running');

    const awaiting = await waitForRun(
      host,
      dispatched.id,
      candidate => taskById(candidate, 'blocked').status === 'awaiting_parent',
      5000,
    );
    /*
     * Keep this assertion after the status wait. The model callback may be
     * invoked before the run snapshot is marked as awaiting_parent.
     */
    expect(taskById(awaiting, 'blocked').status).toBe('awaiting_parent');
    expect(asked).toContain(CANCELLED_MARKER);

    const cancelled = await invokeRun(host, {
      command: 'cancel',
      runId: dispatched.id,
      taskId: 'blocked',
    });
    expect(['stopping', 'stopped']).toContain(
      taskById(cancelled, 'blocked').status,
    );
    expect(['queued', 'starting', 'running', 'completed']).toContain(
      taskById(cancelled, 'sibling').status,
    );

    const completed = await waitForRun(
      host,
      dispatched.id,
      candidate => candidate.status === 'stopped',
      5000,
    );
    expect(completed.status).toBe('stopped');
    expect(taskById(completed, 'blocked').status).toBe('stopped');
    expect(taskById(completed, 'sibling').status).toBe('completed');
    expect(taskById(completed, 'sibling').finalText).toContain(
      'SIBLING_REPORT',
    );
    expect(taskById(completed, 'dependent').status).toBe('skipped');
    expect(taskById(completed, 'dependent').error).toMatch(/blocked/);
    expect(childPrompts.some(prompt => prompt.includes(SIBLING_MARKER))).toBe(
      true,
    );
    expect(childPrompts.some(prompt => prompt.includes(DEPENDENT_MARKER))).toBe(
      false,
    );
  } finally {
    await host.close();
  }
}, 60000);
