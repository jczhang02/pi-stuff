import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';

test('a dependency graph opens child detail and preserves both return selections', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request =>
      request.tools?.some(tool => tool.function.name === 'subagent')
        ? undefined
        : {type: 'content', content: 'Dependency investigation finished.'},
  );
  try {
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {id: 'alpha', agent: 'alpha', task: 'Trace the lifecycle'},
          {
            id: 'beta',
            agent: 'beta',
            task: 'Inspect scheduling',
            needs: ['alpha'],
          },
          {
            id: 'gamma',
            agent: 'gamma',
            task: 'Inspect cancellation',
            needs: ['alpha'],
          },
          {
            id: 'review',
            agent: 'review',
            task: 'Compare both findings',
            needs: ['beta', 'gamma'],
          },
        ],
        autoAwait: true,
        notifyPerTask: false,
      }),
    );
    await host.terminal.keyboard.type('Preserve main draft');
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● main', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● alpha', {timeoutMs: 5000});
    await host.terminal.keyboard.type('g');
    await host.terminal.screen.waitForText('Dependencies · 1/4', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).not.toContain(
      'Preserve main draft',
    );
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('Dependencies · 2/4', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('beta · Done');
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Dependencies · 2/4', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('● beta');
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('● alpha', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('Preserve main draft');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type('g');
    await host.terminal.screen.waitForText('Dependencies · 1/4', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('alpha · Done');
  } finally {
    await host.close();
  }
}, 60000);
