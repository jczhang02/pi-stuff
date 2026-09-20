import {expect, test} from 'bun:test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import {
  launchPi,
  type FixtureReply,
  type ModelRequest,
} from './fixtures/pi-terminal';

const SnapshotJson = Schema.fromJsonString(
  Schema.Struct({
    tasks: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        phase: Schema.String,
        outcome: Schema.NullOr(Schema.String),
        sessionFile: Schema.NullOr(Schema.String),
        configuration: Schema.Struct({
          model: Schema.String,
          thinking: Schema.String,
        }),
      }),
    ),
  }),
);
const ModelsJson = Schema.fromJsonString(
  Schema.Struct({
    providers: Schema.Record(
      Schema.String,
      Schema.Struct({
        baseUrl: Schema.String,
        api: Schema.String,
        apiKey: Schema.String,
        models: Schema.Array(Schema.Struct({id: Schema.String})),
      }),
    ),
  }),
);
const SessionAssistantJson = Schema.Struct({
  type: Schema.Literal('message'),
  message: Schema.Struct({
    role: Schema.Literal('assistant'),
    provider: Schema.String,
    model: Schema.String,
  }),
});
const AdmissionJson = Schema.fromJsonString(
  Schema.Struct({
    status: Schema.Literal('accepted'),
    dispatchId: Schema.String,
    tasks: Schema.Array(
      Schema.Struct({taskId: Schema.String, agentId: Schema.String}),
    ),
  }),
);
const WaitJson = Schema.fromJsonString(
  Schema.Struct({waitStatus: Schema.String}),
);

type ConfigurationHost = Awaited<ReturnType<typeof launchPi>>;
type Fleet = typeof SnapshotJson.Type;
type Task = Fleet['tasks'][number];
type DispatchAssignment = {
  name: string;
  prompt: string;
  role?: string;
  model?: string;
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  workspace?: 'snapshot' | 'write' | 'live' | 'direct';
  tools?: readonly string[];
};

function finishModel(request: ModelRequest): FixtureReply | undefined {
  const history = JSON.stringify(request.messages);
  if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
  if (request.messages.at(-1)?.role === 'tool') return {text: 'Delivered.'};
  return {
    tool: 'subagent',
    arguments: JSON.stringify({
      command: 'finish',
      outcome: 'fulfilled',
      text: 'Configuration checked.',
    }),
  };
}

function decodeFleet(text: string): Fleet {
  return Schema.decodeUnknownSync(SnapshotJson)(text);
}

async function inspect(host: ConfigurationHost): Promise<Fleet> {
  return decodeFleet(await host.invoke('subagent', '{"command":"inspect"}'));
}

async function waitForFleet(host: ConfigurationHost): Promise<void> {
  for (let attempt = 0; attempt < 16; attempt++) {
    const result = Schema.decodeUnknownSync(WaitJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({command: 'wait', timeoutMs: 5000}),
      ),
    );
    if (result.waitStatus === 'settled') return;
    if (
      result.waitStatus !== 'changed' &&
      result.waitStatus !== 'message' &&
      result.waitStatus !== 'expired'
    )
      throw new Error(`Fleet wait ended with ${result.waitStatus}.`);
  }
  throw new Error('Fleet did not settle after 16 event-driven waits.');
}

async function installFixtureModelAliases(
  host: ConfigurationHost,
  modelIds: readonly string[],
): Promise<void> {
  const models = Schema.decodeUnknownSync(ModelsJson)(
    await readFile(join(host.agent, 'models.json'), 'utf8'),
  );
  const fixture = models.providers.fixture;
  if (fixture === undefined)
    throw new Error('Fixture provider was not present in models.json.');
  const known = new Set(fixture.models.map(model => model.id));
  const aliases = modelIds
    .filter(modelId => !known.has(modelId))
    .map(id => ({id}));
  await writeFile(
    join(host.agent, 'models.json'),
    JSON.stringify({
      ...models,
      providers: {
        ...models.providers,
        fixture: {...fixture, models: [...fixture.models, ...aliases]},
      },
    }),
  );
  await host.reload();
}

async function expectSessionModel(task: Task): Promise<void> {
  if (task.sessionFile === null)
    throw new Error(`Task ${task.id} has no persisted child session.`);
  const expected = task.configuration.model.split('/');
  const provider = expected[0];
  const model = expected[1];
  if (provider === undefined || model === undefined)
    throw new Error(`Task ${task.id} has an invalid model reference.`);
  const lines = (await readFile(task.sessionFile, 'utf8'))
    .split(/\r?\n/)
    .filter(line => line.length > 0);
  const evidence = lines.some(line => {
    try {
      const entry = Schema.decodeUnknownSync(SessionAssistantJson)(
        JSON.parse(line),
      );
      return (
        entry.message.provider === provider && entry.message.model === model
      );
    } catch {
      return false;
    }
  });
  expect(evidence).toBe(true);
}

