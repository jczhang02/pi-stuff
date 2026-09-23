import {expect, test} from 'bun:test';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Grep, Find and Ls keep grouped history and original results through reload and resume', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  try {
    await host.terminal.resize({cols: 100, rows: 45});
    await mkdir(join(host.directory, 'entries'));
    await writeFile(
      join(host.directory, 'entries', 'source.ts'),
      'SOURCE_NEEDLE',
    );
    await host.sequence([
      {
        name: 'grep',
        parameters: '{"pattern":"SOURCE_NEEDLE","path":"entries"}',
      },
      {name: 'find', parameters: '{"pattern":"*.ts","path":"entries"}'},
      {name: 'ls', parameters: '{"path":"entries"}'},
    ]);
    const summary = 'Searched 2 patterns · Listed 1 directory';
    expect(await host.terminal.screen.text()).toContain(summary);
    const sessions = join(host.directory, 'sessions');
    const name = (await readdir(sessions, {recursive: true})).find(path =>
      path.endsWith('.jsonl'),
    );
    if (!name) throw new Error('Missing saved session');
    const file = join(sessions, name);
    const saved = await readFile(file, 'utf8');
    await writeFile(
      join(host.directory, 'entries', 'source.ts'),
      'CHANGED_AFTER_SEARCH',
    );
    for (const transition of ['reload', 'resume']) {
      if (transition === 'reload') await host.reload();
      else {
        await host.command('/host-session new');
        await host.terminal.screen.waitForText('HOST_SESSION_NEW', {
          timeoutMs: 5000,
        });
        await host.command(`/host-session ${file}`);
        await host.terminal.screen.waitForText('Resumed session', {
          timeoutMs: 5000,
        });
      }
      await host.terminal.screen.waitForText(summary, {timeoutMs: 5000});
      const rows = (await host.terminal.screen.text()).split('\n');
      const y = rows.findIndex(row => row.includes(summary));
      const x = rows[y]?.indexOf('•') ?? -1;
      expect(x).toBeGreaterThanOrEqual(0);
      await host.terminal.mouse({action: 'click', button: 'left', x, y});
      await host.terminal.screen.waitForText('Ls(entries)', {timeoutMs: 5000});
      const members = (await host.terminal.screen.text()).split('\n');
      for (const heading of [
        'Grep(SOURCE_NEEDLE, entries)',
        'Find(*.ts, entries)',
        'Ls(entries)',
      ])
        expect(members.find(row => row.includes(heading))?.indexOf('•')).toBe(
          x,
        );
      await host.terminal.keyboard.press('Control+O');
      await host.terminal.screen.waitForText('source.ts:1: SOURCE_NEEDLE', {
        timeoutMs: 5000,
      });
      expect(await host.terminal.screen.text()).not.toContain(
        'CHANGED_AFTER_SEARCH',
      );
      expect(await readFile(file, 'utf8')).toBe(saved);
      await host.terminal.keyboard.press('Control+O');
    }
  } finally {
    await host.close();
  }
}, 30000);
