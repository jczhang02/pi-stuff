import {expect, test} from 'bun:test';
import {readFile, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Partial Write arguments retain the tool heading and editor before execution', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  const gate = Promise.withResolvers<void>();
  try {
    const content = "export const streamed = 'READY';\n";
    const parameters = JSON.stringify({path: 'streamed.ts', content});
    await host.startPartialInput(
      'write',
      parameters,
      parameters.indexOf('READY'),
      gate.promise,
    );
    const pending = await host.terminal.screen.waitUntil(
      snapshot => snapshot.text.includes('• Write(streamed.ts)'),
      {timeoutMs: 5000},
    );
    expect(pending.text).not.toContain('Wrote');
    await expect(
      stat(join(host.directory, 'streamed.ts')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await host.terminal.keyboard.type('CONTINUE_EDITING');
    await host.terminal.screen.waitForText('CONTINUE_EDITING', {
      timeoutMs: 5000,
    });
    await host.terminal.resize({cols: 60, rows: 32});
    const narrow = await host.terminal.screen.waitUntil(
      snapshot =>
        snapshot.frame.cols === 60 &&
        snapshot.text.includes('CONTINUE_EDITING'),
      {timeoutMs: 5000},
    );
    expect(narrow.text).toContain('• Write(streamed.ts)');
    expect(narrow.text).not.toContain('Wrote');
    gate.resolve();
    await host.terminal.screen.waitForText('RTK_TURN_1_DONE', {
      timeoutMs: 5000,
    });
    expect(await readFile(join(host.directory, 'streamed.ts'), 'utf8')).toBe(
      content,
    );
    const complete = await host.terminal.screen.text();
    expect(complete).toContain('Wrote 1 line');
    expect(complete).toContain("export const streamed = 'READY';");
    expect(complete).toContain('CONTINUE_EDITING');
  } catch (error) {
    console.error(
      (
        await host.terminal.screen.capture({
          allowIncomplete: true,
          deadlineMs: 200,
        })
      ).text,
    );
    throw error;
  } finally {
    gate.resolve();
    await host.close();
  }
}, 30000);

test('Bash disclosure follows streamed output, completion, width and theme', async () => {
  const host = await launchPi('{"rtk":{"rewrite":false}}', undefined, 'ui');
  try {
    await host.terminal.resize({cols: 120, rows: 42});
    await writeFile(
      join(host.directory, 'initial.txt'),
      'FIRST\nSECOND\nTHIRD\n',
    );
    await writeFile(
      join(host.directory, 'appended.txt'),
      `WIDE_${'界'.repeat(30)}_END\nFINAL_ROW\n`,
    );
    await host.start(
      'bash',
      JSON.stringify({
        command:
          'cat initial.txt; while [ ! -f advance ]; do sleep 0.05; done; cat appended.txt; while [ ! -f finish ]; do sleep 0.05; done',
      }),
    );
    await host.terminal.screen.waitForText('⎿ SECOND', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('⎿ FIRST', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('⎿ SECOND', {timeoutMs: 5000});
    await writeFile(join(host.directory, 'advance'), 'ready');
    await host.terminal.screen.waitForText('⎿ WIDE_', {timeoutMs: 5000});
    const running = await host.terminal.screen.capture({
      allowIncomplete: true,
      deadlineMs: 200,
    });
    expect(running.text).toContain('FINAL_ROW');
    expect(running.text).toContain('3 more lines');
    expect(running.text).not.toContain('⎿ SECOND');
    await writeFile(join(host.directory, 'finish'), 'ready');
    await host.terminal.screen.waitForText('RTK_TURN_1_DONE', {
      timeoutMs: 5000,
    });
    const complete = await host.terminal.screen.text();
    expect(complete).toContain('⎿ FIRST');
    expect(complete).toContain('2 more lines');
    expect(complete).toContain('Exit code 0');
    expect(complete).not.toContain('FINAL_ROW');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('FINAL_ROW', {timeoutMs: 5000});
    const dark = await host.terminal.screen.capture();
    const darkY = dark.text.split('\n').findIndex(row => row.includes('WIDE_'));
    const darkColor = dark.frame.cells.find(
      cell => cell.y === darkY && cell.x === 4,
    )?.foreground;
    expect(darkColor).toBeDefined();
    await host.command('/host-theme catppuccin-latte');
    await host.terminal.screen.waitForText('HOST_THEME:catppuccin-latte', {
      timeoutMs: 5000,
    });
    const light = await host.terminal.screen.capture();
    const lightY = light.text
      .split('\n')
      .findIndex(row => row.includes('WIDE_'));
    const lightColor = light.frame.cells.find(
      cell => cell.y === lightY && cell.x === 4,
    )?.foreground;
    expect(lightColor).toBeDefined();
    expect(lightColor).not.toEqual(darkColor);
    await writeFile(join(host.directory, 'appended.txt'), 'CHANGED_ON_DISK');
    for (const [cols, hidden] of [
      [60, 3],
      [80, 2],
      [120, 2],
    ] as const) {
      await host.terminal.resize({cols, rows: 42});
      const expanded = await host.terminal.screen.waitUntil(
        snapshot =>
          snapshot.frame.cols === cols && snapshot.text.includes('_END'),
        {timeoutMs: 5000},
      );
      expect(expanded.text).toContain('_END');
      expect(expanded.text).toContain('FINAL_ROW');
      expect(expanded.text).not.toContain('CHANGED_ON_DISK');
      await host.terminal.keyboard.press('Control+O');
      await host.terminal.screen.waitForText(`${hidden} more lines`, {
        timeoutMs: 5000,
      });
      expect(await host.terminal.screen.text()).not.toContain('FINAL_ROW');
      await host.terminal.keyboard.press('Control+O');
      await host.terminal.screen.waitForText('FINAL_ROW', {timeoutMs: 5000});
    }
  } finally {
    await host.close();
  }
}, 30000);

test('Cancelling streamed tool arguments prevents execution and permits the next turn', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  const gate = Promise.withResolvers<void>();
  try {
    const parameters = JSON.stringify({
      path: 'cancelled.ts',
      content: 'NEVER_WRITE_THIS',
    });
    await host.startPartialInput(
      'write',
      parameters,
      parameters.indexOf('NEVER_WRITE_THIS'),
      gate.promise,
    );
    await host.terminal.screen.waitForText('• Write(cancelled.ts)', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText(/operation(?: was)? aborted/iu, {
      timeoutMs: 5000,
    });
    gate.resolve();
    await host.invoke(
      'write',
      JSON.stringify({path: 'next.txt', content: 'NEXT_TURN_RESULT'}),
    );
    await expect(
      stat(join(host.directory, 'cancelled.ts')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(join(host.directory, 'next.txt'), 'utf8')).toBe(
      'NEXT_TURN_RESULT',
    );
    const next = await host.terminal.screen.text();
    expect(next).toContain('Write(next.txt)');
    expect(next).toContain('NEXT_TURN_RESULT');
    expect(next).toContain('RTK_TURN_2_DONE');
  } catch (error) {
    console.error(
      (
        await host.terminal.screen.capture({
          allowIncomplete: true,
          deadlineMs: 200,
        })
      ).text,
    );
    throw error;
  } finally {
    gate.resolve();
    await host.close();
  }
}, 30000);
