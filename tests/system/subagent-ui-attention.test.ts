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

test('attention reaches an earlier assignment and acknowledges its actionable notice', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      if (!JSON.stringify(request.messages).includes('SUBAGENT_ASSIGNMENT'))
        return undefined;
      if (request.messages.at(-1)?.role === 'tool') return {text: 'Delivered.'};
      return {
        tool: 'subagent',
        arguments:
          '{"command":"finish","outcome":"fulfilled","text":"Review complete."}',
      };
    },
  );
  try {
    const first = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        '{"command":"dispatch","tasks":[{"name":"reviewer","prompt":"Original review","workspace":"live"}]}',
      ),
    ).tasks[0];
    if (!first) throw new Error('Original review was not admitted.');
    await host.invoke(
      'subagent',
      JSON.stringify({command: 'wait', taskId: first.taskId, timeoutMs: 5000}),
    );
    const second = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'followup',
          agentId: first.agentId,
          text: 'Newer review',
        }),
      ),
    ).tasks[0];
    if (!second) throw new Error('Newer review was not admitted.');
    await host.invoke(
      'subagent',
      JSON.stringify({command: 'wait', taskId: second.taskId, timeoutMs: 5000}),
    );
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'message',
        taskId: first.taskId,
        text: 'Late information for the original review.',
      }),
    );

    await host.command('/agents fleet');
    await host.terminal.screen.waitForText(
      'j/k select · enter open · o overview',
      {timeoutMs: 5000},
    );
    expect(await host.terminal.screen.text()).toContain('1 attention');
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Toggle attention filter', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText(
      'Showing assignments that need attention.',
      {timeoutMs: 5000},
    );
    expect((await host.terminal.screen.text()).split('Fleet').at(-1)).toContain(
      'Original review',
    );
    await host.terminal.keyboard.type('j');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Agents / reviewer', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('Newer assignment');
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Acknowledge', {timeoutMs: 5000});
    const actionRows = (await host.terminal.screen.text())
      .split('\n')
      .filter(line => line.includes('● ') || line.includes('○ '));
    const current = actionRows.findIndex(line => line.includes('● '));
    const acknowledge = actionRows.findIndex(line =>
      line.includes('Acknowledge'),
    );
    expect(current).toBeGreaterThanOrEqual(0);
    expect(acknowledge).toBeGreaterThanOrEqual(current);
    await host.terminal.keyboard.type('j'.repeat(acknowledge - current));
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('acknowledge accepted.', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('q');
    await host.terminal.screen.waitForText('No subagents need attention.', {
      timeoutMs: 5000,
    });
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await host.close();
  }
}, 30000);
