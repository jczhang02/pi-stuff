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

test.each([
  {offset: null, limit: null, output: 'FIRST\nSECOND\nTHIRD'},
  {
    offset: null,
    limit: 1,
    output: 'FIRST\n\n[2 more lines in file. Use offset=2 to continue.]',
  },
  {offset: 2, limit: null, output: 'SECOND\nTHIRD'},
])(
  'Read preserves nullable optional ranges in live and restored UI: %j',
  async range => {
    const host = await launchPi('{}', undefined, 'ui');
    try {
      await host.terminal.resize({cols: 100, rows: 45});
      await writeFile(
        join(host.directory, 'nullable.txt'),
        'FIRST\nSECOND\nTHIRD',
      );
      const parameters = JSON.stringify({
        path: 'nullable.txt',
        offset: range.offset,
        limit: range.limit,
      });
      expect(await host.invoke('read', parameters)).toBe(range.output);
      const compact = await host.terminal.screen.text();
      expect(compact).toContain(
        range.limit === null ? 'Read 1 file' : 'Read(nullable.txt)',
      );
      if (range.limit !== null) {
        expect(compact).toContain('1 more line');
        expect(compact).toContain('Use offset=2 to continue.');
      }
      await host.terminal.keyboard.press('Control+O');
      await host.terminal.screen.waitForText('Read(nullable.txt)', {
        timeoutMs: 5000,
      });
      const sessions = join(host.directory, 'sessions');
      const name = (await readdir(sessions, {recursive: true})).find(path =>
        path.endsWith('.jsonl'),
      );
      if (!name) throw new Error('Missing saved Read session');
      const file = join(sessions, name);
      const saved = await readFile(file, 'utf8');
      expect(saved).toContain(parameters);
      await writeFile(
        join(host.directory, 'nullable.txt'),
        'CHANGED_AFTER_READ',
      );
      for (const transition of ['live', 'reload', 'resume']) {
        if (transition === 'reload') await host.reload();
        else if (transition === 'resume') {
          await host.command('/host-session new');
          await host.terminal.screen.waitForText('HOST_SESSION_NEW', {
            timeoutMs: 5000,
          });
          await host.command(`/host-session ${file}`);
          await host.terminal.screen.waitForText('Resumed session', {
            timeoutMs: 5000,
          });
        }
        await host.terminal.screen.waitForText('Read(nullable.txt)', {
          timeoutMs: 5000,
        });
        await host.terminal.screen.waitForText(
          `⎿  ${range.output.split('\n')[0]}`,
          {timeoutMs: 5000},
        );
        const visible = await host.terminal.screen.text();
        expect(visible).toContain(`⎿  ${range.output.split('\n')[0]}`);
        for (const line of range.output.split('\n').filter(Boolean))
          expect(visible).toContain(line);
        expect(visible).not.toContain('CHANGED_AFTER_READ');
        expect(await readFile(file, 'utf8')).toBe(saved);
      }
    } finally {
      await host.close();
    }
  },
  30000,
);
