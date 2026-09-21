import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const ORIGINAL_QUESTION =
  'RACE_ORIGINAL_QUESTION: which file should I inspect?';
const NEXT_QUESTION = 'RACE_NEXT_QUESTION: which test should I run?';
const TASK_MARKER = 'RACE_QUESTION_TASK';
const PARENT_REPLY = 'RACE_PARENT_REPLY';
const DRAFT = 'RACE_DRAFT_MUST_STAY';

const Question = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  expiresAt: Schema.Number,
});
const TaskSnapshot = Schema.Struct({
  id: Schema.String,
  agent: Schema.String,
  status: Schema.String,
  finalText: Schema.String,
  question: Schema.optional(Question),
});
const RunSnapshot = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  tasks: Schema.Array(TaskSnapshot),
});

type RunSnapshot = Schema.Schema.Type<typeof RunSnapshot>;
type SubagentInput = Readonly<{
  command: 'dispatch' | 'result' | 'reply' | 'wait';
  agent?: string;
  task?: string;
  runId?: string;
  taskId?: string;
  questionId?: string;
  message?: string;
  autoAwait?: boolean;
  notifyPerTask?: boolean;
}>;

interface Gate {
  readonly promise: Promise<void>;
  readonly release: () => void;
}

function createGate(): Gate {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>(resolve => {
    resolvePromise = resolve;
  });
  return {
    promise,
    release: () => {
      const resolve = resolvePromise;
      resolvePromise = undefined;
      resolve?.();
    },
  };
}

