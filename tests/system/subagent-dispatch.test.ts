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
  task: Schema.String,
  cwd: Schema.String,
  needs: Schema.Array(Schema.String),
  status: Schema.String,
  finalText: Schema.String,
});
const RunSnapshot = Schema.Struct({
  id: Schema.String,
  mode: Schema.String,
  status: Schema.String,
  tasks: Schema.Array(TaskSnapshot),
});

type RunSnapshot = Schema.Schema.Type<typeof RunSnapshot>;

type TaskInput = Readonly<{
  id: string;
  agent: string;
  task: string;
}>;
type DispatchInput = Readonly<{
  command: 'dispatch';
  tasks?: readonly TaskInput[];
  chain?: readonly TaskInput[];
  concurrency?: number;
  autoAwait?: boolean;
  notifyPerTask?: boolean;
}>;
type QueryInput = Readonly<{
  command: 'status' | 'result' | 'wait';
  runId: string;
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

function fixtureCallback(
  prompts: string[],
  childGate?: Promise<void>,
): PiFixtureResponseCallback {
  const markers = [
    'MARK_CHAIN_SECOND',
    'MARK_CHAIN_FIRST',
    'MARK_ALPHA',
    'MARK_BETA',
  ];
  return async request => {
    const names = request.tools?.map(tool => tool.function.name) ?? [];
    const text = requestText(request);
    const marker = markers.find(candidate => text.includes(candidate));
    if (names.includes('subagent') || marker === undefined) return undefined;
    if (childGate !== undefined) await childGate;
    prompts.push(text);
    return {
      type: 'content',
      content: `CHILD_REPORT:${marker}:${text}`,
    };
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

test('dispatches in the background and exposes status, wait, and result', async () => {
  const childPrompts: string[] = [];
  let releaseChildren: () => void = () => {};
  const childGate = new Promise<void>(resolve => {
    releaseChildren = resolve;
  });
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    fixtureCallback(childPrompts, childGate),
  );
  try {
    const dispatched = await invokeRun(host, {
      command: 'dispatch',
      tasks: [
        {id: 'alpha', agent: 'alpha', task: 'MARK_ALPHA'},
        {id: 'beta', agent: 'beta', task: 'MARK_BETA'},
      ],
      concurrency: 2,
      autoAwait: false,
      notifyPerTask: false,
    });
    expect(childPrompts).toHaveLength(0);
    releaseChildren();
    expect(dispatched.tasks.map(task => task.id)).toEqual(['alpha', 'beta']);
    expect(['running', 'completed']).toContain(dispatched.status);

    const status = await invokeRun(host, {
      command: 'status',
      runId: dispatched.id,
    });
    expect(status.id).toBe(dispatched.id);
    expect(status.tasks).toHaveLength(2);

    const waited = await invokeRun(host, {
      command: 'wait',
      runId: dispatched.id,
    });
    expect(waited.status).toBe('completed');
    expect(waited.tasks.every(task => task.status === 'completed')).toBe(true);
    expect(waited.tasks[0]?.finalText).toContain('CHILD_REPORT:MARK_ALPHA');
    expect(waited.tasks[1]?.finalText).toContain('CHILD_REPORT:MARK_BETA');

    const result = await invokeRun(host, {
      command: 'result',
      runId: dispatched.id,
    });
    expect(result).toEqual(waited);
    expect(childPrompts.some(prompt => prompt.includes('MARK_ALPHA'))).toBe(
      true,
    );
    expect(childPrompts.some(prompt => prompt.includes('MARK_BETA'))).toBe(
      true,
    );
  } finally {
    releaseChildren();
    await host.close();
  }
}, 60000);

test('runs parallel tasks and passes named predecessor output through a chain', async () => {
  const childPrompts: string[] = [];
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    fixtureCallback(childPrompts),
  );
  try {
    const parallel = await invokeRun(host, {
      command: 'dispatch',
      tasks: [
        {id: 'alpha', agent: 'alpha', task: 'MARK_ALPHA'},
        {id: 'beta', agent: 'beta', task: 'MARK_BETA'},
      ],
      concurrency: 2,
      autoAwait: true,
      notifyPerTask: false,
    });
    expect(parallel.mode).toBe('parallel');
    expect(parallel.status).toBe('completed');
    expect(parallel.tasks.every(task => task.status === 'completed')).toBe(
      true,
    );

    const chain = await invokeRun(host, {
      command: 'dispatch',
      chain: [
        {
          id: 'first',
          agent: 'chain-first',
          task: 'MARK_CHAIN_FIRST',
        },
        {
          id: 'second',
          agent: 'chain-second',
          task: 'MARK_CHAIN_SECOND {previous}',
        },
      ],
      autoAwait: true,
      notifyPerTask: false,
    });
    expect(chain.mode).toBe('chain');
    expect(chain.status).toBe('completed');
    expect(chain.tasks[0]?.finalText).toContain(
      'CHILD_REPORT:MARK_CHAIN_FIRST',
    );
    expect(chain.tasks[1]?.finalText).toContain(
      'CHILD_REPORT:MARK_CHAIN_SECOND',
    );
    expect(chain.tasks[1]?.finalText).toContain(
      'CHILD_REPORT:MARK_CHAIN_FIRST',
    );
    expect(
      childPrompts.some(
        prompt =>
          prompt.includes('Output of first') &&
          prompt.includes('CHILD_REPORT:MARK_CHAIN_FIRST'),
      ),
    ).toBe(true);
  } finally {
    await host.close();
  }
}, 60000);
