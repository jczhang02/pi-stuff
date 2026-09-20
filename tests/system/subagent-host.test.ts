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

test('an incomplete assignment holds its retained queue until explicit continuation', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let continuationRan = false;
  const host = await launchPi(
    '{}',
    undefined,
    'web',
    'fullscreen',
    async request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      if (history.includes('CONTINUE_HELD_REVIEW')) {
        continuationRan = true;
        if (request.messages.at(-1)?.role === 'tool')
          return {text: 'Delivered.'};
        return {
          tool: 'subagent',
          arguments:
            '{"command":"finish","outcome":"fulfilled","text":"Second assignment completed."}',
        };
      }
      started.resolve();
      await release.promise;
      return {text: 'Stopped without declaring fulfillment.'};
    },
  );
  try {
    const admitted = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {name: 'reviewer', prompt: 'FIRST_HELD_REVIEW', workspace: 'live'},
          ],
        }),
      ),
    );
    await started.promise;
    const agentId = admitted.tasks[0]?.agentId;
    const next = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'followup',
        agentId,
        text: 'CONTINUE_HELD_REVIEW',
      }),
    );
    expect(next).toContain('"status":"accepted"');
    release.resolve();
    const result = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'wait',
        taskId: admitted.tasks[0]?.taskId,
        timeoutMs: 3000,
      }),
    );
    expect(result).toContain('"outcome":"incomplete"');
    expect(result).toContain('"held":true');
    expect(continuationRan).toBe(false);
    await host.invoke(
      'subagent',
      JSON.stringify({command: 'queue', agentId, queueAction: 'continue'}),
    );
    const completed = await host.invoke(
      'subagent',
      '{"command":"wait","timeoutMs":3000}',
    );
    expect(completed).toContain('Second assignment completed.');
    expect(continuationRan).toBe(true);
  } finally {
    release.resolve();
    await host.close();
  }
}, 30000);

test('an execution deadline cancels a blocked model request without rerunning it', async () => {
  const release = Promise.withResolvers<void>();
  let requests = 0;
  const host = await launchPi(
    '{}',
    undefined,
    'web',
    'fullscreen',
    async request => {
      if (!JSON.stringify(request.messages).includes('SUBAGENT_ASSIGNMENT'))
        return undefined;
      requests++;
      await release.promise;
      return {text: 'Too late.'};
    },
  );
  try {
    const initial = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'slow',
              prompt: 'DEADLINE_MODEL',
              workspace: 'live',
              executionTimeoutMs: 150,
            },
          ],
        }),
      ),
    );
    const result = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'wait',
        taskId: initial.tasks[0]?.taskId,
        timeoutMs: 3000,
      }),
    );
    expect(result).toContain('"outcome":"cancelled"');
    expect(result).toContain('Execution deadline expired.');
    expect(requests).toBe(1);
  } finally {
    release.resolve();
    await host.close();
  }
}, 30000);

test('Pi exposes one subagent tool and an empty retained fleet', async () => {
  const host = await launchPi('{}', undefined, 'web');
  try {
    const result = await host.invoke('subagent', '{"command":"inspect"}');
    expect(result).toContain('"agents":[]');
    expect(result).toContain('"tasks":[]');
    expect(host.offered().filter(name => name.includes('subagent'))).toEqual([
      'subagent',
    ]);
  } finally {
    await host.close();
  }
}, 30000);

test('steering accepted during the final request is consumed in the same assignment', async () => {
  const finalStarted = Promise.withResolvers<void>();
  const releaseFinal = Promise.withResolvers<void>();
  let finalHeld = false;
  let consumed = false;
  const host = await launchPi(
    '{}',
    undefined,
    'web',
    'fullscreen',
    async request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      if (history.includes('REVIEW_THE_TIMEOUT')) {
        consumed = true;
        if (request.messages.at(-1)?.role === 'tool')
          return {text: 'Revised delivery.'};
        return {
          tool: 'subagent',
          arguments:
            '{"command":"finish","outcome":"fulfilled","text":"Timeout reviewed."}',
        };
      }
      if (request.messages.at(-1)?.role === 'tool') {
        if (!finalHeld) {
          finalHeld = true;
          finalStarted.resolve();
          await releaseFinal.promise;
        }
        return {text: 'Original delivery.'};
      }
      return {
        tool: 'subagent',
        arguments:
          '{"command":"finish","outcome":"fulfilled","text":"Original review."}',
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
            {name: 'reviewer', prompt: 'REVIEW_LOGIN', workspace: 'live'},
          ],
        }),
      ),
    );
    const taskId = admitted.tasks[0]?.taskId;
    expect(taskId).toBeDefined();
    await Promise.race([
      finalStarted.promise,
      new Promise<void>((_resolve, reject) =>
        setTimeout(() => reject(new Error('Final request missing.')), 5000),
      ),
    ]);
    const receipt = await host.invoke(
      'subagent',
      JSON.stringify({command: 'steer', taskId, text: 'REVIEW_THE_TIMEOUT'}),
    );
    expect(receipt).toContain('"status":"accepted"');
    releaseFinal.resolve();
    const result = await host.invoke(
      'subagent',
      JSON.stringify({command: 'wait', taskId, timeoutMs: 5000}),
    );
    expect(consumed).toBe(true);
    expect(result).toContain('Timeout reviewed.');
    expect(result).toContain('"durability":"saved"');
  } finally {
    releaseFinal.resolve();
    await host.close();
  }
}, 30000);

