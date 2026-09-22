import {expect, test} from 'bun:test';
import {writeFile, unlink, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';
import {
  openNamingSettings,
  backToNamingHome,
  closeNamingHome,
} from './naming-panel-helpers';

const rules =
  'Use a precise English task name.\nPreserve OAuth identifiers and user intent.';

test('failed rules saves retain the complete editable draft', async () => {
  const host = await launchPi('{"naming":{"automatic":false}}');
  try {
    await openNamingSettings(host);
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Edit value', {timeoutMs: 4000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Newline', {timeoutMs: 4000});
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
          field === 'rules' ? 'Edit value' : 'Search models',
          {timeoutMs: 4000},
        );
      }
      if (field === 'rules') {
        await host.terminal.keyboard.press('Enter');
        await host.terminal.screen.waitForText('Newline', {timeoutMs: 4000});
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
