import {expect, test} from 'bun:test';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';
import {NamingProvider} from './fixtures/naming-provider';

test('an existing empty session file is historical and never automatically named', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.invoke('', '{}');
    await host.terminal.screen.waitUntil(() => provider.requests.length === 1, {
      timeoutMs: 4000,
    });
    const files = (
      await readdir(join(host.directory, 'sessions'), {recursive: true})
    ).filter(file => file.endsWith('.jsonl'));
    const stored = await readFile(
      join(host.directory, 'sessions', files[0] ?? ''),
      'utf8',
    );
    const empty = join(host.directory, 'historical.jsonl');
    await writeFile(empty, stored.split('\n')[0] + '\n');
    await host.restart(['--session', empty]);
    await host.invoke('', '{}');
    await host.command('/name');
    await host.terminal.screen.waitForText('Usage: /name', {timeoutMs: 4000});
    expect(provider.requests).toHaveLength(1);
  } finally {
    await host.close();
  }
}, 30000);

test('nonpersistent TUI sessions only allow explicit generation', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'regular',
    provider.reply,
    ['--no-session'],
  );
  try {
    await host.invoke('', '{}');
    expect(provider.requests).toHaveLength(0);
    await host.command('/autoname Research temporary sessions');
    await host.terminal.screen.waitForText('Unsaved session', {
      timeoutMs: 4000,
    });
    expect(provider.requests).toHaveLength(1);
  } finally {
    await host.close();
  }
}, 30000);

test.each(['json', 'text'])(
  '%s print/background launches make no automatic naming request',
  async mode => {
    const provider = new NamingProvider();
    const host = await launchPi(
      JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
      undefined,
      'rtk',
      'regular',
      provider.reply,
    );
    try {
      await host.restart(
        ['--mode', mode, '-p', '--no-session', 'Research background naming'],
        false,
      );
      const exit = await host.terminal.waitForExit({timeoutMs: 15000});
      expect(exit.reason).toBe('exited');
      if (exit.reason === 'exited') expect(exit.exit.code).toBe(0);
      expect(await host.terminal.logs.text()).toContain('RTK_TURN_0_DONE');
      expect(provider.requests).toHaveLength(0);
    } finally {
      await host.close();
    }
  },
  30000,
);

test('RPC sessions skip automation but retain the explicit command', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'regular',
    provider.reply,
  );
  try {
    await host.restart(['--mode', 'rpc'], false);
    await host.terminal.keyboard.write(
      new TextEncoder().encode(
        JSON.stringify({
          id: 'opening',
          type: 'prompt',
          message: 'Research RPC naming',
        }) + '\n',
      ),
    );
    await host.terminal.screen.waitForText('agent_end', {timeoutMs: 8000});
    expect(provider.requests).toHaveLength(0);
    await host.terminal.keyboard.write(
      new TextEncoder().encode(
        JSON.stringify({
          id: 'naming',
          type: 'prompt',
          message: '/autoname Research RPC naming',
        }) + '\n',
      ),
    );
    await host.terminal.screen.waitUntil(() => provider.requests.length === 1, {
      timeoutMs: 4000,
    });
  } finally {
    await host.close();
  }
}, 30000);
