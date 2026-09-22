import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';
import {NamingProvider} from './fixtures/naming-provider';

test('empty explicit input makes no request and consumes opening automation', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({
      naming: {model: {provider: 'fixture', id: 'naming'}},
    }),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.command('/autoname');
    await host.terminal.screen.waitForText('Add a task hint', {
      timeoutMs: 4000,
    });
    expect(provider.requests).toHaveLength(0);
    await host.invoke('', '{}');
    expect(provider.requests).toHaveLength(0);
  } finally {
    await host.close();
  }
}, 30000);

test('saved names succeed silently and blank-session hints only report the unsaved state', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({
      naming: {
        automatic: false,
        model: {provider: 'fixture', id: 'naming'},
      },
    }),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.command('/autoname Research temporary names');
    await host.terminal.screen.waitForText('Name not saved yet.', {
      timeoutMs: 4000,
    });
    expect(await host.terminal.logs.text()).not.toContain('Session named:');
    expect(await host.terminal.logs.text()).not.toContain('persisted exchange');
    await host.invoke('', '{}');
    provider.title = 'fix: Preserve the saved session name';
    await host.command('/autoname Fix session naming');
    await host.terminal.screen.waitForText(provider.title, {timeoutMs: 4000});
    expect(provider.requests).toHaveLength(2);
    expect(await host.terminal.logs.text()).not.toContain('Session named:');
  } finally {
    await host.close();
  }
}, 30000);

test('the naming panel opens with session actions and editable settings', async () => {
  const host = await launchPi();
  try {
    await host.command('/naming');
    await host.terminal.screen.waitForText('Generate name', {
      timeoutMs: 4000,
    });
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Automatic naming', {
      timeoutMs: 4000,
    });
    expect(await host.terminal.screen.text()).toContain('Naming model');
    expect(await host.terminal.screen.text()).toContain('Naming rules');
    expect(await host.terminal.screen.text()).toContain('Maximum length');
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Current name', {timeoutMs: 4000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      async () =>
        !(await host.terminal.screen.text()).includes('Generate name'),
      {timeoutMs: 4000},
    );
    await host.invoke('', '{}');
  } finally {
    await host.close();
  }
}, 30000);
