import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import {launchPi} from './fixtures/pi-terminal';

const Admission = Schema.fromJsonString(
  Schema.Struct({
    tasks: Schema.Array(Schema.Struct({taskId: Schema.String})),
  }),
);
const Inspection = Schema.fromJsonString(
  Schema.Struct({
    tasks: Schema.Array(
      Schema.Struct({id: Schema.String, phase: Schema.String}),
    ),
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

test('reports wake main once and same-dispatch messages are consumed at the recipient next processing step', async () => {
  const identities = Promise.withResolvers<void>();
  const reported = Promise.withResolvers<void>();
  const sendMessage = Promise.withResolvers<void>();
  const messageSent = Promise.withResolvers<void>();
  const resumeRecipient = Promise.withResolvers<void>();
  let receiverId = '';
  let senderCalls = 0;
  let receiverCalls = 0;
  let receiverSawMessage = false;
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
      if (prompt.includes('COMMUNICATION_SENDER')) {
        senderCalls++;
        if (senderCalls === 1) {
          await identities.promise;
          return {
            tool: 'subagent',
            arguments:
              '{"command":"report","text":"Progress: authentication lookup found."}',
          };
        }
        if (senderCalls === 2) {
          reported.resolve();
          await sendMessage.promise;
          return {
            tool: 'subagent',
            arguments: JSON.stringify({
              command: 'message',
              taskId: receiverId,
              text: 'FIELD_CONVENTION: account_id is case-sensitive.',
            }),
          };
        }
        if (senderCalls === 3) {
          messageSent.resolve();
          return {
            tool: 'subagent',
            arguments:
              '{"command":"finish","outcome":"fulfilled","text":"Sent the convention."}',
          };
        }
        return {text: 'Sender delivered.'};
      }
      receiverCalls++;
      if (receiverCalls === 1) {
        await resumeRecipient.promise;
        return {tool: 'read', arguments: '{"path":"input.txt"}'};
      }
      receiverSawMessage ||= history.includes('FIELD_CONVENTION');
      if (receiverCalls === 2)
        return {
          tool: 'subagent',
          arguments:
            '{"command":"finish","outcome":"fulfilled","text":"Used the case-sensitive convention."}',
        };
      return {text: 'Receiver delivered.'};
    },
  );
  try {
    await writeFile(join(host.directory, 'input.txt'), 'Account_ID\n');
    const admission = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {name: 'sender', prompt: 'COMMUNICATION_SENDER', workspace: 'live'},
            {
              name: 'receiver',
              prompt: 'COMMUNICATION_RECEIVER',
              workspace: 'live',
            },
          ],
        }),
      ),
    );
    receiverId = admission.tasks[1]?.taskId ?? '';
    expect(receiverId).not.toBe('');
    identities.resolve();
    await reported.promise;
    const report = await host.invoke(
      'subagent',
      '{"command":"wait","timeoutMs":1000}',
    );
    expect(report).toContain('Progress: authentication lookup found.');
    expect(report).toContain('"waitStatus":"message"');
    const next = await host.invoke(
      'subagent',
      '{"command":"wait","timeoutMs":50}',
    );
    expect(next).toContain('"waitStatus":"expired"');
    sendMessage.resolve();
    await messageSent.promise;
    const before = Schema.decodeUnknownSync(Inspection)(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    expect(
      before.messages.find(message => message.kind === 'message')?.consumedAt,
    ).toBeNull();
    resumeRecipient.resolve();
    await host.invoke(
      'subagent',
      JSON.stringify({command: 'wait', taskId: receiverId, timeoutMs: 5000}),
    );
    const after = Schema.decodeUnknownSync(Inspection)(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    expect(after.tasks.find(task => task.id === receiverId)?.phase).toBe(
      'ended',
    );
    expect(receiverCalls).toBeGreaterThan(1);
    expect(receiverSawMessage).toBe(true);
    expect(
      after.messages.find(message => message.kind === 'message')?.consumedAt,
    ).toBeNumber();
    const calls = receiverCalls;
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'message',
        taskId: receiverId,
        text: 'LATE_INFORMATION_ONLY',
      }),
    );
    const late = Schema.decodeUnknownSync(Inspection)(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    expect(late.tasks).toHaveLength(2);
    expect(receiverCalls).toBe(calls);
    expect(
      late.messages.find(message => message.text === 'LATE_INFORMATION_ONLY')
        ?.consumedAt,
    ).toBeNull();
  } finally {
    identities.resolve();
    sendMessage.resolve();
    resumeRecipient.resolve();
    await host.close();
  }
}, 30000);
