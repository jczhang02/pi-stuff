import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';
import {NamingProvider} from './fixtures/naming-provider';

test('a newer command supersedes pending work and a direct rename away and back wins', async () => {
  const provider = new NamingProvider();
  provider.held = true;
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.command('/autoname First request');
    await host.terminal.screen.waitUntil(() => provider.requests.length === 1, {
      timeoutMs: 4000,
    });
    expect(await host.terminal.screen.text()).not.toContain('Naming...');
    provider.title = 'research: Compare the current OAuth providers';
    provider.held = false;
    await host.command('/autoname Current request');
    await host.waitForName(provider.title);
    expect(provider.requests).toHaveLength(2);
    provider.held = true;
    await host.command('/autoname Obsolete third request');
    await host.terminal.screen.waitUntil(() => provider.requests.length === 3, {
      timeoutMs: 4000,
    });
    await host.command('/name Temporary');
    await host.terminal.screen.waitForText('Session name set: Temporary', {
      timeoutMs: 4000,
    });
    await host.command('/name research: Compare the current OAuth providers');
    await host.terminal.screen.waitForText(
      'Session name set: research: Compare the current OAuth providers',
      {timeoutMs: 4000},
    );
    provider.release();
    await host.invoke('', '{}');
    await host.command('/name');
    await host.terminal.screen.waitForText(
      'Session name: research: Compare the current OAuth providers',
      {timeoutMs: 4000},
    );
    expect(provider.requests).toHaveLength(3);
  } finally {
    provider.release();
    await host.close();
  }
}, 30000);

test('reload discards pending work and never rearms opening generation', async () => {
  const provider = new NamingProvider();
  provider.held = true;
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.command('/autoname Obsolete before reload');
    await host.terminal.screen.waitUntil(() => provider.requests.length === 1, {
      timeoutMs: 4000,
    });
    await host.reload();
    provider.release();
    await host.invoke('', '{}');
    await host.command('/name');
    await host.terminal.screen.waitForText('Usage: /name', {timeoutMs: 4000});
    expect(provider.requests).toHaveLength(1);
    expect(await host.terminal.screen.text()).not.toContain('Naming...');
  } finally {
    provider.release();
    await host.close();
  }
}, 30000);

test('tree navigation invalidates pending generation and keeps session-wide names', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({
      naming: {automatic: false, model: {provider: 'fixture', id: 'naming'}},
    }),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.invoke('', '{}');
    await host.command('/name Agreed task');
    await host.terminal.screen.waitForText('Session name set: Agreed task', {
      timeoutMs: 4000,
    });
    provider.held = true;
    await host.command('/autoname Obsolete task');
    await host.terminal.screen.waitUntil(() => provider.requests.length === 1, {
      timeoutMs: 4000,
    });
    await host.command('/host-tree');
    await host.terminal.screen.waitForText('HOST_TREE_READY', {
      timeoutMs: 4000,
    });
    provider.release();
    await host.terminal.screen.waitForText('Naming superseded', {
      timeoutMs: 4000,
    });
    await host.terminal.keyboard.press('Control+U');
    await host.command('/name');
    await host.terminal.screen.waitForText('Session name: Agreed task', {
      timeoutMs: 4000,
    });
    expect(provider.requests).toHaveLength(1);
  } catch (error) {
    console.error(await host.terminal.screen.text());
    console.error(await host.terminal.logs.text());
    throw error;
  } finally {
    provider.release();
    await host.close();
  }
}, 30000);
