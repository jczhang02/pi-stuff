import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import {launchPi} from './fixtures/pi-terminal';

const Admission = Schema.fromJsonString(
  Schema.Struct({
    tasks: Schema.Array(
      Schema.Struct({taskId: Schema.String, agentId: Schema.String}),
    ),
  }),
);
const Usage = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
});
const Inspection = Schema.fromJsonString(
  Schema.Struct({
    usage: Schema.Struct({...Usage.fields, turns: Schema.Number}),
    tasks: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        phase: Schema.String,
        outcome: Schema.NullOr(Schema.String),
        retries: Schema.Number,
        turns: Schema.Number,
        usage: Schema.NullOr(Usage),
      }),
    ),
  }),
);

test('real provider retries and followups keep per-assignment usage without double counting history', async () => {
  let requests = 0;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      requests++;
      if (requests === 1)
        return new Response(
          JSON.stringify({
            error: {message: 'fixture overloaded', type: 'server_error'},
          }),
          {status: 503, headers: {'content-type': 'application/json'}},
        );
      const usage = {input: 10, output: 3};
      if (request.messages.at(-1)?.role === 'tool')
        return {text: 'Delivered.', usage};
      return {
        tool: 'subagent',
        arguments: JSON.stringify({
          command: 'finish',
          outcome: 'fulfilled',
          text: history.includes('FOLLOWUP_USAGE')
            ? 'Second report.'
            : 'First report.',
        }),
        usage,
      };
    },
  );
  try {
    await writeFile(
      join(host.agent, 'settings.json'),
      JSON.stringify({
        retry: {
          enabled: true,
          maxRetries: 1,
          baseDelayMs: 20,
          provider: {maxRetries: 0},
        },
      }),
    );
    const first = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [{name: 'usage', prompt: 'FIRST_USAGE', workspace: 'live'}],
        }),
      ),
    );
    await host.invoke('subagent', '{"command":"wait","timeoutMs":5000}');
    const before = Schema.decodeUnknownSync(Inspection)(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    expect(before.tasks[0]?.outcome).toBe('fulfilled');
    expect(before.tasks[0]?.retries).toBe(1);
    expect(before.tasks[0]?.usage).toMatchObject({
      input: 20,
      output: 6,
    });
    expect(before.tasks[0]?.turns).toBe(3);
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'followup',
        agentId: first.tasks[0]?.agentId,
        text: 'FOLLOWUP_USAGE',
      }),
    );
    await host.invoke('subagent', '{"command":"wait","timeoutMs":5000}');
    const after = Schema.decodeUnknownSync(Inspection)(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    expect(after.tasks).toHaveLength(2);
    expect(after.tasks[0]).toEqual(before.tasks[0]);
    expect(after.tasks[1]?.retries).toBe(0);
    expect(after.tasks[1]?.usage).toMatchObject({
      input: 20,
      output: 6,
    });
    expect(after.tasks[1]?.turns).toBe(2);
    expect(after.usage).toMatchObject({input: 40, output: 12, turns: 5});
    expect(requests).toBe(5);
  } finally {
    await host.close();
  }
}, 30000);
