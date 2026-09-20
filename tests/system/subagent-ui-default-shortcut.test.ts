import {expect, test} from 'bun:test';
import {configuredShortcut} from '../../src/subagent/ui/editor';
import {launchPi} from './fixtures/pi-terminal';

test('the default inspect shortcut uses the host-safe ctrl+q binding', () => {
  expect(configuredShortcut(undefined)).toBe('ctrl+q');
  expect(configuredShortcut('')).toBe('ctrl+q');
  expect(configuredShortcut('not-a-key')).toBe('ctrl+q');
});

test('the default inspect shortcut opens Fleet during a busy main draft', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let requests = 0;
  const host = await launchPi(
    '{}',
    undefined,
    'web',
    'fullscreen',
    async request => {
      if (!JSON.stringify(request.messages).includes('DEFAULT_BUSY_PROMPT'))
        return undefined;
      if (requests++ === 0) {
        started.resolve();
        await release.promise;
        return {text: 'default busy settled'};
      }
      return {text: 'default draft settled'};
    },
  );
  try {
    await host.terminal.screen.waitForText('Pi can explain', {
      timeoutMs: 15000,
    });
    await host.terminal.keyboard.type('DEFAULT_BUSY_PROMPT');
    await host.terminal.keyboard.press('Enter');
    await started.promise;
    await host.terminal.keyboard.type('DEFAULT_DRAFT_LINE');
    await host.terminal.keyboard.press('Control+Q');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('DEFAULT_DRAFT_LINE', {
      timeoutMs: 5000,
    });
    release.resolve();
    await host.terminal.screen.waitForText('default busy settled', {
      timeoutMs: 5000,
    });
  } finally {
    release.resolve();
    await host.close();
  }
}, 30000);

test('an explicit ctrl+r setting still reports its host conflict', async () => {
  const host = await launchPi(
    '{"subagent":{"inspectShortcut":"ctrl+r"}}',
    undefined,
    'web',
    'fullscreen',
  );
  try {
    await host.terminal.screen.waitForText('Pi can explain', {
      timeoutMs: 15000,
    });
    await host.command('/agents fleet');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.keyboard.type('?');
    await host.terminal.screen.waitForText('ctrl+r unavailable', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('app.session.rename');
  } finally {
    await host.close();
  }
}, 30000);