test('a ready dependent starts while an unrelated parallel investigation is still active', async () => {
  const release = Promise.withResolvers<void>();
  const dependentStarted = Promise.withResolvers<void>();
  let slowActive = false;
  let overlapped = false;
  let receivedEvidence = false;
  const host = await launchPi(
    '{}',
    undefined,
    'web',
    'fullscreen',
    async request => {
      if (!JSON.stringify(request.messages).includes('SUBAGENT_ASSIGNMENT'))
        return undefined;
      if (request.messages.at(-1)?.role === 'tool') return {text: 'Delivered.'};
      const prompt = request.messages
        .filter(message => message.role === 'user')
        .at(-1)?.content;
      if (JSON.stringify(prompt).includes('SLOW_DATABASE')) {
        slowActive = true;
        await release.promise;
        slowActive = false;
      }
      if (JSON.stringify(prompt).includes('READY_API')) {
        overlapped = slowActive;
        receivedEvidence = JSON.stringify(prompt).includes(
          'Fixed upstream evidence.',
        );
        dependentStarted.resolve();
      }
      return {
        tool: 'subagent',
        arguments: JSON.stringify({
          command: 'finish',
          outcome: 'fulfilled',
          text: 'Fixed upstream evidence.',
        }),
      };
    },
  );
  try {
    const admitted = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {key: 'api', name: 'api', prompt: 'FAST_API', workspace: 'live'},
          {key: 'db', name: 'db', prompt: 'SLOW_DATABASE', workspace: 'live'},
          {
            key: 'writer',
            name: 'writer',
            prompt: 'READY_API',
            needs: ['api'],
            workspace: 'live',
          },
        ],
      }),
    );
    expect(admitted).toContain('"status":"accepted"');
    await Promise.race([
      dependentStarted.promise,
      new Promise<void>((_resolve, reject) =>
        setTimeout(() => reject(new Error('Ready task did not start.')), 5000),
      ),
    ]);
    expect(overlapped).toBe(true);
    expect(receivedEvidence).toBe(true);
    const snapshot = await host.invoke('subagent', '{"command":"inspect"}');
    expect(snapshot).toContain('Fixed upstream evidence.');
  } finally {
    release.resolve();
    await host.close();
  }
}, 30000);

test('a delegated researcher delivers an explicit saved result in its own context', async () => {
  const host = await launchPi('{}', undefined, 'web', 'fullscreen', request => {
    if (!JSON.stringify(request.messages).includes('SUBAGENT_ASSIGNMENT'))
      return undefined;
    if (request.messages.at(-1)?.role === 'tool')
      return {text: 'Research complete.'};
    return {
      tool: 'subagent',
      arguments: JSON.stringify({
        command: 'finish',
        outcome: 'fulfilled',
        text: 'The login failure originates in expired sessions.',
      }),
    };
  });
  try {
    const admitted = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {
            name: 'researcher',
            prompt: 'Investigate the login failure.',
            workspace: 'live',
          },
        ],
      }),
    );
    expect(admitted).toContain('"status":"accepted"');
    const settled = await host.invoke(
      'subagent',
      '{"command":"wait","timeoutMs":5000}',
    );
    expect(settled).toContain('expired sessions');
    expect(settled).toContain('"outcome":"fulfilled"');
    expect(settled).toContain('"durability":"saved"');
  } finally {
    await host.close();
  }
}, 30000);

test('completed agent follow-up keeps old results and rejects known invalid graphs atomically', async () => {
  const host = await launchPi('{}', undefined, 'web', 'fullscreen', request => {
    const history = JSON.stringify(request.messages);
    if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
    if (request.messages.at(-1)?.role === 'tool') return {text: 'Delivered.'};
    return {
      tool: 'subagent',
      arguments: JSON.stringify({
        command: 'finish',
        outcome: 'fulfilled',
        text: history.includes('SECOND_REVIEW')
          ? 'Retained first review, reviewed again.'
          : 'First review evidence.',
      }),
    };
  });
  try {
    const invalid = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {
            key: 'a',
            name: 'a',
            prompt: 'Cycle a',
            needs: ['b'],
            workspace: 'live',
          },
          {
            key: 'b',
            name: 'b',
            prompt: 'Cycle b',
            needs: ['a'],
            workspace: 'live',
          },
        ],
      }),
    );
    expect(invalid).toContain('"status":"rejected"');
    expect(await host.invoke('subagent', '{"command":"inspect"}')).toContain(
      '"tasks":[]',
    );
    const admitted = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {name: 'reviewer', prompt: 'FIRST_REVIEW', workspace: 'live'},
          ],
        }),
      ),
    );
    await host.invoke('subagent', '{"command":"wait","timeoutMs":5000}');
    const result = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'followup',
        agentId: admitted.tasks[0]?.agentId,
        text: 'SECOND_REVIEW',
      }),
    );
    expect(result).toContain('"status":"accepted"');
    const completed = await host.invoke(
      'subagent',
      '{"command":"wait","timeoutMs":5000}',
    );
    expect(completed).toContain('First review evidence.');
    expect(completed).toContain('Retained first review, reviewed again.');
  } finally {
    await host.close();
  }
}, 30000);

