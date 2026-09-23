import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';
import {NamingProvider} from './fixtures/naming-provider';
import {
  openNamingSettings,
  backToNamingHome,
  closeNamingHome,
  namingConfiguration,
} from './naming-panel-helpers';

const configured = {
  naming: {automatic: false, model: {provider: 'fixture', id: 'naming'}},
};

function height(screen: string) {
  const lines = screen.split('\n');
  const title = lines.findIndex(line =>
    line.trimStart().startsWith('AutoName'),
  );
  const bottom = lines.findIndex(
    (line, i) => i > title && line.startsWith('─'),
  );
  expect(title).toBeGreaterThan(0);
  expect(bottom).toBeGreaterThan(title);
  return bottom - title;
}

test.each(['light', 'dark'])(
  'naming remains usable at minimum size in the %s theme, with native settings and full long names',
  async theme => {
    const name =
      'research: ' +
      'Investigate OAuth provider behavior '.repeat(7) +
      'END_OF_TASK';
    const host = await launchPi(JSON.stringify(configured));
    try {
      await writeFile(
        join(host.agent, 'settings.json'),
        JSON.stringify({theme}),
      );
      await host.restart([]);
      await host.command('/name ' + name);
      await host.waitForName(name);
      await host.terminal.resize({cols: 56, rows: 24});
      await host.command('/autoname panel');
      await host.terminal.screen.waitForText('Current name', {timeoutMs: 4000});
      expect(await host.terminal.screen.text()).toContain('Not saved yet');
      const firstHeight = height(await host.terminal.screen.text());
      await host.terminal.keyboard.type(']');
      await host.terminal.screen.waitForText('END_OF_TASK', {timeoutMs: 4000});
      expect(height(await host.terminal.screen.text())).toBe(firstHeight);
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText('AutoName / Settings', {
        timeoutMs: 4000,
      });
      for (let i = 0; i < 4; i++) {
        await host.terminal.keyboard.press('ArrowDown');
        expect(await host.terminal.screen.text()).toContain(
          'AutoName / Settings',
        );
      }
      await host.terminal.resize({cols: 45, rows: 20});
      await host.terminal.screen.waitForText('AutoName needs more room', {
        timeoutMs: 4000,
      });
      expect(await host.terminal.screen.text()).toContain(
        'escape/ctrl+c close',
      );
      await host.terminal.resize({cols: 100, rows: 30});
      await host.terminal.screen.waitForText('Automatic naming', {
        timeoutMs: 4000,
      });
      await backToNamingHome(host);
      await closeNamingHome(host);
      await host.invoke('', '{}');
    } finally {
      await host.close();
    }
  },
  30000,
);

test('model search supports substrings, no matches, full long identifiers and current-model reset', async () => {
  const modelId = 'deployment-' + 'customer-region-'.repeat(9) + 'MODEL_END';
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: modelId}}}),
  );
  try {
    await host.terminal.resize({cols: 56, rows: 24});
    await openNamingSettings(host);
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Search models', {timeoutMs: 4000});
    expect(await host.terminal.screen.text()).toContain('deployment-');
    await host.terminal.screen.waitForText('MODEL_END', {timeoutMs: 4000});
    await host.terminal.keyboard.type('missing-match');
    await host.terminal.screen.waitForText('No matching settings', {
      timeoutMs: 4000,
    });
    await host.terminal.keyboard.press('Control+U');
    await host.terminal.keyboard.type('naming');
    await host.terminal.screen.waitForText('fixture/naming', {timeoutMs: 4000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Automatic naming', {
      timeoutMs: 4000,
    });
    expect((await namingConfiguration(host)).naming?.model).toEqual({
      provider: 'fixture',
      id: 'naming',
    });
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Search models', {timeoutMs: 4000});
    await host.terminal.keyboard.type('current session');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Automatic naming', {
      timeoutMs: 4000,
    });
    expect((await namingConfiguration(host)).naming?.model).toBeUndefined();
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await host.close();
  }
}, 30000);

test.each([false, true])(
  'native cancellation returns through settings and editors; remapped: %s',
  async remapped => {
    const host = await launchPi(JSON.stringify(configured));
    const cancel = remapped ? 'Control+G' : 'Control+C';
    try {
      if (remapped) {
        await writeFile(
          join(host.agent, 'keybindings.json'),
          JSON.stringify({'tui.select.cancel': 'ctrl+g'}),
        );
        await host.reload();
      }
      await openNamingSettings(host);
      await host.terminal.keyboard.type('rules');
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText('external editor', {
        timeoutMs: 4000,
      });
      await host.terminal.keyboard.press(cancel);
      await host.terminal.screen.waitForText('AutoName / Settings', {
        timeoutMs: 4000,
      });
      expect((await namingConfiguration(host)).naming?.prompt).toBeUndefined();
      await host.terminal.keyboard.press(cancel);
      await host.terminal.screen.waitForText('Current name', {timeoutMs: 4000});
      await host.terminal.keyboard.press(cancel);
      await host.terminal.screen.waitUntil(
        screen => !screen.text.includes('Generate name'),
        {timeoutMs: 4000},
      );
      await host.invoke('', '{}');
      await host.command('/autoname panel');
      await host.terminal.screen.waitForText('Current name', {timeoutMs: 4000});
      await host.terminal.resize({cols: 20, rows: 12});
      await host.terminal.screen.waitForText('AutoName needs more', {
        timeoutMs: 4000,
      });
      await host.terminal.keyboard.press(cancel);
      await host.terminal.screen.waitUntil(
        screen => !screen.text.includes('AutoName needs more'),
        {timeoutMs: 4000},
      );
    } finally {
      await host.close();
    }
  },
  30000,
);

