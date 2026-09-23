import {expect, test} from 'bun:test';
import {writeFile, unlink, readdir, rename, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';
import {
  openNamingSettings,
  backToNamingHome,
  closeNamingHome,
} from './naming-panel-helpers';

const rules =
  'Use a precise English task name.\nPreserve OAuth identifiers and user intent.';

async function beginReplacement(
  host: Awaited<ReturnType<typeof launchPi>>,
  action: string,
) {
  const command = `/${action}`;
  await host.terminal.keyboard.type(command);
  await host.terminal.screen.waitForText(command, {timeoutMs: 4000});
  await host.terminal.keyboard.press('Enter');
  await host.terminal.screen.waitUntil(
    screen => !screen.text.includes(command),
    {timeoutMs: 4000},
  );
}

async function finishReplacement(
  host: Awaited<ReturnType<typeof launchPi>>,
  action: string,
) {
  await host.terminal.screen.waitForText(
    action === 'new' ? 'New session started' : 'Reloaded keybindings',
    {timeoutMs: 4000},
  );
}

test('failed rules saves retain the complete editable draft', async () => {
  const host = await launchPi('{"naming":{"automatic":false}}');
  try {
    await openNamingSettings(host);
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('newline', {timeoutMs: 4000});
    await host.terminal.keyboard.press('Control+U');
    await host.terminal.keyboard.type(rules);
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      '{"rtk":{"ansi":false}}',
    );
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Settings changed on disk.', {
      timeoutMs: 4000,
    });
    const screen = await host.terminal.screen.text();
    expect(screen).toContain('Use a precise English task name.');
    expect(screen).toContain('Preserve OAuth identifiers and user intent.');
    await host.terminal.keyboard.type(' Keep SDK casing.');
    await host.terminal.screen.waitForText('Keep SDK casing.', {
      timeoutMs: 4000,
    });
  } finally {
    await host.close();
  }
}, 30000);

test.each(['rules', 'model', 'automatic'])(
  'confirmed %s save still reports late failure after leaving its panel',
  async field => {
    const host = await launchPi('{"naming":{"automatic":false}}');
    let writer: ReturnType<typeof Bun.spawn> | undefined;
    try {
      await openNamingSettings(host);
      if (field !== 'automatic') {
        await host.terminal.keyboard.press('ArrowDown');
        if (field === 'rules') await host.terminal.keyboard.press('ArrowDown');
        await host.terminal.keyboard.press('Enter');
        await host.terminal.screen.waitForText(
          field === 'rules' ? 'newline' : 'Search models',
          {timeoutMs: 4000},
        );
      }
      if (field === 'rules') {
        await host.terminal.screen.waitForText('newline', {timeoutMs: 4000});
        await host.terminal.keyboard.press('Control+U');
        await host.terminal.keyboard.type(rules);
      }
      // Stall the real file owner's revision read after staging its atomic write.
      const path = join(host.agent, 'pi-stuff.json');
      await unlink(path);
      expect(Bun.spawnSync(['mkfifo', path]).exitCode).toBe(0);
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitUntil(
        async () =>
          (await readdir(host.agent)).some(file => file.endsWith('.tmp')),
        {timeoutMs: 4000},
      );
      if (field === 'rules') {
        expect(await host.terminal.screen.text()).toContain(
          'Use a precise English task name.',
        );
        expect(await host.terminal.screen.text()).toContain(
          'Preserve OAuth identifiers and user intent.',
        );
      }
      if (field !== 'automatic') {
        await host.terminal.keyboard.press('Escape');
        await host.terminal.screen.waitForText('Automatic naming', {
          timeoutMs: 4000,
        });
      }
      await backToNamingHome(host);
      await closeNamingHome(host);
      // Use a child writer so a regression cannot leave this test blocked in open().
      writer = Bun.spawn(
        [
          'sh',
          '-c',
          'printf %s "$2" > "$1"',
          'naming-fixture',
          path,
          '{"rtk":{"ansi":false}}',
        ],
        {stdout: 'ignore', stderr: 'pipe'},
      );
      await host.terminal.screen.waitUntil(
        async () =>
          !(await readdir(host.agent)).some(file => file.endsWith('.lock')),
        {timeoutMs: 4000},
      );
      await host.terminal.screen.waitForText('Settings changed on disk.', {
        timeoutMs: 4000,
      });
      expect(await writer.exited).toBe(0);
      expect((await host.terminal.status()).state).toBe('running');
    } finally {
      writer?.kill();
      await host.close();
    }
  },
  30000,
);