function taskById(snapshot: Fleet, taskId: string): Task {
  const task = snapshot.tasks.find(candidate => candidate.id === taskId);
  if (task === undefined) throw new Error(`Task ${taskId} was not persisted.`);
  return task;
}

async function dispatch(
  host: ConfigurationHost,
  assignment: DispatchAssignment,
): Promise<{taskId: string; agentId: string}> {
  const admission = Schema.decodeUnknownSync(AdmissionJson)(
    await host.invoke(
      'subagent',
      JSON.stringify({command: 'dispatch', tasks: [assignment]}),
    ),
  );
  const task = admission.tasks[0];
  if (task === undefined) throw new Error('Dispatch admitted no task.');
  return task;
}

async function writeProjectDefaults(
  host: ConfigurationHost,
  defaults: {model: string; thinking: string},
): Promise<void> {
  await mkdir(join(host.directory, '.pi'), {recursive: true});
  await writeFile(
    join(host.directory, '.pi', 'pi-stuff.json'),
    JSON.stringify({subagent: {defaults}}),
  );
}

async function writeRole(
  host: ConfigurationHost,
  values: {model: string; thinking: string; instructions: string},
): Promise<string> {
  const roles = join(host.directory, '.pi', 'agents');
  await mkdir(roles, {recursive: true});
  const path = join(roles, 'precedence.md');
  await writeFile(
    path,
    `---
name: precedence
description: Configuration precedence fixture
model: ${values.model}
thinking: ${values.thinking}
tools: subagent
workspace: live
---
${values.instructions}
`,
  );
  return path;
}

test('new agents resolve model and thinking in parent, user, project, role and call order', async () => {
  let parentHost: ConfigurationHost | undefined;
  let layeredHost: ConfigurationHost | undefined;
  try {
    parentHost = await launchPi(
      '{}',
      undefined,
      'subagent',
      'fullscreen',
      finishModel,
    );
    const parent = await dispatch(parentHost, {
      name: 'parent-fallback',
      prompt: 'PARENT_CONFIGURATION',
      workspace: 'live',
      tools: ['subagent'],
    });
    await waitForFleet(parentHost);
    let snapshot = await inspect(parentHost);
    let task = taskById(snapshot, parent.taskId);
    expect(task.configuration.model).toBe('fixture/fixture');
    expect(task.configuration.thinking).toBe('off');
    expect(task.outcome).toBe('fulfilled');
    await expectSessionModel(task);

    layeredHost = await launchPi(
      JSON.stringify({
        subagent: {
          defaults: {
            model: 'fixture/user-model',
            thinking: 'minimal',
          },
        },
      }),
      undefined,
      'subagent',
      'fullscreen',
      finishModel,
    );
    await installFixtureModelAliases(layeredHost, [
      'user-model',
      'project-model',
      'role-model',
      'call-model',
    ]);
    const user = await dispatch(layeredHost, {
      name: 'user-default',
      prompt: 'USER_CONFIGURATION',
      workspace: 'live',
      tools: ['subagent'],
    });
    await waitForFleet(layeredHost);
    snapshot = await inspect(layeredHost);
    task = taskById(snapshot, user.taskId);
    expect(task.configuration.model).toBe('fixture/user-model');
    expect(task.configuration.thinking).toBe('minimal');
    expect(task.outcome).toBe('fulfilled');
    await expectSessionModel(task);

    await writeProjectDefaults(layeredHost, {
      model: 'fixture/project-model',
      thinking: 'low',
    });
    const project = await dispatch(layeredHost, {
      name: 'project-default',
      prompt: 'PROJECT_CONFIGURATION',
      workspace: 'live',
      tools: ['subagent'],
    });
    await waitForFleet(layeredHost);
    snapshot = await inspect(layeredHost);
    task = taskById(snapshot, project.taskId);
    expect(task.configuration.model).toBe('fixture/project-model');
    expect(task.configuration.thinking).toBe('low');
    expect(task.outcome).toBe('fulfilled');
    await expectSessionModel(task);

    await writeRole(layeredHost, {
      model: 'fixture/role-model',
      thinking: 'high',
      instructions: 'ROLE_CONFIGURATION',
    });
    const role = await dispatch(layeredHost, {
      name: 'role-default',
      prompt: 'ROLE_CONFIGURATION',
      role: 'precedence',
      workspace: 'live',
      tools: ['subagent'],
    });
    await waitForFleet(layeredHost);
    snapshot = await inspect(layeredHost);
    task = taskById(snapshot, role.taskId);
    expect(task.configuration.model).toBe('fixture/role-model');
    expect(task.configuration.thinking).toBe('high');
    expect(task.outcome).toBe('fulfilled');
    await expectSessionModel(task);

    const call = await dispatch(layeredHost, {
      name: 'call-override',
      prompt: 'CALL_CONFIGURATION',
      role: 'precedence',
      model: 'fixture/call-model',
      thinking: 'max',
      workspace: 'live',
      tools: ['subagent'],
    });
    await waitForFleet(layeredHost);
    snapshot = await inspect(layeredHost);
    task = taskById(snapshot, call.taskId);
    expect(task.configuration.model).toBe('fixture/call-model');
    expect(task.configuration.thinking).toBe('max');
    expect(task.outcome).toBe('fulfilled');
    await expectSessionModel(task);
  } finally {
    await parentHost?.close();
    await layeredHost?.close();
  }
}, 60000);