async function waitForSignal(
  signal: Promise<void>,
  description: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      signal,
      new Promise<void>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${description}.`)),
          5000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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

function toolNames(request: PiFixtureRequest): string[] {
  return request.tools?.map(tool => tool.function.name) ?? [];
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

function taskById(run: RunSnapshot, taskId: string) {
  const task = run.tasks.find(candidate => candidate.id === taskId);
  if (task === undefined) throw new Error(`Run ${run.id} omitted ${taskId}.`);
  return task;
}

async function waitForReplyComposerClosed(
  host: Awaited<ReturnType<typeof launchPi>>,
): Promise<void> {
  await host.terminal.screen.waitUntil(
    snapshot => !snapshot.text.includes('Reply questioner'),
    {timeoutMs: 5000},
  );
}

async function waitForFleetClosed(
  host: Awaited<ReturnType<typeof launchPi>>,
): Promise<void> {
  await host.terminal.screen.waitUntil(
    snapshot => !snapshot.text.includes('esc back'),
    {timeoutMs: 5000},
  );
}

async function openReplyComposer(
  host: Awaited<ReturnType<typeof launchPi>>,
  question: string,
  fromMainSelection: boolean,
): Promise<void> {
  await host.terminal.screen.waitForText('○ main', {timeoutMs: 5000});
  await host.terminal.keyboard.press('ArrowDown');
  if (fromMainSelection) {
    await host.terminal.screen.waitForText('● main', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
  }
  await host.terminal.screen.waitForText('● questioner', {timeoutMs: 5000});
  await host.terminal.keyboard.press('Enter');
  await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
  await host.terminal.screen.waitForText(question, {timeoutMs: 5000});
  await host.terminal.keyboard.press('Enter');
  await host.terminal.screen.waitForText('Reply questioner', {
    timeoutMs: 5000,
  });
}

test('reply race rejects an old composer draft after the child asks a new question', async () => {
  const childRequests: PiFixtureRequest[] = [];
  const parentRequestEntered = createGate();
  const releaseParentReply = createGate();
  const nextQuestionRequested = createGate();
  let gateNextParentRequest = false;
  const responseCallback: PiFixtureResponseCallback = async request => {
    const names = toolNames(request);
    if (names.includes('subagent')) {
      if (gateNextParentRequest) {
        gateNextParentRequest = false;
        parentRequestEntered.release();
        await releaseParentReply.promise;
      }
      return undefined;
    }

    childRequests.push(request);
    const text = requestText(request);
    const latest = latestUserText(request);
    if (!text.includes(TASK_MARKER)) return undefined;
    const lastMessage = request.messages.at(-1);
    if (lastMessage?.role === 'tool') {
      const lastToolText = messageText(lastMessage);
      if (lastToolText.includes('RACE_CLEANUP'))
        return {type: 'content', content: 'RACE_DONE'};
      if (lastToolText.includes(PARENT_REPLY)) {
        nextQuestionRequested.release();
        return {
          type: 'tool_call',
          name: 'ask_parent',
          arguments: JSON.stringify({question: NEXT_QUESTION}),
        };
      }
      return undefined;
    }
    if (latest.includes(TASK_MARKER))
      return {
        type: 'tool_call',
        name: 'ask_parent',
        arguments: JSON.stringify({question: ORIGINAL_QUESTION}),
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
    const awaiting = await invokeRun(host, {
      command: 'dispatch',
      agent: 'questioner',
      task: TASK_MARKER,
      autoAwait: true,
      notifyPerTask: false,
    });
    const task = taskById(awaiting, 'task_1');
    expect(task.status).toBe('awaiting_parent');
    expect(task.question?.text).toBe(ORIGINAL_QUESTION);
    const questionId = task.question?.id;
    if (questionId === undefined)
      throw new Error('Missing original question id.');

    await openReplyComposer(host, ORIGINAL_QUESTION, true);
    await host.terminal.keyboard.type(DRAFT);
    await host.terminal.screen.waitForText(DRAFT, {timeoutMs: 5000});

    // Preserve the old keyed draft while arranging a parent model turn. The
    // parent request is gated before its real reply tool call is emitted.
    await host.terminal.keyboard.press('Escape');
    await waitForReplyComposerClosed(host);
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('● questioner', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await waitForFleetClosed(host);

    gateNextParentRequest = true;
    await host.start(
      'subagent',
      JSON.stringify({
        command: 'reply',
        runId: awaiting.id,
        taskId: task.id,
        questionId,
        message: PARENT_REPLY,
      }),
    );
    await waitForSignal(parentRequestEntered.promise, 'parent reply request');

    await openReplyComposer(host, ORIGINAL_QUESTION, false);
    await host.terminal.screen.waitForText(DRAFT, {timeoutMs: 5000});
    releaseParentReply.release();
    await waitForSignal(
      nextQuestionRequested.promise,
      'the child to request its next question',
    );
    await host.terminal.screen.waitForText(NEXT_QUESTION, {
      timeoutMs: 5000,
    });

    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText(
      'This question is no longer awaiting a reply.',
      {timeoutMs: 5000},
    );
    expect(await host.terminal.screen.text()).toContain(DRAFT);
    expect(
      childRequests.some(request => requestText(request).includes(DRAFT)),
    ).toBe(false);
    expect(
      childRequests.some(request =>
        requestText(request).includes(PARENT_REPLY),
      ),
    ).toBe(true);

    // Close the stale composer before using the public query/reply seam for
    // cleanup. The draft must remain while the new question is unanswered.
    await host.terminal.keyboard.press('Escape');
    await waitForReplyComposerClosed(host);
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('● questioner', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await waitForFleetClosed(host);
    const current = await invokeRun(host, {
      command: 'result',
      runId: awaiting.id,
    });
    const nextTask = taskById(current, task.id);
    const nextQuestionId = nextTask.question?.id;
    if (nextQuestionId === undefined)
      throw new Error('The child did not retain its new question.');
    await invokeRun(host, {
      command: 'reply',
      runId: awaiting.id,
      taskId: task.id,
      questionId: nextQuestionId,
      message: 'RACE_CLEANUP',
    });
    const completed = await invokeRun(host, {
      command: 'wait',
      runId: awaiting.id,
    });
    expect(completed.status).toBe('completed');
    expect(taskById(completed, task.id).finalText).toBe('RACE_DONE');
  } finally {
    releaseParentReply.release();
    await host.close();
  }
}, 60000);
