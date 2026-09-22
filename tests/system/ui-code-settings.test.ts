import {expect, test} from 'bun:test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {ScreenSnapshot} from '@kitlangton/terminal-control';
import {launchPi} from './fixtures/pi-terminal';

function sourceStyle(snapshot: ScreenSnapshot, source: string) {
  const rows = snapshot.text.split('\n');
  const y = rows.findIndex(row => row.includes(source));
  const row = rows[y];
  if (row === undefined) throw new Error(`Source is not visible: ${source}`);
  const x = row.indexOf(source);
  const cells = snapshot.frame.cells.filter(
    cell => cell.y === y && cell.x >= x && cell.x < x + source.length,
  );
  return {
    foregrounds: new Set(cells.map(cell => JSON.stringify(cell.foreground))),
    backgrounds: new Set(cells.map(cell => JSON.stringify(cell.background))),
  };
}

test('Global code presentation controls change rendering while preserving written and edited content', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  try {
    await host.invoke(
      'write',
      JSON.stringify({path: 'before.ts', content: 'const before = 1;\n'}),
    );
    const highlighted = await host.terminal.screen.capture();
    expect(
      sourceStyle(highlighted, 'const before = 1;').foregrounds.size,
    ).toBeGreaterThan(1);
    await host.invoke(
      'edit',
      JSON.stringify({
        path: 'before.ts',
        edits: [{oldText: 'const before = 1;', newText: 'const before = 2;'}],
      }),
    );
    const defaultDiff = await host.terminal.screen.capture();
    expect(defaultDiff.text).toMatch(/1 \+ const before = 2;/u);
    const defaultStyle = sourceStyle(defaultDiff, 'const before = 2;');
    expect(defaultStyle.foregrounds.size).toBeGreaterThan(1);
    expect(
      defaultStyle.backgrounds.has(
        JSON.stringify(defaultDiff.frame.background),
      ),
    ).toBe(false);

    await host.command('/ui');
    await host.terminal.screen.waitForText('Conversation UI settings', {
      timeoutMs: 5000,
    });
    for (let i = 0; i < 7; i++) await host.terminal.keyboard.press('ArrowDown');
    for (const [label, key] of [
      ['Code highlighting', 'codeHighlighting'],
      ['Diff line numbers', 'diffLineNumbers'],
      ['Diff backgrounds', 'diffBackgrounds'],
    ] as const) {
      expect(await host.terminal.screen.text()).toContain(label);
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitUntil(
        async () =>
          (await readFile(join(host.agent, 'pi-stuff.json'), 'utf8')).includes(
            `"${key}": false`,
          ),
        {timeoutMs: 5000},
      );
      await host.terminal.keyboard.press('ArrowDown');
    }
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      snapshot => !snapshot.text.includes('Conversation UI settings'),
      {timeoutMs: 5000},
    );
    await mkdir(join(host.directory, '.pi'));
    await writeFile(
      join(host.directory, '.pi/pi-stuff.json'),
      JSON.stringify({
        ui: {
          codeHighlighting: true,
          diffLineNumbers: true,
          diffBackgrounds: true,
        },
      }),
    );
    await host.reload();
    await host.invoke(
      'write',
      JSON.stringify({path: 'after.ts', content: 'const value = 1;\n'}),
    );
    const plainWrite = await host.terminal.screen.capture();
    expect(sourceStyle(plainWrite, 'const value = 1;').foregrounds.size).toBe(
      1,
    );
    await host.invoke(
      'edit',
      JSON.stringify({
        path: 'after.ts',
        edits: [{oldText: 'const value = 1;', newText: 'const value = 2;'}],
      }),
    );
    const plainDiff = await host.terminal.screen.capture();
    expect(plainDiff.text).toMatch(/^    - const value = 1;\s*$/mu);
    expect(plainDiff.text).toMatch(/^    \+ const value = 2;\s*$/mu);
    const style = sourceStyle(plainDiff, 'const value = 2;');
    expect(style.foregrounds.size).toBe(1);
    expect(style.backgrounds).toEqual(
      new Set([JSON.stringify(plainDiff.frame.background)]),
    );
    expect(await readFile(join(host.directory, 'after.ts'), 'utf8')).toBe(
      'const value = 2;\n',
    );
  } finally {
    await host.close();
  }
}, 30000);

test('Existing code results refresh colors and wrapped preview counts after theme and width changes', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  const before = `const written = "${'a'.repeat(120)}";\nconst left = 1;\nconst right = 2;\nconst ended = 3;\n`;
  const after = `const edited = "${'b'.repeat(120)}";\nconst left = 4;\nconst right = 5;\nconst ended = 9;\n`;
  try {
    await host.terminal.resize({cols: 100, rows: 60});
    await host.invoke(
      'write',
      JSON.stringify({path: 'theme.ts', content: before}),
    );
    await host.invoke(
      'edit',
      JSON.stringify({
        path: 'theme.ts',
        edits: [{oldText: before, newText: after}],
      }),
    );
    const compact = await host.terminal.screen.text();
    expect(compact).toContain('3 more lines');
    expect(compact).toContain('6 more lines');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('4 + const ended = 9;', {
      timeoutMs: 5000,
    });
    const dark = await host.terminal.screen.capture();
    const darkWrite = sourceStyle(dark, 'const written');
    const darkEdit = sourceStyle(dark, 'const edited');

    await host.command('/host-theme catppuccin-latte');
    await host.terminal.screen.waitForText('HOST_THEME:catppuccin-latte', {
      timeoutMs: 5000,
    });
    const light = await host.terminal.screen.capture();
    expect(sourceStyle(light, 'const written').foregrounds).not.toEqual(
      darkWrite.foregrounds,
    );
    expect(sourceStyle(light, 'const edited').foregrounds).not.toEqual(
      darkEdit.foregrounds,
    );
    expect(sourceStyle(light, 'const edited').backgrounds).not.toEqual(
      darkEdit.backgrounds,
    );

    await host.terminal.resize({cols: 60, rows: 60});
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('8 more lines', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('4 more lines');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('4 + const ended = 9;', {
      timeoutMs: 5000,
    });
    await host.command('/host-theme dark');
    await host.terminal.screen.waitForText('HOST_THEME:dark', {
      timeoutMs: 5000,
    });
    const restored = await host.terminal.screen.capture();
    expect(sourceStyle(restored, 'const written').foregrounds).toEqual(
      darkWrite.foregrounds,
    );
    expect(sourceStyle(restored, 'const edited').foregrounds).toEqual(
      darkEdit.foregrounds,
    );
    expect(await readFile(join(host.directory, 'theme.ts'), 'utf8')).toBe(
      after,
    );
  } finally {
    await host.close();
  }
}, 30000);
