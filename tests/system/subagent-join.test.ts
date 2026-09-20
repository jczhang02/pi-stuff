import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {launchPi} from './fixtures/pi-terminal';

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
        prompt: Schema.String,
        parentTaskId: Schema.NullOr(Schema.String),
        phase: Schema.String,
        stage: Schema.String,
        reason: Schema.String,
        outcome: Schema.NullOr(Schema.String),
        declaration: Schema.NullOr(Schema.String),
        report: Schema.String,
      }),
    ),
  }),
);

test('consuming a new child outcome invalidates an early parent declaration', async () => {
  let parentCalls = 0;
  let childCalls = 0;
  let consumerCalls = 0;
  let sawNewOutcomes = false;
  const host = await launchPi(
    '{"subagent":{"concurrency":2}}',
    undefined,
    'web',
    'fullscreen',
    async request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      const prompt = JSON.stringify(
        request.messages.filter(message => message.role === 'user').at(-1)
          ?.content,
      );
      const last = JSON.stringify(request.messages.at(-1)?.content);
      if (prompt.includes('CONSUMER')) {
        consumerCalls++;
        return {text: 'Consumer must not run.'};
      }
      if (prompt.includes('CHILD_LATE')) {
        childCalls++;
        if (childCalls === 1) {
          await Bun.sleep(500);
          return {
            tool: 'subagent',
            arguments:
              '{"command":"finish","outcome":"fulfilled","text":"Child changed the evidence."}',
          };
        }
        return {text: 'Child delivered.'};
      }
      if (last.includes('Owned child outcomes')) {
        sawNewOutcomes = true;
        return {text: 'I considered the child but forgot to redeclare.'};
      }
      if (!prompt.includes('PARENT_EARLY')) return {text: 'Unrelated.'};
      parentCalls++;
      if (last.includes('Declaration recorded.'))
        return {text: 'The early declaration was accepted.'};
      if (parentCalls === 1)
        return {
          tool: 'subagent',
          arguments:
            '{"command":"dispatch","tasks":[{"name":"child","prompt":"CHILD_LATE","workspace":"live","tools":["subagent"]}]}',
        };
      return {
        tool: 'subagent',
        arguments:
          '{"command":"finish","outcome":"fulfilled","text":"Early parent declaration."}',
      };
    },
  );
  try {
    const admitted = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'lead',
              key: 'lead',
              prompt: 'PARENT_EARLY',
              workspace: 'live',
              tools: ['subagent'],
            },
            {
              name: 'consumer',
              needs: ['lead'],
              prompt: 'CONSUMER',
              workspace: 'live',
              tools: ['subagent'],
            },
          ],
        }),
      ),
    );
    expect(admitted.tasks).toHaveLength(2);
    let waited = Schema.decodeUnknownSync(Snapshot)(
      await host.invoke('subagent', '{"command":"wait","timeoutMs":10000}'),
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      if (waited.tasks.every(task => task.phase === 'ended')) break;
      waited = Schema.decodeUnknownSync(Snapshot)(
        await host.invoke('subagent', '{"command":"wait","timeoutMs":10000}'),
      );
    }
    const lead = waited.tasks.find(task => task.prompt === 'PARENT_EARLY');
    const consumer = waited.tasks.find(task => task.prompt === 'CONSUMER');
    expect(lead?.phase).toBe('ended');
    expect(lead?.outcome).toBe('incomplete');
    expect(lead?.declaration).toBe('fulfilled');
    expect(consumer?.outcome).toBe('skipped');
    expect(consumerCalls).toBe(0);
    expect(childCalls).toBe(2);
    expect(sawNewOutcomes).toBe(true);
  } finally {
    await host.close();
  }
}, 30000);
