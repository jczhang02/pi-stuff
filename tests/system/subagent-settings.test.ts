import {expect, test} from 'bun:test';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const TaskSnapshot = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  finalText: Schema.String,
  maxRuntimeMs: Schema.Number,
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
  maxRuntimeMs?: number;
}>;
type DispatchInput = Readonly<{
  command: 'dispatch';
  agent?: string;
  task?: string;
  maxRuntimeMs?: number;
  tasks?: readonly TaskInput[];
  concurrency?: number;
  autoAwait: boolean;
  notifyPerTask: boolean;
}>;

function messageText(message: PiFixtureRequest['messages'][number]): string {
  const content = message.content;
  if (content === undefined || content === null) return '';
  if (Schema.is(Schema.String)(content)) return content;
  return content.map(block => block.text ?? '').join('');
}

function requestText(request: PiFixtureRequest): string {
  return request.messages.map(messageText).join('\n');
}

function settingsPath(host: Awaited<ReturnType<typeof launchPi>>): string {
  return join(host.agent, 'subagents-config.json');
}

function settingsCallback(): PiFixtureResponseCallback {
  return request => {
    const toolNames = request.tools?.map(tool => tool.function.name) ?? [];
    if (toolNames.includes('subagent')) return undefined;
    const text = requestText(request);
    const markers = [
      'AUTO_LIMIT_OFF',
      'AUTO_LIMIT_ON',
      'AUTO_LIMIT_GLOBAL',
      'AUTO_LIMIT_TASK',
    ];
    const marker = markers.find(candidate => text.includes(candidate));
    if (marker === undefined) return undefined;
    return {type: 'content', content: `CHILD_REPORT:${marker}`};
  };
}

function decodeRun(serialized: string): RunSnapshot {
  return Schema.decodeUnknownSync(RunSnapshot)(JSON.parse(serialized));
}

async function invokeRun(
  host: Awaited<ReturnType<typeof launchPi>>,
  input: DispatchInput,
): Promise<RunSnapshot> {
  return decodeRun(await host.invoke('subagent', JSON.stringify(input)));
}

function taskById(run: RunSnapshot, id: string) {
  const task = run.tasks.find(candidate => candidate.id === id);
  if (task === undefined)
    throw new Error(`Run ${run.id} did not include task ${id}.`);
  return task;
}

async function expectNotification(
  host: Awaited<ReturnType<typeof launchPi>>,
  command: string,
  notification: string,
) {
  await host.command(command);
  await host.terminal.screen.waitForText(notification, {timeoutMs: 15000});
}

test('native auto-limit settings control dispatch defaults and survive reload', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    settingsCallback(),
  );
  try {
    await expectNotification(
      host,
      '/subagents auto-limit',
      'Auto-limit off: default runtime 6 h.',
    );
    const defaultOff = await invokeRun(host, {
      command: 'dispatch',
      agent: 'off-child',
      task: 'AUTO_LIMIT_OFF',
      autoAwait: true,
      notifyPerTask: false,
    });
    expect(defaultOff.status).toBe('completed');
    expect(taskById(defaultOff, 'task_1').maxRuntimeMs).toBe(21_600_000);
    expect(taskById(defaultOff, 'task_1').finalText).toContain(
      'CHILD_REPORT:AUTO_LIMIT_OFF',
    );

    await expectNotification(
      host,
      '/subagents auto-limit on',
      'Auto-limit on: default runtime 1 h.',
    );
    expect(JSON.parse(await readFile(settingsPath(host), 'utf8'))).toEqual({
      autoLimit: true,
    });
    await expectNotification(
      host,
      '/subagents auto-limit',
      'Auto-limit on: default runtime 1 h.',
    );

    const defaultOn = await invokeRun(host, {
      command: 'dispatch',
      agent: 'on-child',
      task: 'AUTO_LIMIT_ON',
      autoAwait: true,
      notifyPerTask: false,
    });
    expect(defaultOn.status).toBe('completed');
    expect(taskById(defaultOn, 'task_1').maxRuntimeMs).toBe(3_600_000);
    expect(taskById(defaultOn, 'task_1').finalText).toContain(
      'CHILD_REPORT:AUTO_LIMIT_ON',
    );

    const explicitOverrides = await invokeRun(host, {
      command: 'dispatch',
      tasks: [
        {
          id: 'global-override',
          agent: 'global-override',
          task: 'AUTO_LIMIT_GLOBAL',
        },
        {
          id: 'task-override',
          agent: 'task-override',
          task: 'AUTO_LIMIT_TASK',
          maxRuntimeMs: 234500,
        },
      ],
      maxRuntimeMs: 456700,
      concurrency: 2,
      autoAwait: true,
      notifyPerTask: false,
    });
    expect(explicitOverrides.status).toBe('completed');
    expect(taskById(explicitOverrides, 'global-override').maxRuntimeMs).toBe(
      456700,
    );
    expect(taskById(explicitOverrides, 'task-override').maxRuntimeMs).toBe(
      234500,
    );
    expect(taskById(explicitOverrides, 'global-override').finalText).toContain(
      'CHILD_REPORT:AUTO_LIMIT_GLOBAL',
    );
    expect(taskById(explicitOverrides, 'task-override').finalText).toContain(
      'CHILD_REPORT:AUTO_LIMIT_TASK',
    );

    await host.reload();
    await expectNotification(
      host,
      '/subagents auto-limit',
      'Auto-limit on: default runtime 1 h.',
    );
    const afterReload = await invokeRun(host, {
      command: 'dispatch',
      agent: 'reloaded-child',
      task: 'AUTO_LIMIT_ON',
      autoAwait: true,
      notifyPerTask: false,
    });
    expect(taskById(afterReload, 'task_1').maxRuntimeMs).toBe(3_600_000);
    expect(taskById(afterReload, 'task_1').finalText).toContain(
      'CHILD_REPORT:AUTO_LIMIT_ON',
    );

    await expectNotification(
      host,
      '/subagents auto-limit off',
      'Auto-limit off: default runtime 6 h.',
    );
    expect(JSON.parse(await readFile(settingsPath(host), 'utf8'))).toEqual({
      autoLimit: false,
    });
    const defaultOffAgain = await invokeRun(host, {
      command: 'dispatch',
      agent: 'off-again-child',
      task: 'AUTO_LIMIT_OFF',
      autoAwait: true,
      notifyPerTask: false,
    });
    expect(taskById(defaultOffAgain, 'task_1').maxRuntimeMs).toBe(21_600_000);
    expect(taskById(defaultOffAgain, 'task_1').finalText).toContain(
      'CHILD_REPORT:AUTO_LIMIT_OFF',
    );
  } finally {
    await host.close();
  }
}, 60000);

test('native auto-limit command reports malformed settings without replacing them', async () => {
  const host = await launchPi('{}', undefined, 'subagent', 'fullscreen');
  const malformed = '{"autoLimit":';
  try {
    await writeFile(settingsPath(host), malformed);
    await host.command('/subagents auto-limit on');
    await host.terminal.screen.waitForText(
      'Could not parse subagent settings',
      {
        timeoutMs: 15000,
      },
    );
    expect(await readFile(settingsPath(host), 'utf8')).toBe(malformed);
  } finally {
    await host.close();
  }
}, 60000);
