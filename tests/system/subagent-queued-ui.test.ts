import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const TaskSnapshot = Schema.Struct({
  id: Schema.String,
  agent: Schema.String,
  status: Schema.String,
  finalText: Schema.String,
});
const RunSnapshot = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  tasks: Schema.Array(TaskSnapshot),
});

type RunSnapshot = Schema.Schema.Type<typeof RunSnapshot>;

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

function taskById(run: RunSnapshot, taskId: string) {
  const task = run.tasks.find(candidate => candidate.id === taskId);
  if (task === undefined)
    throw new Error(`Run ${run.id} did not include task ${taskId}.`);
  return task;
}

test('shows capacity, dependency, and wave queue reasons through child detail', async () => {
  const aGate = createGate();
  const bGate = createGate();
  let aObserved = false;
  let bObserved = false;
  let cObserved = false;
  const aStarted = createGate();
  const bStarted = createGate();
  const cStarted = createGate();
  const responseCallback: PiFixtureResponseCallback = async request => {
    if (toolNames(request).includes('subagent')) return undefined;
    const task = latestUserText(request);
    if (task.includes('QUEUE_A_TASK')) {
      aObserved = true;
      aStarted.release();
      await aGate.promise;
      return {type: 'content', content: 'A_REPORT'};
    }
    if (task.includes('QUEUE_B_TASK')) {
      bObserved = true;
      bStarted.release();
      await bGate.promise;
      return {type: 'content', content: 'B_REPORT'};
    }
    if (task.includes('QUEUE_C_TASK')) {
      cObserved = true;
      cStarted.release();
      return {type: 'content', content: 'C_REPORT'};
    }
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
    const dispatched = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {id: 'a', agent: 'A', task: 'QUEUE_A_TASK'},
            {id: 'b', agent: 'B', task: 'QUEUE_B_TASK'},
            {
              id: 'c',
              agent: 'C',
              task: 'QUEUE_C_TASK',
              needs: ['a'],
            },
          ],
          concurrency: 1,
          autoAwait: false,
          notifyPerTask: false,
        }),
      ),
    );
    expect(dispatched.status).toBe('running');
    await waitForSignal(aStarted.promise, 'A to start');
    expect(aObserved).toBe(true);
    expect(bObserved).toBe(false);
    expect(cObserved).toBe(false);

    await host.terminal.screen.waitForText('○ main', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● main', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● A', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● B', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText(
      'Waiting for available concurrency in the current wave.',
      {timeoutMs: 5000},
    );

    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('● B', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● C', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Waiting for A (running)', {
      timeoutMs: 5000,
    });

    aGate.release();
    await waitForSignal(bStarted.promise, 'B to start');
    expect(bObserved).toBe(true);
    expect(cObserved).toBe(false);
    await host.terminal.screen.waitForText(
      'Waiting for the current wave to finish.',
      {timeoutMs: 5000},
    );

    bGate.release();
    await waitForSignal(cStarted.promise, 'C to start');
    await host.terminal.screen.waitForText('C_REPORT', {timeoutMs: 10000});

    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('● C', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      snapshot => !snapshot.text.includes('esc back'),
      {timeoutMs: 5000},
    );
    const completed = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({command: 'result', runId: dispatched.id}),
      ),
    );
    expect(completed.status).toBe('completed');
    expect(taskById(completed, 'a').status).toBe('completed');
    expect(taskById(completed, 'b').status).toBe('completed');
    expect(taskById(completed, 'c').status).toBe('completed');
    expect(taskById(completed, 'c').finalText).toContain('C_REPORT');
  } finally {
    aGate.release();
    bGate.release();
    await host.close();
  }
}, 60000);
