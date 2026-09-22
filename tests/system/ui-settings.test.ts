import {expect, test} from 'bun:test';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('UI settings are available when disabled, preserve other sections and reject stale saves', async () => {
  const host = await launchPi(
    '{"rtk":{"rewrite":false},"ui":{"enabled":false}}',
  );
  try {
    await host.command('/ui');
    await host.terminal.screen.waitForText('Conversation UI settings', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Saved. /reload to apply.', {
      timeoutMs: 5000,
    });
    const path = join(host.agent, 'pi-stuff.json');
    expect(await readFile(path, 'utf8')).toContain('"enabled": true');
    expect(await readFile(path, 'utf8')).toContain('"rewrite": false');
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitUntil(
      async () =>
        (await readFile(path, 'utf8')).includes('"writePreviewLines": 6'),
      {timeoutMs: 5000},
    );
    const external = '{"rtk":{"rewrite":false},"ui":{"writePreviewLines":7}}\n';
    await writeFile(path, external);
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Settings changed on disk', {
      timeoutMs: 5000,
    });
    expect(await readFile(path, 'utf8')).toBe(external);
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      async () =>
        !(await host.terminal.screen.text()).includes(
          'Conversation UI settings',
        ),
      {timeoutMs: 5000},
    );
    await host.invoke('bash', JSON.stringify({command: 'printf AFTER_UI'}));
    expect(await host.terminal.screen.text()).toContain('RTK_TURN_1_DONE');
  } finally {
    await host.close();
  }
}, 30000);
