import {expect, test} from 'bun:test';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const roleTask = 'review cancellation behavior';
const rolePrompt = 'ROLE_PROMPT';
const inlinePrompt = 'INLINE_IGNORE';

const TaskSnapshot = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  finalText: Schema.String,
  error: Schema.optional(Schema.String),
  roleSource: Schema.optional(Schema.String),
  configurationNotes: Schema.Array(Schema.String),
  model: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.String),
  tools: Schema.optional(Schema.Array(Schema.String)),
});
const RunSnapshot = Schema.Struct({
  id: Schema.String,
  mode: Schema.String,
  status: Schema.String,
  tasks: Schema.Array(TaskSnapshot),
});

type RunSnapshot = Schema.Schema.Type<typeof RunSnapshot>;
type TaskInput = Readonly<{
  id?: string;
  agent: string;
  task: string;
  cwd?: string;
  prompt?: string;
  tools?: readonly string[];
  model?: string;
  thinking?: string;
}>;
type DispatchInput = Readonly<{
  command: 'dispatch';
  agent?: string;
  task?: string;
  cwd?: string;
  prompt?: string;
  tools?: readonly string[];
  model?: string;
  thinking?: string;
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

type ChildRequest = Readonly<{
  task: string;
  text: string;
  tools: string[];
}>;

function configurationCallback(
  childRequests: ChildRequest[],
): PiFixtureResponseCallback {
  return request => {
    const names = toolNames(request);
    if (names.includes('subagent')) return undefined;

    const task = latestUserText(request);
    childRequests.push({task, text: requestText(request), tools: names});
    if (task !== roleTask) return undefined;
    return {
      type: 'content',
      content: `CONFIGURATION_REPORT:${task}`,
    };
  };
}

async function writeReviewerRole(directory: string): Promise<string> {
  const rolesDirectory = join(directory, '.agents', 'agents');
  await mkdir(rolesDirectory, {recursive: true});
  const rolePath = join(rolesDirectory, 'reviewer.md');
  await writeFile(
    rolePath,
    [
      '---',
      'name: reviewer',
      `description: ${roleTask}`,
      'model: fixture/fixture',
      'tools: read',
      '---',
      rolePrompt,
      '',
    ].join('\n'),
  );
  return rolePath;
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

async function invokeRaw(
  host: Awaited<ReturnType<typeof launchPi>>,
  input: DispatchInput,
): Promise<string> {
  return host.invoke('subagent', JSON.stringify(input));
}

function taskById(run: RunSnapshot, taskId = 'task_1') {
  const task = run.tasks.find(candidate => candidate.id === taskId);
  if (task === undefined)
    throw new Error(`Run ${run.id} did not include task ${taskId}.`);
  return task;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined)
    throw new Error(`Missing ${label} in task snapshot.`);
  return value;
}

function communicationTools(): string[] {
  return [
    'ask_parent',
    'notify_parent',
    'send_agent_message',
    'poll_agent_messages',
  ];
}

test('loads a project role, replaces inline prompt, and reports effective configuration', async () => {
  const childRequests: ChildRequest[] = [];
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    configurationCallback(childRequests),
  );
  try {
    const rolePath = await writeReviewerRole(host.directory);
    const run = await invokeRun(host, {
      command: 'dispatch',
      agent: 'reviewer',
      task: roleTask,
      cwd: host.directory,
      prompt: inlinePrompt,
      autoAwait: true,
      notifyPerTask: false,
    });
    const task = taskById(run);
    const child = childRequests.find(candidate => candidate.task === roleTask);

    expect(run.status).toBe('completed');
    expect(task.status).toBe('completed');
    expect(task.finalText).toContain('CONFIGURATION_REPORT');
    expect(task.roleSource).toBe(rolePath);
    expect(required(task.model, 'model')).toBe('fixture');
    expect(required(task.provider, 'provider')).toBe('fixture');
    expect(required(task.thinking, 'thinking')).toBe('off');
    expect(required(task.configurationNotes, 'configuration notes')).toEqual(
      expect.arrayContaining([expect.stringMatching(/inline prompt/i)]),
    );
    const tools = required(task.tools, 'tools');
    expect(tools).toContain('read');
    expect(tools).not.toContain('grep');
    expect(tools).not.toContain('bash');
    for (const name of communicationTools()) expect(tools).toContain(name);

    if (child === undefined)
      throw new Error('The role task did not reach the child provider.');
    expect(child.text).toContain(rolePrompt);
    expect(child.text).not.toContain(inlinePrompt);
    expect(child.tools).toContain('read');
    expect(child.tools).not.toContain('grep');
    expect(child.tools).not.toContain('bash');
    for (const name of communicationTools())
      expect(child.tools).toContain(name);
  } finally {
    await host.close();
  }
}, 60000);