test.each(['new', 'reload'])(
  'late settings failure leaves the replacement session usable after %s',
  async action => {
    const host = await launchPi('{"naming":{"automatic":false}}');
    let writer: ReturnType<typeof Bun.spawn> | undefined;
    try {
      await openNamingSettings(host);
      const path = join(host.agent, 'pi-stuff.json');
      const held = join(host.agent, 'pending-pipe');
      await unlink(path);
      expect(Bun.spawnSync(['mkfifo', path]).exitCode).toBe(0);
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitUntil(
        async () =>
          (await readdir(host.agent)).some(file => file.endsWith('.tmp')),
        {timeoutMs: 4000},
      );
      await backToNamingHome(host);
      await closeNamingHome(host);
      await rename(path, held);
      await writeFile(path, '{"naming":{"automatic":false}}');
      await beginReplacement(host, action);
      writer = Bun.spawn(
        [
          'sh',
          '-c',
          'printf %s "$2" > "$1"',
          'naming-fixture',
          held,
          '{"rtk":{"ansi":false}}',
        ],
        {stdout: 'ignore', stderr: 'pipe'},
      );
      await host.terminal.screen.waitUntil(
        async () =>
          !(await readdir(host.agent)).some(file => file.endsWith('.lock')),
        {timeoutMs: 4000},
      );
      expect(await writer.exited).toBe(0);
      await finishReplacement(host, action);
      await host.invoke('', '{}');
      expect((await host.terminal.status()).state).toBe('running');
      const logs = await host.terminal.logs.text();
      expect(logs).not.toContain('This extension ctx is stale');
      expect(logs).not.toContain('Settings changed on disk.');
    } finally {
      writer?.kill();
      await host.close();
    }
  },
  30000,
);

test.each(['new', 'reload'])(
  'a confirmed model save is active after %s replaces its session',
  async action => {
    const original = '{"naming":{"automatic":false}}';
    const host = await launchPi(original);
    let writer: ReturnType<typeof Bun.spawn> | undefined;
    try {
      await openNamingSettings(host);
      await host.terminal.keyboard.press('ArrowDown');
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText('Search models', {
        timeoutMs: 4000,
      });
      await host.terminal.keyboard.type('fixture/naming');
      await host.terminal.screen.waitForText('fixture/naming', {
        timeoutMs: 4000,
      });
      const path = join(host.agent, 'pi-stuff.json');
      const held = join(host.agent, 'pending-pipe');
      await unlink(path);
      expect(Bun.spawnSync(['mkfifo', path]).exitCode).toBe(0);
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitUntil(
        async () =>
          (await readdir(host.agent)).some(file => file.endsWith('.tmp')),
        {timeoutMs: 4000},
      );
      await host.terminal.keyboard.press('Escape');
      await host.terminal.screen.waitForText('Automatic naming', {
        timeoutMs: 4000,
      });
      await backToNamingHome(host);
      await closeNamingHome(host);
      await rename(path, held);
      await writeFile(path, original);
      await beginReplacement(host, action);
      writer = Bun.spawn(
        ['sh', '-c', 'printf %s "$2" > "$1"', 'naming-fixture', held, original],
        {stdout: 'ignore', stderr: 'pipe'},
      );
      await host.terminal.screen.waitUntil(
        async () =>
          !(await readdir(host.agent)).some(file => file.endsWith('.lock')),
        {timeoutMs: 4000},
      );
      expect(await writer.exited).toBe(0);
      expect(await readFile(path, 'utf8')).toContain('"id": "naming"');
      await finishReplacement(host, action);
      await openNamingSettings(host);
      expect(await host.terminal.screen.text()).toContain('fixture/naming');
    } finally {
      writer?.kill();
      await host.close();
    }
  },
  30000,
);

test.each([false, true])(
  'pending rule saves freeze edits and repeated submission; conflict: %s',
  async conflict => {
    const original = '{"naming":{"automatic":false}}';
    const host = await launchPi(original);
    let writer: ReturnType<typeof Bun.spawn> | undefined;
    try {
      await openNamingSettings(host);
      await host.terminal.keyboard.type('rules');
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText('external editor', {
        timeoutMs: 4000,
      });
      await host.terminal.keyboard.press('Control+U');
      await host.terminal.keyboard.type(rules);
      const path = join(host.agent, 'pi-stuff.json');
      await unlink(path);
      expect(Bun.spawnSync(['mkfifo', path]).exitCode).toBe(0);
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitUntil(
        async () =>
          (await readdir(host.agent)).some(file => file.endsWith('.tmp')),
        {timeoutMs: 4000},
      );
      await host.terminal.keyboard.type('UNCONFIRMED_EDIT');
      await host.terminal.keyboard.press('Enter');
      expect(await host.terminal.screen.text()).toContain(
        'Preserve OAuth identifiers and user intent.',
      );
      expect(await host.terminal.screen.text()).not.toContain(
        'UNCONFIRMED_EDIT',
      );
      writer = Bun.spawn(
        [
          'sh',
          '-c',
          'printf %s "$2" > "$1"',
          'naming-fixture',
          path,
          conflict ? '{"rtk":{"ansi":false}}' : original,
        ],
        {stdout: 'ignore', stderr: 'pipe'},
      );
      expect(await writer.exited).toBe(0);
      if (conflict) {
        await host.terminal.screen.waitForText('Settings changed on disk.', {
          timeoutMs: 4000,
        });
        expect(await host.terminal.screen.text()).toContain(
          'Use a precise English task name.',
        );
        expect(await host.terminal.screen.text()).toContain(
          'Preserve OAuth identifiers and user intent.',
        );
        await host.terminal.keyboard.type(' Retain casing.');
        await host.terminal.screen.waitForText('Retain casing.', {
          timeoutMs: 4000,
        });
      } else {
        await host.terminal.screen.waitForText('AutoName / Settings', {
          timeoutMs: 4000,
        });
        expect(await readFile(path, 'utf8')).toContain(JSON.stringify(rules));
      }
    } finally {
      writer?.kill();
      await host.close();
    }
  },
  30000,
);