test('retained follow-up keeps saved model and thinking after role edits while new agents use the changed role', async () => {
  let host: ConfigurationHost | undefined;
  try {
    host = await launchPi(
      '{}',
      undefined,
      'subagent',
      'fullscreen',
      finishModel,
    );
    await installFixtureModelAliases(host, [
      'changed-role-model',
      'followup-model',
    ]);
    await writeRole(host, {
      model: 'fixture/fixture',
      thinking: 'low',
      instructions: 'ORIGINAL_ROLE_CONFIGURATION',
    });
    const initial = await dispatch(host, {
      name: 'retained-reviewer',
      prompt: 'INITIAL_ROLE_CONFIGURATION',
      role: 'precedence',
      workspace: 'live',
      tools: ['subagent'],
    });
    await waitForFleet(host);
    let snapshot = await inspect(host);
    let initialTask = taskById(snapshot, initial.taskId);
    expect(initialTask.configuration.model).toBe('fixture/fixture');
    expect(initialTask.configuration.thinking).toBe('low');
    expect(initialTask.outcome).toBe('fulfilled');
    await expectSessionModel(initialTask);

    await writeRole(host, {
      model: 'fixture/changed-role-model',
      thinking: 'high',
      instructions: 'CHANGED_ROLE_CONFIGURATION',
    });
    const followupResult = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'followup',
          agentId: initial.agentId,
          text: 'RETAINED_FOLLOWUP_CONFIGURATION',
        }),
      ),
    );
    const followup = followupResult.tasks[0];
    if (followup === undefined) throw new Error('Follow-up admitted no task.');
    await waitForFleet(host);

    const overriddenFollowupResult = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'followup',
          agentId: initial.agentId,
          text: 'OVERRIDDEN_FOLLOWUP_CONFIGURATION',
          overrides: {
            model: 'fixture/followup-model',
            thinking: 'max',
          },
        }),
      ),
    );
    const overriddenFollowup = overriddenFollowupResult.tasks[0];
    if (overriddenFollowup === undefined)
      throw new Error('Overridden follow-up admitted no task.');
    await waitForFleet(host);

    const changedRole = await dispatch(host, {
      name: 'new-role-definition',
      prompt: 'NEW_ROLE_CONFIGURATION',
      role: 'precedence',
      workspace: 'live',
      tools: ['subagent'],
    });
    await waitForFleet(host);
    snapshot = await inspect(host);
    initialTask = taskById(snapshot, initial.taskId);
    const retainedTask = taskById(snapshot, followup.taskId);
    const overriddenTask = taskById(snapshot, overriddenFollowup.taskId);
    const changedTask = taskById(snapshot, changedRole.taskId);
    expect(initialTask.configuration.model).toBe('fixture/fixture');
    expect(initialTask.configuration.thinking).toBe('low');
    await expectSessionModel(initialTask);
    expect(retainedTask.configuration.model).toBe('fixture/fixture');
    expect(retainedTask.configuration.thinking).toBe('low');
    expect(retainedTask.outcome).toBe('fulfilled');
    await expectSessionModel(retainedTask);
    expect(overriddenTask.configuration.model).toBe('fixture/followup-model');
    expect(overriddenTask.configuration.thinking).toBe('max');
    expect(overriddenTask.outcome).toBe('fulfilled');
    await expectSessionModel(overriddenTask);
    expect(changedTask.configuration.model).toBe('fixture/changed-role-model');
    expect(changedTask.configuration.thinking).toBe('high');
    expect(changedTask.outcome).toBe('fulfilled');
    await expectSessionModel(changedTask);
  } finally {
    await host?.close();
  }
}, 60000);
