import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {launchPi, type PiFixtureRequest} from './fixtures/pi-terminal';

const Result = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  tasks: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      status: Schema.String,
      finalText: Schema.String,
    }),
  ),
  intercom: Schema.Array(
    Schema.Struct({
      taskId: Schema.String,
      text: Schema.String,
      level: Schema.String,
    }),
  ),
});

function text(
  message: PiFixtureRequest['messages'][number] | undefined,
): string {
  const content = message?.content;
  return Schema.is(Schema.String)(content)
    ? content
    : (content?.map(part => part.text ?? '').join('') ?? '');
}

test('native siblings exchange a mailbox message, drain it, and recover from a tool error', async () => {
  const mailSent = Promise.withResolvers<void>();
  const observed: string[] = [];
  const rosters: string[] = [];
  let senderStep = 0;
  let receiverStep = 0;
  let invalidStep = 0;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    async request => {
      if (request.tools?.some(tool => tool.function.name === 'subagent'))
        return undefined;
      rosters.push(JSON.stringify(request.tools));
      const task = request.messages
        .filter(message => message.role === 'user')
        .map(text)
        .join('\n');
      const last = text(request.messages.at(-1));
      if (task.includes('SENDER_TASK')) {
        if (senderStep++ === 0)
          return {
            type: 'tool_call',
            name: 'notify_parent',
            arguments: JSON.stringify({
              message: 'NOTICE_EVIDENCE',
              level: 'warning',
            }),
          };
        observed.push(last);
        if (senderStep === 2)
          return {
            type: 'tool_call',
            name: 'send_agent_message',
            arguments: JSON.stringify({
              to: 'receiver',
              message: 'MAIL_EVIDENCE',
            }),
          };
        mailSent.resolve();
        return {type: 'content', content: 'SENDER_REPORT'};
      }
      if (task.includes('RECEIVER_TASK')) {
        await mailSent.promise;
        if (receiverStep++ > 0) observed.push(last);
        if (receiverStep <= 2)
          return {
            type: 'tool_call',
            name: 'poll_agent_messages',
            arguments: '{}',
          };
        return {type: 'content', content: 'RECEIVER_REPORT'};
      }
      if (invalidStep++ === 0)
        return {
          type: 'tool_call',
          name: 'send_agent_message',
          arguments: JSON.stringify({
            to: 'missing-sibling',
            message: 'not deliverable',
          }),
        };
      observed.push(last);
      return {type: 'content', content: 'INVALID_RECOVERED_REPORT'};
    },
  );
  try {
    let run = Schema.decodeUnknownSync(Result)(
      JSON.parse(
        await host.invoke(
          'subagent',
          JSON.stringify({
            command: 'dispatch',
            tasks: [
              {id: 'sender', agent: 'sender', task: 'SENDER_TASK'},
              {id: 'receiver', agent: 'receiver', task: 'RECEIVER_TASK'},
              {id: 'invalid', agent: 'invalid', task: 'INVALID_TASK'},
            ],
            concurrency: 3,
            autoAwait: true,
            notifyPerTask: false,
          }),
        ),
      ),
    );
    for (let attempt = 0; attempt < 5 && run.status === 'running'; attempt++)
      run = Schema.decodeUnknownSync(Result)(
        JSON.parse(
          await host.invoke(
            'subagent',
            JSON.stringify({command: 'wait', runId: run.id, timeoutMs: 5000}),
          ),
        ),
      );
    expect(rosters.some(roster => roster.includes('receiver (receiver)'))).toBe(
      true,
    );
    expect(rosters.some(roster => roster.includes('sender (sender)'))).toBe(
      true,
    );
    expect(run.status).toBe('completed');
    expect(run.tasks.every(task => task.status === 'completed')).toBe(true);
    expect(run.tasks.find(task => task.id === 'invalid')?.finalText).toBe(
      'INVALID_RECOVERED_REPORT',
    );
    expect(run.intercom).toEqual([
      {taskId: 'sender', text: 'NOTICE_EVIDENCE', level: 'warning'},
    ]);
    expect(observed).toContain('from sender: MAIL_EVIDENCE');
    expect(observed).toContain('No messages.');
    expect(
      observed.some(value =>
        value.includes('Unknown sibling: missing-sibling'),
      ),
    ).toBe(true);
    expect(observed.filter(value => value === 'Sent.')).toHaveLength(2);
  } finally {
    mailSent.resolve();
    await host.close();
  }
}, 60000);
