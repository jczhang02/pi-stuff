import {expect, test} from 'bun:test';
import {readFile, stat} from 'node:fs/promises';
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
