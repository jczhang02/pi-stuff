import {expect, test} from 'bun:test';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Write previews and Edit diffs survive reload and resume without reading changed files', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  const source =
    'export const value = 1;\n// second\n// third\n// fourth\nexport const last = 5;\n';
  try {
    await host.terminal.resize({cols: 100, rows: 50});
    await host.sequence([
      {
        name: 'write',
        parameters: JSON.stringify({path: 'change.ts', content: source}),
      },
      {
        name: 'edit',
        parameters: JSON.stringify({
          path: 'change.ts',
          oldText: 'export const value = 1;',
          newText: 'export const value = 2;',
        }),
      },
    ]);
    expect(await readFile(join(host.directory, 'change.ts'), 'utf8')).toBe(
      source.replace('value = 1', 'value = 2'),
    );
    const directory = join(host.directory, 'sessions');
    const name = (await readdir(directory, {recursive: true})).find(path =>
      path.endsWith('.jsonl'),
    );
    if (!name) throw new Error('Missing session');
    const file = join(directory, name);
    const saved = await readFile(file, 'utf8');
    await writeFile(
      join(host.directory, 'change.ts'),
      'CHANGED_AFTER_RECORDING',
    );
    for (const stage of ['live', 'reload', 'resume']) {
      if (stage === 'reload') await host.reload();
      if (stage === 'resume') {
        await host.command('/host-session new');
        await host.terminal.screen.waitForText('HOST_SESSION_NEW', {
          timeoutMs: 5000,
        });
        await host.command(`/host-session ${file}`);
        await host.terminal.screen.waitForText('Resumed session', {
          timeoutMs: 5000,
        });
      }
      const compact = await host.terminal.screen.text();
      expect(compact).toContain('Write(change.ts)');
      expect(compact).toContain('Wrote 5 lines');
      expect(compact).toContain('2 more lines');
      expect(compact).toContain('Edit(change.ts)');
      expect(compact).toContain('Added 1 line, removed 1 line');
      await host.terminal.keyboard.press('Control+O');
      await host.terminal.screen.waitForText('export const last = 5;', {
        timeoutMs: 5000,
      });
      const expanded = await host.terminal.screen.text();
      expect(expanded).toContain('1 - export const value = 1;');
      expect(expanded).toContain('1 + export const value = 2;');
      expect(expanded).not.toContain('CHANGED_AFTER_RECORDING');
      expect(await readFile(file, 'utf8')).toBe(saved);
      expect(await readFile(join(host.directory, 'change.ts'), 'utf8')).toBe(
        'CHANGED_AFTER_RECORDING',
      );
      await host.terminal.keyboard.press('Control+O');
    }
  } finally {
    await host.close();
  }
}, 30000);
