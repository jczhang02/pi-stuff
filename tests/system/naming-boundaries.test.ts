import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';
import {NamingProvider} from './fixtures/naming-provider';

test('output validation counts Unicode code points and refuses malformed names without repair requests', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({
      naming: {
        automatic: false,
        maxLength: 8,
        model: {provider: 'fixture', id: 'naming'},
      },
    }),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    for (const [index, title] of [
      '',
      'first\nsecond',
      'bad\u0007name',
      'bad\u202ename',
      '𠮷'.repeat(9),
    ].entries()) {
      await host.command(`/name Kept${index}`);
      await host.terminal.screen.waitForText(`Session name set: Kept${index}`, {
        timeoutMs: 4000,
      });
      provider.title = title;
      await host.command('/autoname Test name validation');
      await host.terminal.screen.waitUntil(
        async () =>
          provider.requests.length === index + 1 &&
          !(await host.terminal.screen.text()).includes('Naming...'),
        {timeoutMs: 4000},
      );
      await host.command('/name');
      await host.terminal.screen.waitForText(`Session name: Kept${index}`, {
        timeoutMs: 4000,
      });
    }
    provider.title = '  ' + '𠮷'.repeat(8) + '  ';
    await host.command('/autoname A custom eight character name');
    await host.terminal.screen.waitForText('Session named: ' + '𠮷'.repeat(8), {
      timeoutMs: 4000,
    });
    expect(provider.requests).toHaveLength(6);
  } finally {
    await host.close();
  }
}, 30000);

test('the current model is used when naming.model is absent', async () => {
  const provider = new NamingProvider('fixture');
  const host = await launchPi(
    '{"naming":{"automatic":false}}',
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.command('/autoname Research default model selection');
    await host.terminal.screen.waitForText('Session named:', {timeoutMs: 4000});
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.model).toBe('fixture');
  } finally {
    await host.close();
  }
}, 30000);

test('a missing configured model fails without falling back or rearming automation', async () => {
  const provider = new NamingProvider('fixture');
  const host = await launchPi(
    '{"naming":{"model":{"provider":"fixture","id":"missing"}}}',
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.command('/autoname Research missing models');
    await host.terminal.screen.waitForText('Naming failed: model unavailable', {
      timeoutMs: 4000,
    });
    expect(provider.requests).toHaveLength(0);
    await host.command('/name');
    await host.terminal.screen.waitForText('Usage: /name', {timeoutMs: 4000});
  } finally {
    await host.close();
  }
}, 30000);