test('panel applies a name immediately and refreshes unsaved status when the first assistant reply persists', async () => {
  const provider = new NamingProvider();
  let mainStarted = false;
  let release: (() => void) | undefined;
  const host = await launchPi(
    JSON.stringify(configured),
    undefined,
    'rtk',
    'fullscreen',
    async (body, signal) => {
      if (body.model === 'fixture') {
        mainStarted = true;
        await new Promise<void>(resolve => {
          release = resolve;
          signal.addEventListener('abort', resolve.bind(null, undefined), {
            once: true,
          });
        });
      }
      return provider.reply(body, signal);
    },
  );
  try {
    await host.start('', '{}');
    await host.terminal.screen.waitUntil(() => mainStarted, {timeoutMs: 4000});
    await host.command('/autoname panel');
    await host.terminal.screen.waitForText('Generate name', {timeoutMs: 4000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.waitForName(provider.title);
    await host.terminal.screen.waitForText(provider.title, {timeoutMs: 4000});
    expect(await host.terminal.screen.text({settleMs: 0})).toContain(
      provider.title,
    );
    expect(await host.terminal.screen.text({settleMs: 0})).toContain(
      'Not saved yet',
    );
    expect(await host.terminal.logs.text()).toContain('Name not saved yet.');
    const unsaved = (await host.terminal.screen.text({settleMs: 0})).split(
      '\n',
    );
    const name = unsaved.findIndex(line => line.trim() === provider.title);
    expect(name).toBeGreaterThan(0);
    expect(unsaved[name + 1]?.trim()).toBe('Not saved yet');
    expect(unsaved[name + 2]?.trim()).toBe(
      'Saved with the first assistant reply.',
    );
    expect(unsaved[name + 3]).toBe('');
    expect(unsaved[name + 4]).toMatch(/^  Settings/u);
    release?.();
    await host.terminal.screen.waitUntil(
      screen => !screen.text.includes('Not saved yet'),
      {timeoutMs: 4000},
    );
    const saved = (await host.terminal.screen.text()).split('\n');
    const savedName = saved.findIndex(line => line.trim() === provider.title);
    expect(savedName).toBeGreaterThan(0);
    expect(saved[savedName + 1]).toBe('');
    expect(saved[savedName + 2]).toMatch(/^  Settings/u);
    await closeNamingHome(host);
    await host.command('/name');
    await host.terminal.screen.waitForText(`Session name: ${provider.title}`, {
      timeoutMs: 4000,
    });
    expect(provider.requests).toHaveLength(1);
  } finally {
    release?.();
    await host.close();
  }
}, 30000);

test('individual defaults and canceled edits preserve other naming fields', async () => {
  const host = await launchPi(
    JSON.stringify({
      naming: {
        ...configured.naming,
        prompt: 'Custom OAuth rule',
        maxLength: 40,
      },
    }),
  );
  try {
    await openNamingSettings(host);
    await host.terminal.keyboard.type('length');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Maximum length (current: 40)', {
      timeoutMs: 4000,
    });
    await host.terminal.keyboard.type('12');
    await host.terminal.keyboard.press('Control+C');
    await host.terminal.screen.waitForText('AutoName / Settings', {
      timeoutMs: 4000,
    });
    expect((await namingConfiguration(host)).naming?.maxLength).toBe(40);
    await host.terminal.keyboard.press('Control+U');
    await host.terminal.keyboard.type('Restore');
    for (const [choice, field] of [
      ['Naming rules only', 'prompt'],
      ['Maximum length only', 'maxLength'],
    ] as const) {
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText('All naming settings', {
        timeoutMs: 4000,
      });
      await host.terminal.keyboard.press('ArrowDown');
      if (field === 'maxLength')
        await host.terminal.keyboard.press('ArrowDown');
      expect(await host.terminal.screen.text()).toContain(choice);
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText('Restore naming defaults?', {
        timeoutMs: 4000,
      });
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText('AutoName / Settings', {
        timeoutMs: 4000,
      });
      expect((await namingConfiguration(host)).naming?.[field]).toBeUndefined();
      if (field === 'prompt')
        expect((await namingConfiguration(host)).naming?.maxLength).toBe(40);
    }
    expect((await namingConfiguration(host)).naming).toEqual(configured.naming);
  } finally {
    await host.close();
  }
}, 30000);
