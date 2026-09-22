import {expect, test} from 'bun:test';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {readdir, chmod, rename, symlink, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';
import {NamingProvider} from './fixtures/naming-provider';

test('a native write failure after preflight keeps Pi alive and explains session recovery', async () => {
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
  let file: string | undefined;
  let replaced = false;
  try {
    await host.invoke('', '{}');
    await host.command('/name Before');
    await host.terminal.screen.waitForText('Session name set: Before', {
      timeoutMs: 4000,
    });
    const files = (
      await readdir(join(host.directory, 'sessions'), {recursive: true})
    ).filter(path => path.endsWith('.jsonl'));
    file = join(host.directory, 'sessions', files[0] ?? '');
    const savedMessages =
      SessionManager.open(file).buildSessionContext().messages;
    await rename(file, file + '.backup');
    await symlink('/dev/full', file);
    replaced = true;
    await host.command('/autoname Test failed native write');
    await host.terminal.screen.waitForText(
      'Fix session file access and restart Pi',
      {timeoutMs: 4000},
    );
    expect((await host.terminal.status()).state).toBe('running');
    expect(await host.terminal.screen.text()).not.toContain('Naming...');
    await host.command('/name');
    await host.terminal.screen.waitForText(`Session name: ${provider.title}`, {
      timeoutMs: 4000,
    });
    await unlink(file);
    await rename(file + '.backup', file);
    replaced = false;
    const recovered = SessionManager.open(file);
    expect(recovered.buildSessionContext().messages).toEqual(savedMessages);
    for (const entry of recovered.getBranch()) {
      if (entry.parentId)
        expect(recovered.getEntry(entry.parentId)).toBeDefined();
    }
    await host.restart(['--session', file]);
    await host.command('/name');
    await host.terminal.screen.waitForText('Session name: Before', {
      timeoutMs: 4000,
    });
    await host.invoke('', '{}');
  } finally {
    if (replaced && file) {
      await unlink(file);
      await rename(file + '.backup', file);
    }
    await host.close();
  }
}, 30000);

test.each(['json', 'text'])(
  'an explicit %s print command completes and persists before exit',
  async mode => {
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
      await host.command('/name Before');
      await host.terminal.screen.waitForText('Session name set: Before', {
        timeoutMs: 4000,
      });
      const files = (
        await readdir(join(host.directory, 'sessions'), {recursive: true})
      ).filter(path => path.endsWith('.jsonl'));
      const file = join(host.directory, 'sessions', files[0] ?? '');
      await host.restart(
        [
          '--session',
          file,
          '--mode',
          mode,
          '-p',
          '/autoname Research one-shot commands',
        ],
        false,
      );
      const exit = await host.terminal.waitForExit({timeoutMs: 18000});
      expect(exit.reason).toBe('exited');
      if (exit.reason === 'exited') expect(exit.exit.code).toBe(0);
      expect(provider.requests).toHaveLength(1);
      expect(await host.terminal.logs.text()).not.toContain('Session named:');
      await host.restart(['--session', file]);
      await host.command('/name');
      await host.terminal.screen.waitForText(
        'Session name: research: Investigate RTK command output',
        {timeoutMs: 4000},
      );
    } finally {
      await host.close();
    }
  },
  30000,
);

test('a read-only session file rejects naming without crashing or changing the recoverable name', async () => {
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
  let file: string | undefined;
  try {
    await host.invoke('', '{}');
    await host.command('/name Before');
    await host.terminal.screen.waitForText('Session name set: Before', {
      timeoutMs: 4000,
    });
    const files = (
      await readdir(join(host.directory, 'sessions'), {recursive: true})
    ).filter(path => path.endsWith('.jsonl'));
    file = join(host.directory, 'sessions', files[0] ?? '');
    await chmod(file, 0o444);
    await host.command('/autoname Test storage failure');
    await host.terminal.screen.waitForText('Naming could not be saved', {
      timeoutMs: 4000,
    });
    expect((await host.terminal.status()).state).toBe('running');
    expect(await host.terminal.screen.text()).not.toContain('Naming...');
    await host.command('/name');
    await host.terminal.screen.waitForText('Session name: Before', {
      timeoutMs: 4000,
    });
    await chmod(file, 0o600);
    await host.invoke('', '{}');
    await host.restart(['--session', file]);
    await host.command('/name');
    await host.terminal.screen.waitForText('Session name: Before', {
      timeoutMs: 4000,
    });
    await host.invoke('', '{}');
    expect(provider.requests).toHaveLength(1);
  } finally {
    if (file) await chmod(file, 0o600);
    await host.close();
  }
}, 30000);

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
    await host.terminal.screen.waitForText('Name not saved yet.', {
      timeoutMs: 4000,
    });
    expect(
      await readdir(join(host.directory, 'sessions'), {recursive: true}),
    ).toHaveLength(0);
    await host.restart([]);
    await host.command('/name');
    await host.terminal.screen.waitForText('Usage: /name', {timeoutMs: 4000});
    await host.command('/autoname Research persistence');
    await host.terminal.screen.waitForText('Name not saved yet.', {
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
