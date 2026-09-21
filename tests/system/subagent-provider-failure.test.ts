import {expect, test} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {Schema} from 'effect';
import {parseSessionEntries} from '@earendil-works/pi-coding-agent';
import {launchPi} from './fixtures/pi-terminal';

const Run = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  tasks: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      status: Schema.String,
      error: Schema.optional(Schema.String),
      finalText: Schema.String,
      sessionFile: Schema.String,
      history: Schema.Array(
        Schema.Struct({
          status: Schema.String,
          error: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
});

test('a native provider error becomes a failed request and resumes in its retained session', async () => {
  let fail = true;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      if (request.tools?.some(tool => tool.function.name === 'subagent'))
        return undefined;
      return fail
        ? {type: 'error', message: 'PROVIDER_REJECTED_REQUEST'}
        : {type: 'content', content: 'PROVIDER_RECOVERED_REPORT'};
    },
  );
  try {
    const failed = Schema.decodeUnknownSync(Run)(
      JSON.parse(
        await host.invoke(
          'subagent',
          JSON.stringify({
            command: 'dispatch',
            agent: 'researcher',
            task: 'Exercise provider recovery',
            autoAwait: true,
            notifyPerTask: false,
          }),
        ),
      ),
    );
    const task = failed.tasks[0];
    if (!task) throw new Error('Missing child.');
    expect(failed.status).toBe('failed');
    expect(task.status).toBe('failed');
    expect(task.error).toContain('PROVIDER_REJECTED_REQUEST');
    const entries = parseSessionEntries(
      await readFile(task.sessionFile, 'utf8'),
    );
    const assistant = entries.findLast(
      entry => entry.type === 'message' && entry.message.role === 'assistant',
    );
    expect(
      assistant?.type === 'message' && assistant.message.role === 'assistant'
        ? assistant.message.stopReason
        : undefined,
    ).toBe('error');
    fail = false;
    const resumed = Schema.decodeUnknownSync(Run)(
      JSON.parse(
        await host.invoke(
          'subagent',
          JSON.stringify({
            command: 'resume',
            runId: failed.id,
            taskId: task.id,
            message: 'Continue after the provider recovered.',
            autoAwait: true,
          }),
        ),
      ),
    );
    expect(resumed.status).toBe('completed');
    expect(resumed.tasks[0]?.sessionFile).toBe(task.sessionFile);
    expect(resumed.tasks[0]?.finalText).toBe('PROVIDER_RECOVERED_REPORT');
    expect(resumed.tasks[0]?.history[0]?.status).toBe('failed');
    expect(resumed.tasks[0]?.history[0]?.error).toContain(
      'PROVIDER_REJECTED_REQUEST',
    );
  } finally {
    await host.close();
  }
}, 60000);
