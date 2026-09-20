import {expect, test} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import {
  launchPi,
  type FixtureReply,
  type ModelRequest,
} from './fixtures/pi-terminal';

const Admission = Schema.fromJsonString(
  Schema.Struct({
    tasks: Schema.Array(
      Schema.Struct({taskId: Schema.String, agentId: Schema.String}),
    ),
  }),
);

const Snapshot = Schema.fromJsonString(
  Schema.Struct({
    tasks: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        agentId: Schema.String,
        phase: Schema.String,
        outcome: Schema.NullOr(Schema.String),
        configuration: Schema.Struct({workspace: Schema.String}),
        currentTools: Schema.Array(Schema.String),
      }),
    ),
  }),
);

function childPrompt(request: ModelRequest): string {
  return JSON.stringify(
    request.messages.filter(message => message.role === 'user').at(-1)?.content,
  );
}

test('a retained direct workspace cannot be relabelled write on follow-up', async () => {
  let childTurns = 0;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    (request): FixtureReply | undefined => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      if (!childPrompt(request).includes('INITIAL_DIRECT')) {
        return {
          tool: 'subagent',
          arguments:
            '{"command":"finish","outcome":"fulfilled","text":"Follow-up delivered."}',
        };
      }
      if (childTurns++ === 0)
        return {
          tool: 'bash',
          arguments: '{"command":"printf direct > direct-followup-marker.txt"}',
        };
      if (request.messages.at(-1)?.role === 'tool') {
        const last = JSON.stringify(request.messages.at(-1)?.content);
        if (last.includes('Declaration recorded.'))
          return {text: 'Initial direct assignment delivered.'};
      }
      return {
        tool: 'subagent',
        arguments:
          '{"command":"finish","outcome":"fulfilled","text":"Initial direct assignment delivered."}',
      };
    },
  );
  try {
    const admission = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        '{"command":"dispatch","tasks":[{"name":"direct-reviewer","prompt":"INITIAL_DIRECT","workspace":"direct","tools":["bash","subagent"]}]}',
      ),
    );
    const task = admission.tasks[0];
    if (!task) throw new Error('Direct assignment was not admitted.');
    await host.invoke(
      'subagent',
      JSON.stringify({command: 'wait', taskId: task.taskId, timeoutMs: 5000}),
    );
    expect(
      await readFile(
        join(host.directory, 'direct-followup-marker.txt'),
        'utf8',
      ),
    ).toBe('direct');

    const initial = Schema.decodeUnknownSync(Snapshot)(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    expect(initial.tasks).toHaveLength(1);
    expect(initial.tasks[0]?.configuration.workspace).toBe('direct');

    for (const overrides of [
      {workspace: 'write'},
      {workspace: 'write', baseline: 'HEAD'},
    ]) {
      const rejected = await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'followup',
          agentId: task.agentId,
          text: 'CHANGE_RETAINED_MODE',
          overrides,
        }),
      );
      expect(rejected).toContain('retained workspace mode');
    }

    const after = Schema.decodeUnknownSync(Snapshot)(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    expect(after.tasks).toHaveLength(1);
    expect(after.tasks[0]?.configuration.workspace).toBe('direct');
  } finally {
    await host.close();
  }
}, 30000);

test('a restriction must retain subagent so an active child can still deliver', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let finishSent = false;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    async (request): Promise<FixtureReply | undefined> => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      if (!childPrompt(request).includes('RESTRICT_REQUIRED_TOOL'))
        return {text: 'Unrelated assignment finished.'};
      started.resolve();
      await release.promise;
      if (!finishSent) {
        finishSent = true;
        return {
          tool: 'subagent',
          arguments:
            '{"command":"finish","outcome":"fulfilled","text":"Restriction-safe delivery."}',
        };
      }
      return {text: 'Restriction-safe delivery.'};
    },
  );
  try {
    const admission = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        '{"command":"dispatch","tasks":[{"name":"active-child","prompt":"RESTRICT_REQUIRED_TOOL","workspace":"direct","tools":["read","subagent"]}]}',
      ),
    );
    const task = admission.tasks[0];
    if (!task) throw new Error('Active assignment was not admitted.');
    await started.promise;

    for (const tools of [[], ['read']] as const) {
      const rejected = await host.invoke(
        'subagent',
        JSON.stringify({command: 'restrict', taskId: task.taskId, tools}),
      );
      expect(rejected).toContain('subagent');
    }

    release.resolve();
    await host.invoke(
      'subagent',
      JSON.stringify({command: 'wait', taskId: task.taskId, timeoutMs: 5000}),
    );
    const after = Schema.decodeUnknownSync(Snapshot)(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    const completed = after.tasks.find(
      candidate => candidate.id === task.taskId,
    );
    expect(completed?.phase).toBe('ended');
    expect(completed?.outcome).toBe('fulfilled');
    expect(completed?.currentTools).toContain('subagent');
  } finally {
    release.resolve();
    await host.close();
  }
}, 30000);
