import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const questionText = 'Which file should I inspect?';
const Question = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  expiresAt: Schema.Number,
});
const TaskSnapshot = Schema.Struct({
  id: Schema.String,
  agent: Schema.String,
  task: Schema.String,
  cwd: Schema.String,
  needs: Schema.Array(Schema.String),
  status: Schema.String,
  finalText: Schema.String,
  question: Schema.optional(Question),
  pendingInstructions: Schema.Array(Schema.String),
});
const RunSnapshot = Schema.Struct({
  id: Schema.String,
  mode: Schema.String,
  status: Schema.String,
  tasks: Schema.Array(TaskSnapshot),
});

type RunSnapshot = Schema.Schema.Type<typeof RunSnapshot>;
type DispatchInput = Readonly<{
  command: 'dispatch';
  agent: string;
  task: string;
  autoAwait: boolean;
  notifyPerTask: boolean;
}>;
type QueryInput = Readonly<{
  command: 'status' | 'wait' | 'reply' | 'steer';
  runId: string;
  taskId?: string;
  questionId?: string;
  message?: string;
}>;
type CommunicationInput = DispatchInput | QueryInput;

function messageText(message: PiFixtureRequest['messages'][number]): string {
  const content = message.content;
  if (content === undefined || content === null) return '';
  if (Schema.is(Schema.String)(content)) return content;
  return content.map(block => block.text ?? '').join('');
}

function requestText(request: PiFixtureRequest): string {
  return request.messages.map(messageText).join('\n');
}

function fixtureCallback(
  childToolNames: string[],
  providerPrompts: string[] = [],
): PiFixtureResponseCallback {
  return request => {
    const names = request.tools?.map(tool => tool.function.name) ?? [];
    const text = requestText(request);
    const lastMessage = request.messages.at(-1);
    if (names.includes('subagent')) return undefined;
    childToolNames.push(...names);
    if (text.includes('STEER_INSTRUCTION')) {
      providerPrompts.push(text);
      return {
        type: 'content',
        content:
          lastMessage?.role === 'tool'
            ? `QUESTION_REPORT:${text}`
            : `STEER_ACK:${text}`,
      };
    }
    if (!text.includes('QUESTION_TASK_MARKER')) return undefined;
    if (lastMessage?.role === 'tool') {
      return {
        type: 'content',
        content: `QUESTION_REPORT:${text}`,
      };
    }
    return {
      type: 'tool_call',
      name: 'ask_parent',
      arguments: JSON.stringify({question: questionText}),
    };
  };
}

function decodeRun(serialized: string): RunSnapshot {
  return Schema.decodeUnknownSync(RunSnapshot)(JSON.parse(serialized));
}

async function invokeRaw(
  host: Awaited<ReturnType<typeof launchPi>>,
  input: CommunicationInput,
): Promise<string> {
  return host.invoke('subagent', JSON.stringify(input));
}

async function invokeRun(
  host: Awaited<ReturnType<typeof launchPi>>,
  input: CommunicationInput,
): Promise<RunSnapshot> {
  return decodeRun(await invokeRaw(host, input));
}

test('wakes for a child question, rejects stale reply, then resumes', async () => {
  const childToolNames: string[] = [];
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    fixtureCallback(childToolNames),
  );
  try {
    const awaiting = await invokeRun(host, {
      command: 'dispatch',
      agent: 'questioner',
      task: 'QUESTION_TASK_MARKER',
      autoAwait: true,
      notifyPerTask: false,
    });
    const task = awaiting.tasks[0];
    if (task === undefined)
      throw new Error('The dispatch result did not include a task.');
    expect(awaiting.status).toBe('running');
    expect(task.status).toBe('awaiting_parent');
    expect(task?.question?.text).toBe(questionText);
    const questionId = task?.question?.id;
    if (questionId === undefined)
      throw new Error('The awaiting task did not expose a question id.');

    const stale = await invokeRaw(host, {
      command: 'reply',
      runId: awaiting.id,
      taskId: task.id,
      questionId: 'stale-question-id',
      message: 'stale answer',
    });
    expect(stale.toLowerCase()).toMatch(/question|stale|expired/);

    const afterStale = await invokeRun(host, {
      command: 'status',
      runId: awaiting.id,
    });
    expect(afterStale.tasks[0]?.question?.id).toBe(questionId);
    expect(afterStale.tasks[0]?.question?.text).toBe(questionText);

    await invokeRaw(host, {
      command: 'reply',
      runId: awaiting.id,
      taskId: task.id,
      questionId,
      message: 'inspect CURRENT_CHECKOUT.md',
    });
    const completed = await invokeRun(host, {
      command: 'wait',
      runId: awaiting.id,
    });
    expect(completed.status).toBe('completed');
    expect(completed.tasks[0]?.status).toBe('completed');
    expect(completed.tasks[0]?.question).toBeUndefined();
    expect(completed.tasks[0]?.finalText).toContain('QUESTION_REPORT');
    expect(completed.tasks[0]?.finalText).toContain(
      'inspect CURRENT_CHECKOUT.md',
    );
    expect(childToolNames).toContain('ask_parent');
  } finally {
    await host.close();
  }
}, 60000);

test('steers a live questioner and rejects steering after completion', async () => {
  const childToolNames: string[] = [];
  const providerPrompts: string[] = [];
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    fixtureCallback(childToolNames, providerPrompts),
  );
  try {
    const awaiting = await invokeRun(host, {
      command: 'dispatch',
      agent: 'questioner',
      task: 'QUESTION_TASK_MARKER',
      autoAwait: true,
      notifyPerTask: false,
    });
    const task = awaiting.tasks[0];
    if (task === undefined)
      throw new Error('The dispatch result did not include a task.');
    const questionId = task.question?.id;
    if (questionId === undefined)
      throw new Error('The awaiting task did not expose a question id.');

    const instruction = 'STEER_INSTRUCTION: focus on the current checkout';
    const steered = await invokeRun(host, {
      command: 'steer',
      runId: awaiting.id,
      taskId: task.id,
      message: instruction,
    });
    expect(steered.tasks[0]?.pendingInstructions).toContain(instruction);

    const status = await invokeRun(host, {
      command: 'status',
      runId: awaiting.id,
    });
    expect(status.tasks[0]?.pendingInstructions).toContain(instruction);

    await invokeRaw(host, {
      command: 'reply',
      runId: awaiting.id,
      taskId: task.id,
      questionId,
      message: 'continue with the focused inspection',
    });
    const completed = await invokeRun(host, {
      command: 'wait',
      runId: awaiting.id,
    });
    expect(completed.status).toBe('completed');
    expect(completed.tasks[0]?.pendingInstructions).toEqual([]);
    expect(completed.tasks[0]?.finalText).toContain('STEER_INSTRUCTION');
    expect(
      providerPrompts.some(prompt => prompt.includes('STEER_INSTRUCTION')),
    ).toBe(true);

    const afterCompletion = await invokeRaw(host, {
      command: 'steer',
      runId: awaiting.id,
      taskId: task.id,
      message: 'late instruction',
    });
    expect(afterCompletion.toLowerCase()).toMatch(
      /live|executing|accept|stopping|error/,
    );
  } finally {
    await host.close();
  }
}, 60000);
