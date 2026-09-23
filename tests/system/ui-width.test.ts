import {expect, test} from 'bun:test';
import {resolve} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Bash and retrieval gutters fit combining characters at narrow component widths', async () => {
  const host = await launchPi(
    '{}',
    resolve('tests/system/fixtures/ui-width.ts'),
    'ui',
  );
  try {
    for (const theme of ['dark', 'light']) {
      await host.command(`/host-theme ${theme}`);
      await host.terminal.screen.waitForText(`HOST_THEME:${theme}`, {
        timeoutMs: 5000,
      });
      await host.command(`/check-result-width ${theme}`);
      await host.terminal.screen.waitForText(
        new RegExp(`${theme}:WIDTH_(OK|FAIL)`, 'u'),
        {
          timeoutMs: 5000,
        },
      );
      expect(await host.terminal.screen.text()).not.toContain('WIDTH_FAIL');
      expect(await host.terminal.screen.text()).toContain(`${theme}:WIDTH_OK`);
    }
  } finally {
    await host.close();
  }
}, 30000);
