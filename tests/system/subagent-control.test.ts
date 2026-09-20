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
        id: Schema.String,
        agentId: Schema.String,
        prompt: Schema.String,
        phase: Schema.String,
        declaration: Schema.NullOr(Schema.String),
        outcome: Schema.NullOr(Schema.String),
      }),
    ),
    dispatches: Schema.Array(Schema.Struct({admitted: Schema.Number})),
    messages: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        kind: Schema.String,
        text: Schema.String,
        consumedAt: Schema.NullOr(Schema.Number),
      }),
    ),
  }),
);

test('depth rejection consumes no admission and retained follow-ups share the original cumulative allowance', async () => {
  const host = await launchPi(
    '{"subagent":{"maxDepth":1,"tasksPerDispatch":2}}',
    undefined,
    'web',
    'fullscreen',
    request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      const last = JSON.stringify(request.messages.at(-1)?.content);
      const prompt = JSON.stringify(
        request.messages.filter(message => message.role === 'user').at(-1)
          ?.content,
      );
      if (last.includes('Declaration recorded.')) return {text: 'Delivered.'};
      if (
        prompt.includes('ONE_MORE') ||
        last.includes('Maximum delegation depth')
      )
        return {
          tool: 'subagent',
          arguments:
            '{"command":"finish","outcome":"fulfilled","text":"Depth bounded."}',
        };
      return {
        tool: 'subagent',
        arguments:
          '{"command":"dispatch","tasks":[{"name":"too-deep","prompt":"SHOULD_NOT_RUN","workspace":"live"}]}',
      };
    },
  );
  try {
    const admission = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        '{"command":"dispatch","tasks":[{"name":"lead","prompt":"DEPTH_PROBE","workspace":"live"}]}',
      ),
    );
    const first = Schema.decodeUnknownSync(Snapshot)(
      await host.invoke('subagent', '{"command":"wait","timeoutMs":4000}'),
    );
    expect(first.tasks).toHaveLength(1);
    expect(first.dispatches[0]?.admitted).toBe(1);
    const agentId = admission.tasks[0]?.agentId;
    expect(
      await host.invoke(
        'subagent',
        JSON.stringify({command: 'followup', agentId, text: 'ONE_MORE'}),
      ),
    ).toContain('"status":"accepted"');
    await host.invoke('subagent', '{"command":"wait","timeoutMs":4000}');
    expect(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'followup',
          agentId,
          text: 'EXCEEDS_ALLOWANCE',
        }),
      ),
    ).toContain('allowance exhausted');
    const final = Schema.decodeUnknownSync(Snapshot)(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    expect(final.tasks).toHaveLength(2);
    expect(final.dispatches[0]?.admitted).toBe(2);
  } finally {
    await host.close();
  }
}, 30000);

test('cancelling an old parent cannot stop a retained child now assigned directly by main', async () => {
  const active = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const host = await launchPi(
    '{}',
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
      if (last.includes('Declaration recorded.')) return {text: 'Delivered.'};
      if (prompt.includes('MAIN_REASSIGNED_REVIEW')) {
        active.resolve();
        await release.promise;
        return {
          tool: 'subagent',
          arguments:
            '{"command":"finish","outcome":"fulfilled","text":"Main-owned review delivered."}',
        };
      }
      if (prompt.includes('RETAINED_CHILD'))
        return {
          tool: 'subagent',
          arguments:
            '{"command":"finish","outcome":"fulfilled","text":"Child result."}',
        };
      if (prompt.includes('Owned child outcomes'))
        return {
          tool: 'subagent',
          arguments:
            '{"command":"finish","outcome":"fulfilled","text":"Parent joined."}',
        };
      if (request.messages.at(-1)?.role === 'tool')
        return {text: 'Join child.'};
      return {
        tool: 'subagent',
        arguments:
          '{"command":"dispatch","tasks":[{"name":"reviewer","prompt":"RETAINED_CHILD","workspace":"live"}]}',
      };
    },
  );
  try {
    const admission = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        '{"command":"dispatch","tasks":[{"name":"lead","prompt":"OLD_PARENT","workspace":"live"}]}',
      ),
    );
    const parentId = admission.tasks[0]?.taskId;
    const completed = Schema.decodeUnknownSync(Snapshot)(
      await host.invoke(
        'subagent',
        JSON.stringify({command: 'wait', taskId: parentId, timeoutMs: 5000}),
      ),
    );
    const child = completed.tasks.find(
      task => task.prompt === 'RETAINED_CHILD',
    );
    // The scoped wait response may only contain the selected parent.
    const snapshot = child
      ? completed
      : Schema.decodeUnknownSync(Snapshot)(
          await host.invoke('subagent', '{"command":"inspect"}'),
        );
    const retained = snapshot.tasks.find(
      task => task.prompt === 'RETAINED_CHILD',
    );
    if (!retained) throw new Error('Retained reviewer was not created.');
    const followup = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'followup',
          agentId: retained.agentId,
          text: 'MAIN_REASSIGNED_REVIEW',
        }),
      ),
    );
    await active.promise;
    expect(
      await host.invoke(
        'subagent',
        JSON.stringify({command: 'cancel', taskId: parentId}),
      ),
    ).toContain('already-ended');
    const current = Schema.decodeUnknownSync(Snapshot)(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    expect(
      current.tasks.find(task => task.id === followup.tasks[0]?.taskId)?.phase,
    ).toBe('executing');
    release.resolve();
    expect(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'wait',
          taskId: followup.tasks[0]?.taskId,
          timeoutMs: 5000,
        }),
      ),
    ).toContain('Main-owned review delivered.');
  } finally {
    release.resolve();
    await host.close();
  }
}, 30000);