test('lets explicit tools override role tools and records the override note', async () => {
  const childRequests: ChildRequest[] = [];
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    configurationCallback(childRequests),
  );
  try {
    await writeReviewerRole(host.directory);
    const run = await invokeRun(host, {
      command: 'dispatch',
      agent: 'reviewer',
      task: roleTask,
      cwd: host.directory,
      tools: ['read', 'grep'],
      autoAwait: true,
      notifyPerTask: false,
    });
    const task = taskById(run);
    const child = childRequests.find(candidate => candidate.task === roleTask);

    expect(run.status).toBe('completed');
    expect(task.status).toBe('completed');
    expect(required(task.tools, 'tools')).toContain('read');
    expect(required(task.tools, 'tools')).toContain('grep');
    expect(required(task.tools, 'tools')).not.toContain('bash');
    expect(
      required(task.configurationNotes, 'configuration notes').join(' '),
    ).toMatch(/explicit tools|overrode|agent-file/i);
    if (child === undefined)
      throw new Error(
        'The explicit-tools task did not reach the child provider.',
      );
    expect(child.tools).toContain('read');
    expect(child.tools).toContain('grep');
    expect(child.tools).not.toContain('bash');
    for (const name of communicationTools())
      expect(child.tools).toContain(name);
  } finally {
    await host.close();
  }
}, 60000);

test('rejects invalid configuration before creating a run or starting a child', async () => {
  const childRequests: ChildRequest[] = [];
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    configurationCallback(childRequests),
  );
  try {
    const invalidModel = await invokeRaw(host, {
      command: 'dispatch',
      agent: 'unconfigured-model',
      task: 'invalid model task',
      model: 'fixture/missing',
      autoAwait: true,
      notifyPerTask: false,
    });
    expect(invalidModel.toLowerCase()).toMatch(
      /error|model|provider|not found|invalid/,
    );
    expect(invalidModel).not.toContain('"tasks"');
    expect(childRequests).toHaveLength(0);

    const invalidThinking = await invokeRaw(host, {
      command: 'dispatch',
      agent: 'unsupported-thinking',
      task: 'unsupported thinking task',
      thinking: 'high',
      autoAwait: true,
      notifyPerTask: false,
    });
    expect(invalidThinking.toLowerCase()).toMatch(
      /thinking|reasoning|supported/,
    );
    expect(invalidThinking).not.toContain('"tasks"');
    expect(childRequests).toHaveLength(0);

    const atomicBatch = await invokeRaw(host, {
      command: 'dispatch',
      tasks: [
        {
          id: 'valid',
          agent: 'valid-child',
          task: 'valid batch task',
        },
        {
          id: 'invalid',
          agent: 'invalid-child',
          task: 'invalid batch task',
          model: 'fixture/missing',
        },
      ],
      concurrency: 2,
      autoAwait: true,
      notifyPerTask: false,
    });
    expect(atomicBatch.toLowerCase()).toMatch(
      /error|model|provider|not found|invalid/,
    );
    expect(atomicBatch).not.toContain('"tasks"');
    expect(childRequests).toHaveLength(0);
  } finally {
    await host.close();
  }
}, 60000);
