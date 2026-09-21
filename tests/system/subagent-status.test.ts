import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {
  RunSnapshot as FullRunSnapshot,
  TaskSnapshot as FullTaskSnapshot,
} from '../../src/subagent/records';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const INITIAL_MARKER = 'STATUS_INITIAL_REPORT_MARKER';
const FOLLOWUP_MARKER = 'STATUS_FOLLOWUP_REPORT_MARKER';
const INITIAL_TASK = 'STATUS_INITIAL_TASK_MARKER';
const FOLLOWUP_TASK = 'STATUS_FOLLOWUP_TASK_MARKER';

const Usage = Schema.Struct({
  input: Schema.optional(Schema.Number),
  output: Schema.optional(Schema.Number),
  cacheRead: Schema.optional(Schema.Number),
  cacheWrite: Schema.optional(Schema.Number),
  cost: Schema.optional(Schema.Number),
  turns: Schema.Number,
});
const QuestionStatus = Schema.Struct({
  id: Schema.String,
  expiresAt: Schema.Number,
  excerpt: Schema.String,
});
const TaskStatus = Schema.Struct({
  id: Schema.String,
  agent: Schema.String,
  status: Schema.String,
  pendingInstructionCount: Schema.Number,
  historyCount: Schema.Number,
  extensionErrorCount: Schema.Number,
  startedAt: Schema.optional(Schema.Number),
  endedAt: Schema.optional(Schema.Number),
  usage: Schema.optional(Usage),
  cumulativeUsage: Schema.optional(Usage),
  question: Schema.optional(QuestionStatus),
  error: Schema.optional(Schema.String),
  preservationError: Schema.optional(Schema.String),
  cleanupError: Schema.optional(Schema.String),
  notificationError: Schema.optional(Schema.String),
  finalizing: Schema.optional(Schema.Boolean),
});
const RunStatus = Schema.Struct({
  id: Schema.String,
  mode: Schema.String,
  status: Schema.String,
  tasks: Schema.Array(TaskStatus),
  persistenceError: Schema.optional(Schema.String),
});

type RunStatus = Schema.Schema.Type<typeof RunStatus>;
type FullRun = Schema.Schema.Type<typeof FullRunSnapshot>;
type FullTask = Schema.Schema.Type<typeof FullTaskSnapshot>;

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

function decodeStatus(serialized: string): RunStatus {
  return Schema.decodeUnknownSync(RunStatus)(JSON.parse(serialized));
}

function decodeFullRun(serialized: string): FullRun {
  return Schema.decodeUnknownSync(FullRunSnapshot)(JSON.parse(serialized));
}

function decodeFullTask(serialized: string): FullTask {
  return Schema.decodeUnknownSync(FullTaskSnapshot)(JSON.parse(serialized));
}

function responseCallback(): PiFixtureResponseCallback {
  const initialReport = `${INITIAL_MARKER}:${'initial report '.repeat(40)}`;
  const followupReport = `${FOLLOWUP_MARKER}:${'follow-up report '.repeat(40)}`;
  return request => {
    const tools = request.tools?.map(tool => tool.function.name) ?? [];
    if (tools.includes('subagent')) return undefined;
    const task = latestUserText(request);
    if (task.includes(FOLLOWUP_TASK))
      return {
        type: 'content',
        content: followupReport,
        usage: {input: 13, output: 5},
      };
    if (task.includes(INITIAL_TASK))
      return {
        type: 'content',
        content: initialReport,
        usage: {input: 11, output: 7},
      };
    return undefined;
  };
}

test('keeps status compact while result retains the complete task history', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    responseCallback(),
  );
  try {
    const initial = decodeFullRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          agent: 'status-reviewer',
          task: INITIAL_TASK,
          autoAwait: true,
          notifyPerTask: false,
        }),
      ),
    );
    const initialTask = initial.tasks[0];
    if (initialTask === undefined) throw new Error('Missing initial task.');

    const continued = decodeFullRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'follow-up',
          runId: initial.id,
          taskId: initialTask.id,
          message: FOLLOWUP_TASK,
          autoAwait: true,
        }),
      ),
    );
    expect(continued.status).toBe('completed');

    const statusText = await host.invoke(
      'subagent',
      JSON.stringify({command: 'status', runId: initial.id}),
    );
    const status = decodeStatus(statusText);
    const statusTask = status.tasks[0];
    if (statusTask === undefined) throw new Error('Missing status task.');
    expect(status.id).toBe(initial.id);
    expect(statusTask.id).toBe(initialTask.id);
    expect(statusTask.agent).toBe('status-reviewer');
    expect(statusTask.status).toBe('completed');
    expect(statusTask.historyCount).toBe(1);
    expect(statusTask.extensionErrorCount).toBe(0);
    expect(statusTask.pendingInstructionCount).toBe(0);
    expect(statusTask.usage?.input).toBe(13);
    expect(statusTask.cumulativeUsage?.input).toBe(24);
    expect(statusText).not.toContain(INITIAL_MARKER);
    expect(statusText).not.toContain(FOLLOWUP_MARKER);
    expect(statusText).not.toContain('"finalText"');
    expect(statusText).not.toContain('"prompt"');
    expect(statusText).not.toContain('"history":');

    const resultText = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'result',
        runId: initial.id,
        taskId: initialTask.id,
      }),
    );
    const result = decodeFullTask(resultText);
    expect(result.finalText).toContain(FOLLOWUP_MARKER);
    expect(result.history).toHaveLength(1);
    expect(result.history[0]?.finalText).toContain(INITIAL_MARKER);

    const taskStatusText = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'status',
        runId: initial.id,
        taskId: initialTask.id,
      }),
    );
    const taskStatus = Schema.decodeUnknownSync(TaskStatus)(
      JSON.parse(taskStatusText),
    );
    expect(taskStatus.id).toBe(initialTask.id);
    expect(taskStatus.historyCount).toBe(1);
    expect(taskStatusText).not.toContain('"finalText"');

    const unknownStatus = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'status',
        runId: initial.id,
        taskId: 'missing-task',
      }),
    );
    expect(unknownStatus).toMatch(/Unknown task: missing-task/i);
    const unknownResult = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'result',
        runId: initial.id,
        taskId: 'missing-task',
      }),
    );
    expect(unknownResult).toMatch(/Unknown task: missing-task/i);
  } finally {
    await host.close();
  }
}, 60000);
