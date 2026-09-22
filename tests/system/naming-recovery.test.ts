import {expect, test} from 'bun:test';
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';
import {NamingProvider} from './fixtures/naming-provider';

test('a blank-session name reports delayed persistence and survives restart after a real exchange', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.command('/autoname Research persistence');
    await host.terminal.screen.waitForText('Unsaved session', {
      timeoutMs: 4000,
    });
    expect(
      await readdir(join(host.directory, 'sessions'), {recursive: true}),
    ).toHaveLength(0);
    await host.restart([]);
    await host.command('/name');
    await host.terminal.screen.waitForText('Usage: /name', {timeoutMs: 4000});
    await host.command('/autoname Research persistence');
    await host.terminal.screen.waitForText('Unsaved session', {
      timeoutMs: 4000,
    });
    await host.invoke('', '{}');
    const files = (
      await readdir(join(host.directory, 'sessions'), {recursive: true})
    ).filter(file => file.endsWith('.jsonl'));
    expect(files).toHaveLength(1);
    await host.restart([
      '--session',
      join(host.directory, 'sessions', files[0] ?? ''),
    ]);
    await host.command('/name');
    await host.terminal.screen.waitForText(
      'Session name: research: Investigate RTK command output',
      {timeoutMs: 4000},
    );
    await host.invoke('', '{}');
    expect(provider.requests).toHaveLength(2);
  } finally {
    await host.close();
  }
}, 30000);
