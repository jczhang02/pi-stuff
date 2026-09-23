import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';
import {NamingProvider} from './fixtures/naming-provider';

test.each([
  ['empty', ''],
  ['multiline', 'first\nsecond'],
  ['control', 'bad\u0007name'],
  ['bidi control', 'bad\u202ename'],
  ['overlong Unicode', '𠮷'.repeat(9)],
] as const)(
  'output validation rejects %s names without repair requests',
  async (_label, title) => {
    const provider = new NamingProvider();
    provider.title = title;
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
      await host.command('/name Kept');
      await host.terminal.screen.waitForText('Session name set: Kept', {
        timeoutMs: 4000,
      });
      await host.command('/autoname Test name validation');
      await host.terminal.screen.waitForText('Naming failed: invalid name', {
        timeoutMs: 4000,
      });
      await host.command('/name');
      await host.terminal.screen.waitForText('Session name: Kept', {
        timeoutMs: 4000,
      });
      expect(provider.requests).toHaveLength(1);
    } finally {
      await host.close();
    }
  },
  30000,
);

test('output validation counts Unicode code points after trimming', async () => {
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
    provider.title = '  ' + '𠮷'.repeat(8) + '  ';
    await host.command('/autoname A custom eight character name');
    await host.waitForName(provider.title.trim());
    expect(provider.requests).toHaveLength(1);
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
    await host.waitForName(provider.title);
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
