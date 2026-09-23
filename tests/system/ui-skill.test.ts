import {expect, test} from 'bun:test';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Skill reads remain independent and disclose retained content through reload and resume', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  try {
    await host.terminal.resize({cols: 100, rows: 50});
    await mkdir(join(host.directory, 'sample-skill'));
    await writeFile(
      join(host.directory, 'sample-skill/SKILL.md'),
      'SKILL_INSTRUCTIONS\nKeep the original content.',
    );
    await writeFile(join(host.directory, 'ordinary.txt'), 'ORDINARY_CONTENT');
    const read = {name: 'read', parameters: '{"path":"ordinary.txt"}'};
    await host.sequence([
      read,
      {
        name: 'read',
        parameters:
          '{"path":"@sample-skill/SKILL.md","offset":null,"limit":null}',
      },
      read,
    ]);
    const sessions = join(host.directory, 'sessions');
    const name = (await readdir(sessions, {recursive: true})).find(path =>
      path.endsWith('.jsonl'),
    );
    if (!name) throw new Error('Missing skill session');
    const file = join(sessions, name);
    const saved = await readFile(file, 'utf8');
    await writeFile(
      join(host.directory, 'sample-skill/SKILL.md'),
      'CHANGED_SKILL_CONTENT',
    );
    for (const stage of ['live', 'reload', 'resume']) {
      if (stage === 'reload') await host.reload();
      if (stage === 'resume') await host.restart(['--session', file]);
      await host.terminal.screen.waitForText('Skill(sample-skill)', {
        timeoutMs: 5000,
      });
      const compact = await host.terminal.screen.text();
      expect(compact.match(/• Read 1 file/gu)).toHaveLength(2);
      expect(compact).not.toContain('SKILL_INSTRUCTIONS');
      const rows = compact.split('\n');
      const y = rows.findIndex(row => row.includes('Skill(sample-skill)'));
      await host.terminal.mouse({
        action: 'click',
        button: 'left',
        x: rows[y]?.indexOf('•') ?? 0,
        y,
      });
      await host.terminal.screen.waitForText('SKILL_INSTRUCTIONS', {
        timeoutMs: 5000,
      });
      const expanded = await host.terminal.screen.text();
      expect(expanded).toContain('sample-skill/SKILL.md');
      expect(expanded).not.toContain('CHANGED_SKILL_CONTENT');
      expect(expanded).not.toContain('ORDINARY_CONTENT');
      expect(await readFile(file, 'utf8')).toBe(saved);
      await host.terminal.mouse({
        action: 'click',
        button: 'left',
        x: rows[y]?.indexOf('•') ?? 0,
        y,
      });
      await host.terminal.screen.waitUntil(
        snapshot => !snapshot.text.includes('SKILL_INSTRUCTIONS'),
        {timeoutMs: 5000},
      );
    }
    await host.invoke('read', '{"path":"missing/SKILL.md"}');
    const failed = await host.terminal.screen.text();
    expect(failed).toContain('Skill(missing)');
    expect(failed).toMatch(/ENOENT|no such file/iu);
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await host.close();
  }
}, 30000);
