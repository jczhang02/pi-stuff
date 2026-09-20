import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';

test('80x24 targeted editor keeps its native cursor, multiline input and submit prompt', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    async request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      if (request.messages.at(-1)?.role === 'tool') return {text: 'Delivered.'};
      const lastContent =
        JSON.stringify(request.messages.at(-1)?.content) ?? '';
      if (!lastContent.includes('VIEWPORT_ASSIGNMENT')) return undefined;
      return {
        tool: 'subagent',
        arguments: JSON.stringify({
          command: 'finish',
          outcome: 'fulfilled',
          text: 'Viewport assignment complete.',
        }),
      };
    },
  );
  try {
    await host.terminal.resize({cols: 80, rows: 24});
    const description =
      'TARGET_SUMMARY_START ' +
      'long summary '.repeat(80) +
      ' TARGET_SUMMARY_END';
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {
            name: 'viewport-child',
            description,
            prompt: 'VIEWPORT_ASSIGNMENT',
            workspace: 'live',
          },
        ],
      }),
    );
    await host.invoke('subagent', '{"command":"wait","timeoutMs":5000}');

    await host.command('/agents fleet');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.keyboard.type('j');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Agents / Actions', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 5000,
    });

    let screen = await host.terminal.screen.text();
    expect(screen).toContain('TARGET_SUMMARY_START');
    expect(screen).not.toContain('TARGET_SUMMARY_END');
    expect(screen).toContain('Enter submit');

    await host.terminal.keyboard.type('udq');
    await host.terminal.screen.waitForText('udq', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('Targeted action');

    await host.terminal.keyboard.press('Control+J');
    await host.terminal.keyboard.type('SECOND_LINE');
    await host.terminal.keyboard.press('ArrowLeft');
    await host.terminal.keyboard.type('X');
    await host.terminal.screen.waitForText('SECOND_LINXE', {
      timeoutMs: 5000,
    });
    screen = await host.terminal.screen.text();
    expect(screen).toContain('Enter submit');
    expect(screen).toContain('Targeted action');
  } finally {
    await host.close();
  }
}, 30000);

test('targeted editor keeps cursor and multiline input at supported heights', async () => {
  for (const rows of [12, 14, 16, 24]) {
    const host = await launchPi(
      '{}',
      undefined,
      'subagent',
      'fullscreen',
      async request => {
        const history = JSON.stringify(request.messages);
        if (!history.includes('HEIGHT_ASSIGNMENT')) return undefined;
        if (request.messages.at(-1)?.role === 'tool')
          return {text: 'Delivered.'};
        const lastContent =
          JSON.stringify(request.messages.at(-1)?.content) ?? '';
        if (!lastContent.includes('HEIGHT_ASSIGNMENT')) return undefined;
        return {
          tool: 'subagent',
          arguments: JSON.stringify({
            command: 'finish',
            outcome: 'fulfilled',
            text: 'Height assignment complete.',
          }),
        };
      },
    );
    try {
      await host.terminal.resize({cols: 80, rows});
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'height-child',
              prompt: 'HEIGHT_ASSIGNMENT',
              workspace: 'live',
            },
          ],
        }),
      );
      await host.command('/agents fleet');
      await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
      await host.terminal.keyboard.type('j');
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText('Prompt', {timeoutMs: 5000});
      await host.terminal.keyboard.type('a');
      await host.terminal.screen.waitForText('Agents / Actions', {
        timeoutMs: 5000,
      });
      const actions = await host.terminal.screen.text();
      if (actions.includes('● Read full retained record'))
        await host.terminal.keyboard.press('ArrowUp');
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText('Targeted action', {
        timeoutMs: 5000,
      });
      expect(await host.terminal.screen.text()).toContain('Enter submit');

      await host.terminal.keyboard.type('udq');
      await host.terminal.screen.waitForText('udq', {timeoutMs: 5000});
      expect(await host.terminal.screen.text()).toContain('Targeted action');

      await host.terminal.keyboard.press('Control+J');
      await host.terminal.keyboard.type('SECOND_LINE');
      await host.terminal.keyboard.press('ArrowLeft');
      await host.terminal.keyboard.type('X');
      await host.terminal.screen.waitForText('SECOND_LINXE', {
        timeoutMs: 5000,
      });
      const screen = await host.terminal.screen.text();
      expect(screen).toContain('Enter submit');
      expect(screen).toContain('Targeted action');
    } finally {
      await host.close();
    }
  }
}, 90000);