test('answer expiry is explicit and a late reply stays with the original completed assignment', async () => {
  let requests = 0;
  let sawExpiry = false;
  const host = await launchPi('{}', undefined, 'web', 'fullscreen', request => {
    if (!JSON.stringify(request.messages).includes('SUBAGENT_ASSIGNMENT'))
      return undefined;
    requests++;
    const last = JSON.stringify(request.messages.at(-1)?.content);
    if (last.includes('Declaration recorded.'))
      return {text: 'Unable to continue.'};
    if (last.includes('expired')) {
      sawExpiry = true;
      return {
        tool: 'subagent',
        arguments:
          '{"command":"finish","outcome":"unable","text":"No answer was invented."}',
      };
    }
    return {
      tool: 'subagent',
      arguments: '{"command":"ask","text":"Which endpoint?","timeoutMs":50}',
    };
  });
  try {
    await host.invoke(
      'subagent',
      '{"command":"dispatch","tasks":[{"name":"researcher","prompt":"ASK_ENDPOINT","workspace":"live"}]}',
    );
    await host.invoke('subagent', '{"command":"wait","timeoutMs":4000}');
    await host.terminal.screen.waitForText('No answer was invented.', {
      timeoutMs: 5000,
    });
    const result = Schema.decodeUnknownSync(Snapshot)(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    expect(sawExpiry).toBe(true);
    expect(result.tasks[0]?.declaration).toBe('unable');
    const question = result.messages.find(
      message => message.kind === 'question',
    );
    if (!question) throw new Error('Question record is missing.');
    const callsBeforeReply = requests;
    expect(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'reply',
          questionId: question.id,
          text: 'Use /v2.',
        }),
      ),
    ).toContain('"late":true');
    const later = Schema.decodeUnknownSync(Snapshot)(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    expect(requests).toBe(callsBeforeReply);
    expect(later.tasks).toHaveLength(1);
    expect(
      later.messages.find(message => message.kind === 'reply')?.consumedAt,
    ).toBeNull();
  } finally {
    await host.close();
  }
}, 30000);

test('cancellation before final delivery blocks dependents while a late cancellation cannot rewrite a saved result', async () => {
  const finishing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let dependentRan = false;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    async request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      const prompt = JSON.stringify(
        request.messages.find(message => message.role === 'user')?.content,
      );
      if (prompt.includes('MUST_STAY_SKIPPED')) dependentRan = true;
      if (request.messages.at(-1)?.role === 'tool') {
        if (prompt.includes('CANCEL_BEFORE_DELIVERY')) {
          finishing.resolve();
          await release.promise;
        }
        return {text: 'Final response.'};
      }
      return {
        tool: 'subagent',
        arguments:
          '{"command":"finish","outcome":"fulfilled","text":"Declared result."}',
      };
    },
  );
  try {
    const first = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              key: 'upstream',
              name: 'upstream',
              prompt: 'CANCEL_BEFORE_DELIVERY',
              workspace: 'live',
            },
            {
              name: 'dependent',
              prompt: 'MUST_STAY_SKIPPED',
              workspace: 'live',
              needs: ['upstream'],
            },
          ],
        }),
      ),
    );
    await finishing.promise;
    const cancelled = await host.invoke(
      'subagent',
      JSON.stringify({command: 'cancel', taskId: first.tasks[0]?.taskId}),
    );
    expect(cancelled).toContain('cancell');
    release.resolve();
    await host.invoke('subagent', '{"command":"wait","timeoutMs":5000}');
    const afterCancel = Schema.decodeUnknownSync(Snapshot)(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    expect(
      afterCancel.tasks.find(task => task.id === first.tasks[0]?.taskId)
        ?.outcome,
    ).toBe('cancelled');
    expect(
      afterCancel.tasks.find(task => task.id === first.tasks[0]?.taskId)
        ?.declaration,
    ).toBe('fulfilled');
    expect(
      afterCancel.tasks.find(task => task.id === first.tasks[1]?.taskId)
        ?.outcome,
    ).toBe('skipped');
    expect(dependentRan).toBe(false);

    const completed = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        '{"command":"dispatch","tasks":[{"name":"completed","prompt":"DELIVER_BEFORE_CANCEL","workspace":"live"}]}',
      ),
    );
    const taskId = completed.tasks[0]?.taskId;
    await host.invoke(
      'subagent',
      JSON.stringify({command: 'wait', taskId, timeoutMs: 5000}),
    );
    expect(
      await host.invoke(
        'subagent',
        JSON.stringify({command: 'cancel', taskId}),
      ),
    ).toContain('already-ended');
    const acceptance = await host.invoke(
      'subagent',
      JSON.stringify({command: 'accept', taskId, accepted: false}),
    );
    expect(acceptance).toContain('"status":"accepted"');
    const final = await host.invoke(
      'subagent',
      JSON.stringify({command: 'inspect', taskId}),
    );
    expect(final).toContain('"outcome":"fulfilled"');
    expect(final).toContain('"declaration":"fulfilled"');
    expect(final).toContain('"acceptance":false');
    expect(final).toContain('"durability":"saved"');
  } finally {
    release.resolve();
    await host.close();
  }
}, 30000);
