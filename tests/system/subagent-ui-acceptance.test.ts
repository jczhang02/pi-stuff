import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';

test('a populated dependency overview returns to main and allows actual host exit', async () => {
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
          '{"command":"finish","outcome":"fulfilled","text":"Reviewed cancellation without finding a write after exit."}',
      };
    },
  );
  try {
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {
            name: 'lifecycle',
            key: 'a',
            prompt: 'Trace cancellation.',
            workspace: 'live',
          },
          {
            name: 'packages',
            key: 'b',
            prompt: 'Inspect package behavior.',
            workspace: 'live',
          },
          {
            name: 'reviewer',
            needs: ['a', 'b'],
            prompt: 'Compare both findings.',
            workspace: 'live',
          },
        ],
      }),
    );
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await host.invoke(
        'subagent',
        '{"command":"wait","timeoutMs":5000}',
      );
      if (result.includes('"waitStatus":"settled"')) break;
    }
    await host.command('/agents');
    await host.terminal.screen.waitForText('Agents / Overview', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('dependency graph');
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      async screen => !screen.text.includes('Agents / Overview'),
      {timeoutMs: 5000},
    );
    await host.terminal.keyboard.press('Control+D');
    expect((await host.terminal.waitForExit({timeoutMs: 5000})).reason).toBe(
      'exited',
    );
  } catch (error) {
    console.error(await host.terminal.screen.text());
    console.error(await host.terminal.logs.text());
    throw error;
  } finally {
    await host.close();
  }
}, 30000);
