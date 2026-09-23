import {expect, test} from 'bun:test';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('A restricted tool allowlist retains disabled built-in historical views', async () => {
  const original = await launchPi(
    '{"ui":{"retrievalGroups":false}}',
    undefined,
    'ui',
  );
  try {
    await original.invoke(
      'write',
      JSON.stringify({path: 'sample.ts', content: 'export const value = 1;\n'}),
    );
    await original.invoke(
      'edit',
      JSON.stringify({
        path: 'sample.ts',
        oldText: 'value = 1',
        newText: 'value = 2',
      }),
    );
    await original.invoke(
      'grep',
      JSON.stringify({pattern: 'value', path: 'sample.ts'}),
    );
    await original.invoke('find', JSON.stringify({pattern: '*.ts'}));
    await original.invoke('ls', JSON.stringify({path: '.'}));
    const sessions = join(original.directory, 'sessions');
    const name = (await readdir(sessions, {recursive: true})).find(path =>
      path.endsWith('.jsonl'),
    );
    if (!name) throw new Error('Missing original session');
    const path = join(sessions, name);
    const saved = await readFile(path, 'utf8');
    await writeFile(
      join(original.directory, 'sample.ts'),
      'CHANGED_AFTER_SESSION\n',
    );
    // The RTK fixture passes --tools bash,read, excluding other definitions.
    const restored = await launchPi('{"ui":{"retrievalGroups":false}}');
    try {
      await restored.terminal.resize({cols: 100, rows: 65});
      await restored.command(`/host-session ${path}`);
      await restored.terminal.screen.waitForText('RTK_TURN_5_DONE', {
        timeoutMs: 5000,
      });
      const compact = await restored.terminal.screen.text();
      for (const label of [
        'Write(sample.ts)',
        'Edit(sample.ts)',
        'Grep(value, sample.ts)',
        'Find(*.ts, .)',
        'Ls(.)',
      ])
        expect(compact).toContain(label);
      expect(compact).toContain('Added 1 line, removed 1 line');
      await restored.terminal.keyboard.press('Control+O');
      await restored.terminal.screen.waitForText('export const value = 2;', {
        timeoutMs: 5000,
      });
      expect(await readFile(path, 'utf8')).toBe(saved);
      expect(
        await readFile(join(original.directory, 'sample.ts'), 'utf8'),
      ).toBe('CHANGED_AFTER_SESSION\n');
      await restored.startResponse('DISABLED_AVAILABILITY_OBSERVED');
      await restored.terminal.screen.waitForText(
        'DISABLED_AVAILABILITY_OBSERVED',
        {timeoutMs: 5000},
      );
      for (const name of ['write', 'edit', 'grep', 'find', 'ls'])
        expect(restored.offered()).not.toContain(name);
    } finally {
      await restored.close();
    }
  } finally {
    await original.close();
  }
}, 30000);
