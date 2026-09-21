import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {launchPi} from './fixtures/pi-terminal';

const Run = Schema.Struct({
  id: Schema.String,
  tasks: Schema.Array(Schema.Struct({id: Schema.String})),
});

test('Info and retained request history are readable without triggering current actions', async () => {
  let calls = 0;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      if (request.tools?.some(tool => tool.function.name === 'subagent'))
        return undefined;
      calls += 1;
      return {
        type: 'content',
        content:
          calls === 1
            ? 'FIRST_REPORT retained finding'
            : 'SECOND_REPORT revised finding',
        usage: {input: 11, output: 7},
      };
    },
  );
  try {
    const run = Schema.decodeUnknownSync(Run)(
      JSON.parse(
        await host.invoke(
          'subagent',
          JSON.stringify({
            command: 'dispatch',
            agent: 'reviewer',
            task: 'Initial cancellation review',
            autoAwait: true,
            notifyPerTask: false,
          }),
        ),
      ),
    );
    const task = run.tasks[0];
    if (!task) throw new Error('Missing child.');
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'follow-up',
        runId: run.id,
        taskId: task.id,
        message: 'Recheck the cancellation fix',
        autoAwait: true,
      }),
    );
    await host.terminal.keyboard.type('Keep main draft');
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● main', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● reviewer', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type('i');
    await host.terminal.screen.waitForText('Effective configuration', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('h history');
    await host.terminal.keyboard.type('h');
    await host.terminal.screen.waitForText('Request history', {
      timeoutMs: 5000,
    });
    const history = await host.terminal.screen.text();
    expect(history).toContain('Initial cancellation review');
    expect(history).toContain('Recheck the cancellation fix');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Retained request', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('FIRST_REPORT');
    await host.terminal.keyboard.type('t');
    await host.terminal.screen.waitForText('reviewer · Transcript', {
      timeoutMs: 5000,
    });
    await host.terminal.screen.waitForText('FIRST_REPORT', {timeoutMs: 5000});
    const transcript =
      (await host.terminal.screen.text())
        .split('reviewer · Transcript')
        .at(-1) ?? '';
    expect(transcript).toContain('FIRST_REPORT');
    expect(transcript).not.toContain('SECOND_REPORT');
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Retained request', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('mx');
    expect(await host.terminal.screen.text()).not.toContain(
      'Follow-up reviewer',
    );
    expect(calls).toBe(2);
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Request history', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Retained request', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('SECOND_REPORT');
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Request history', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Effective configuration', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('● reviewer', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('Keep main draft');
  } finally {
    await host.close();
  }
}, 60000);
