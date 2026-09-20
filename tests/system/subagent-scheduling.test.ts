import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {launchPi} from './fixtures/pi-terminal';

const Snapshot = Schema.fromJsonString(
  Schema.Struct({
    tasks: Schema.Array(
      Schema.Struct({
        phase: Schema.String,
        outcome: Schema.NullOr(Schema.String),
        executionMs: Schema.Number,
        startedAt: Schema.NullOr(Schema.Number),
        endedAt: Schema.NullOr(Schema.Number),
      }),
    ),
    messages: Schema.Array(
      Schema.Struct({id: Schema.String, kind: Schema.String}),
    ),
  }),
);

test('parallel waits keep a live tool slot and both resume after their child releases the only slot', async () => {
  const requestStarted = Promise.withResolvers<void>();
  const releaseRequest = Promise.withResolvers<void>();
  let childCalls = 0;
  let leadCalls = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch() {
      requestStarted.resolve();
      await releaseRequest.promise;
      return new Response('Slow fixture resource.', {
        headers: {'content-type': 'text/plain'},
      });
    },
  });
  const host = await launchPi(
    '{"subagent":{"concurrency":1}}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      const prompt = JSON.stringify(
        request.messages.find(message => message.role === 'user')?.content,
      );
      if (prompt.includes('SLOT_CHILD')) {
        childCalls++;
        return childCalls === 1
          ? {
              tool: 'subagent',
              arguments:
                '{"command":"finish","outcome":"fulfilled","text":"Child acquired the slot."}',
            }
          : {text: 'Child delivered.'};
      }
      leadCalls++;
      if (leadCalls === 1)
        return {
          tool: 'subagent',
          arguments:
            '{"command":"dispatch","tasks":[{"name":"child","prompt":"SLOT_CHILD","workspace":"live","tools":["subagent"]}]}',
        };
      if (leadCalls === 2) {
        const calls = [
          {
            index: 0,
            id: 'slow-resource',
            type: 'function',
            function: {
              name: 'fetch_content',
              arguments: JSON.stringify({
                urls: [String(server.url)],
                mode: 'raw',
              }),
            },
          },
          {
            index: 1,
            id: 'wait-for-child',
            type: 'function',
            function: {
              name: 'subagent',
              arguments: '{"command":"wait","timeoutMs":5000}',
            },
          },
          {
            index: 2,
            id: 'wait-for-child-again',
            type: 'function',
            function: {
              name: 'subagent',
              arguments: '{"command":"wait","timeoutMs":5000}',
            },
          },
        ];
        const chunk = {
          id: 'parallel-wait',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [
            {index: 0, delta: {tool_calls: calls}, finish_reason: null},
          ],
        };
        return new Response(
          `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({
            ...chunk,
            choices: [{index: 0, delta: {}, finish_reason: 'tool_calls'}],
          })}\n\ndata: [DONE]\n\n`,
          {headers: {'content-type': 'text/event-stream'}},
        );
      }
      if (leadCalls === 3)
        return {
          tool: 'subagent',
          arguments:
            '{"command":"finish","outcome":"fulfilled","text":"Lead joined after both tools settled."}',
        };
      return {text: 'Lead delivered.'};
    },
  );
  try {
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {
            name: 'lead',
            prompt: 'SLOT_LEAD',
            workspace: 'live',
            tools: ['subagent', 'fetch_content'],
            extensions: ['pi-stuff:web'],
          },
        ],
      }),
    );
    await requestStarted.promise;
    const held = await host.invoke(
      'subagent',
      '{"command":"wait","timeoutMs":100}',
    );
    expect(held).toContain('"waitStatus":"expired"');
    expect(held).toContain('explicit result wait');
    expect(childCalls).toBe(0);
    releaseRequest.resolve();
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await host.invoke(
        'subagent',
        '{"command":"wait","timeoutMs":5000}',
      );
      if (result.includes('"waitStatus":"settled"')) break;
    }
    const finished = await host.invoke('subagent', '{"command":"inspect"}');
    expect(finished).toContain('Lead joined after both tools settled.');
    expect(childCalls).toBe(2);
    expect(leadCalls).toBe(4);
    expect(finished).not.toContain('"phase":"executing"');
    expect(finished).not.toContain('"phase":"queued"');
  } finally {
    releaseRequest.resolve();
    await host.close();
    await server.stop(true);
  }
}, 30000);

test('waiting for an answer beyond the execution allowance does not consume execution time', async () => {
  let calls = 0;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      if (!JSON.stringify(request.messages).includes('SUBAGENT_ASSIGNMENT'))
        return undefined;
      calls++;
      if (calls === 1)
        return {
          tool: 'subagent',
          arguments: '{"command":"ask","text":"Which field?","timeoutMs":5000}',
        };
      if (calls === 2)
        return {
          tool: 'subagent',
          arguments:
            '{"command":"finish","outcome":"fulfilled","text":"Used the answered field."}',
        };
      return {text: 'Delivered.'};
    },
  );
  try {
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {
            name: 'waiting',
            prompt: 'ASK_THEN_COMPLETE',
            workspace: 'live',
            executionTimeoutMs: 1000,
          },
        ],
      }),
    );
    const question = Schema.decodeUnknownSync(Snapshot)(
      await host.invoke('subagent', '{"command":"wait","timeoutMs":2000}'),
    ).messages.find(message => message.kind === 'question');
    if (!question) throw new Error('Child did not ask the expected question.');
    const waiting = await host.invoke(
      'subagent',
      '{"command":"wait","timeoutMs":1300}',
    );
    expect(waiting).toContain('"waitStatus":"expired"');
    expect(waiting).toContain('"phase":"waiting"');
    expect(calls).toBe(1);
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'reply',
        questionId: question.id,
        text: 'account_id',
      }),
    );
    const result = Schema.decodeUnknownSync(Snapshot)(
      await host.invoke('subagent', '{"command":"wait","timeoutMs":3000}'),
    );
    const task = result.tasks[0];
    expect(task?.outcome).toBe('fulfilled');
    expect(task?.executionMs).toBeLessThan(1000);
    expect((task?.endedAt ?? 0) - (task?.startedAt ?? 0)).toBeGreaterThan(1300);
    expect(calls).toBe(3);
  } finally {
    await host.close();
  }
}, 30000);
