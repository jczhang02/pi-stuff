import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';
import {NamingProvider} from './fixtures/naming-provider';

test('a cancelled opening is never named on a later successful turn', async () => {
  const provider = new NamingProvider();
  let started = false;
  let release: (() => void) | undefined;
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    async (body, signal) => {
      if (body.model === 'fixture' && !started) {
        started = true;
        await new Promise<void>(resolve => {
          release = resolve;
          signal.addEventListener('abort', () => resolve(), {once: true});
        });
      }
      return provider.reply(body, signal);
    },
  );
  try {
    await host.start('', '{}');
    await host.terminal.screen.waitUntil(() => started, {timeoutMs: 4000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Operation aborted', {
      timeoutMs: 4000,
    });
    release?.();
    await host.invoke('', '{}');
    await host.command('/name');
    await host.terminal.screen.waitForText('Usage: /name', {timeoutMs: 4000});
    expect(provider.requests).toHaveLength(0);
  } finally {
    release?.();
    await host.close();
  }
}, 30000);

test('queued separate user input cannot contaminate the opening snapshot', async () => {
  const provider = new NamingProvider();
  let started = false;
  let release: (() => void) | undefined;
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    async (body, signal) => {
      if (body.model === 'fixture' && !started) {
        started = true;
        await new Promise<void>(resolve => {
          release = resolve;
          signal.addEventListener('abort', () => resolve(), {once: true});
        });
      }
      return provider.reply(body, signal);
    },
  );
  try {
    await host.start('', '{}');
    await host.terminal.screen.waitUntil(() => started, {timeoutMs: 4000});
    await host.command('A separate task queued during the first response');
    await host.terminal.screen.waitForText('A separate task queued', {
      timeoutMs: 4000,
    });
    release?.();
    await host.terminal.screen.waitForText('RTK_TURN_1_DONE', {
      timeoutMs: 4000,
    });
    await host.command('/name');
    await host.terminal.screen.waitForText('Usage: /name', {timeoutMs: 4000});
    expect(provider.requests).toHaveLength(0);
  } finally {
    release?.();
    await host.close();
  }
}, 30000);

test.each(['before', 'at'])(
  'a native fork %s the first user entry never receives an automatic name',
  async position => {
    const provider = new NamingProvider();
    const host = await launchPi(
      JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
      undefined,
      'rtk',
      'fullscreen',
      provider.reply,
    );
    try {
      if (position === 'before') {
        provider.title = '';
        await host.command('/autoname Deliberately invalid opening name');
        await host.terminal.screen.waitForText('Naming failed: invalid name', {
          timeoutMs: 4000,
        });
        provider.title = 'research: Investigate RTK command output';
      } else {
        await host.command('/name Parent task');
        await host.terminal.screen.waitForText(
          'Session name set: Parent task',
          {timeoutMs: 4000},
        );
      }
      const previousRequests = provider.requests.length;
      await host.invoke('', '{}');
      await host.command(`/host-fork ${position}`);
      await host.terminal.screen.waitForText('Forked to new session', {
        timeoutMs: 4000,
      });
      await host.terminal.keyboard.press('Control+U');
      await host.invoke('', '{}');
      expect(provider.requests).toHaveLength(previousRequests);
      await host.command('/autoname Research the fork');
      await host.waitForName(provider.title);
      expect(provider.requests).toHaveLength(previousRequests + 1);
    } finally {
      await host.close();
    }
  },
  30000,
);

test('switching to a new session rejects the old result and permits its own opening name', async () => {
  const provider = new NamingProvider();
  provider.held = true;
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'regular',
    provider.reply,
  );
  try {
    await host.command('/autoname Old session');
    await host.terminal.screen.waitUntil(() => provider.requests.length === 1, {
      timeoutMs: 4000,
    });
    await host.command('/new');
    await host.terminal.screen.waitForText('New session started', {
      timeoutMs: 4000,
    });
    provider.release();
    await host.invoke('', '{}');
    await host.terminal.screen.waitUntil(() => provider.requests.length === 2, {
      timeoutMs: 4000,
    });
    await host.command('/name');
    await host.terminal.screen.waitForText(
      'Session name: research: Investigate RTK command output',
      {timeoutMs: 4000},
    );
    await host.invoke('', '{}');
    expect(provider.requests).toHaveLength(2);
  } finally {
    provider.release();
    await host.close();
  }
}, 30000);