test('a lead joins its child without occupying the only execution slot', async () => {
  let childRan = false;
  let leadConsumed = false;
  const host = await launchPi(
    '{"subagent":{"concurrency":1}}',
    undefined,
    'web',
    'fullscreen',
    request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      const user = JSON.stringify(
        request.messages.filter(message => message.role === 'user').at(-1)
          ?.content,
      );
      if (user.includes('CHILD_EVIDENCE_TASK')) {
        childRan = true;
        if (request.messages.at(-1)?.role === 'tool')
          return {text: 'Delivered.'};
        return {
          tool: 'subagent',
          arguments:
            '{"command":"finish","outcome":"fulfilled","text":"Child found timeout evidence."}',
        };
      }
      if (history.includes('Child found timeout evidence.')) {
        leadConsumed = true;
        if (request.messages.at(-1)?.role === 'tool') return {text: 'Joined.'};
        return {
          tool: 'subagent',
          arguments:
            '{"command":"finish","outcome":"fulfilled","text":"Lead incorporated child evidence."}',
        };
      }
      if (request.messages.at(-1)?.role === 'tool')
        return {text: 'Premature lead report.'};
      return {
        tool: 'subagent',
        arguments: JSON.stringify({
          command: 'dispatch',
          tasks: [
            {name: 'child', prompt: 'CHILD_EVIDENCE_TASK', workspace: 'live'},
          ],
        }),
      };
    },
  );
  try {
    const initial = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [{name: 'lead', prompt: 'LEAD_TASK', workspace: 'live'}],
        }),
      ),
    );
    const result = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'wait',
        taskId: initial.tasks[0]?.taskId,
        timeoutMs: 5000,
      }),
    );
    expect(childRan).toBe(true);
    expect(leadConsumed).toBe(true);
    expect(result).toContain('Lead incorporated child evidence.');
  } finally {
    await host.close();
  }
}, 30000);

test('a child question wakes a joining parent and a reply resumes through the single slot', async () => {
  let answerConsumed = false;
  const host = await launchPi(
    '{"subagent":{"concurrency":1,"answerWaitMs":3000}}',
    undefined,
    'web',
    'fullscreen',
    request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      const user = JSON.stringify(
        request.messages.filter(message => message.role === 'user').at(-1)
          ?.content,
      );
      const last = JSON.stringify(request.messages.at(-1)?.content);
      if (user.includes('ASK_FIELD')) {
        if (history.includes('Use customer_id.')) {
          answerConsumed = true;
          if (last.includes('Declaration recorded.'))
            return {text: 'Delivered.'};
          return {
            tool: 'subagent',
            arguments:
              '{"command":"finish","outcome":"fulfilled","text":"Field resolved."}',
          };
        }
        return {
          tool: 'subagent',
          arguments: '{"command":"ask","text":"Which field should I use?"}',
        };
      }
      const question = /Question ([a-f0-9-]+):/.exec(history)?.[1];
      if (question && !history.includes('Use customer_id.'))
        return {
          tool: 'subagent',
          arguments: JSON.stringify({
            command: 'reply',
            questionId: question,
            text: 'Use customer_id.',
          }),
        };
      if (history.includes('Field resolved.')) {
        if (last.includes('Declaration recorded.')) return {text: 'Joined.'};
        return {
          tool: 'subagent',
          arguments:
            '{"command":"finish","outcome":"fulfilled","text":"Lead completed."}',
        };
      }
      if (request.messages.at(-1)?.role === 'tool')
        return {text: 'Waiting for child.'};
      return {
        tool: 'subagent',
        arguments: JSON.stringify({
          command: 'dispatch',
          tasks: [{name: 'database', prompt: 'ASK_FIELD', workspace: 'live'}],
        }),
      };
    },
  );
  try {
    const initial = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [{name: 'lead', prompt: 'LEAD_FIELD', workspace: 'live'}],
        }),
      ),
    );
    const result = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'wait',
        taskId: initial.tasks[0]?.taskId,
        timeoutMs: 5000,
      }),
    );
    expect(answerConsumed).toBe(true);
    expect(result).toContain('Lead completed.');
  } finally {
    await host.close();
  }
}, 30000);
