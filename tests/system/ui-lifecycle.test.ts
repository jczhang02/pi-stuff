import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Tree navigation and fork rebuild only the selected branch retrievals', async () => {
  const host = await launchPi(
    '{}',
    resolve('tests/system/fixtures/ui-lifecycle.ts'),
    'ui',
  );
  try {
    await host.terminal.resize({cols: 100, rows: 55});
    await writeFile(join(host.directory, 'first.txt'), 'FIRST_BRANCH_BODY');
    await writeFile(join(host.directory, 'second.txt'), 'SECOND_BRANCH_BODY');
    await writeFile(join(host.directory, 'third.txt'), 'THIRD_BRANCH_BODY');
    const first = {
      name: 'read',
      parameters: JSON.stringify({path: 'first.txt'}),
    };
    const second = {
      name: 'read',
      parameters: JSON.stringify({path: 'second.txt'}),
    };
    await host.sequence([first, first]);
    await host.command('/lifecycle-mark first');
    await host.terminal.screen.waitForText('MARKED:first', {timeoutMs: 5000});
    await host.sequence([second, second, second]);
    await host.command('/lifecycle-mark second');
    await host.terminal.screen.waitForText('MARKED:second', {timeoutMs: 5000});
    await host.command('/lifecycle-tree first');
    await host.terminal.screen.waitUntil(
      snapshot => !snapshot.text.includes('Read 3 files'),
      {timeoutMs: 5000},
    );
    const third = {
      name: 'read',
      parameters: JSON.stringify({path: 'third.txt'}),
    };
    await host.sequence([third, third, third, third]);
    await host.command('/lifecycle-mark third');
    await host.terminal.screen.waitForText('MARKED:third', {timeoutMs: 5000});
    await writeFile(join(host.directory, 'first.txt'), 'CHANGED_ON_DISK');
    for (const point of ['second', 'third', 'first', 'second']) {
      await host.command(`/lifecycle-tree ${point}`);
      await host.terminal.screen.waitUntil(
        snapshot =>
          snapshot.text.includes('Read 2 files') &&
          snapshot.text.includes('Read 3 files') === (point === 'second') &&
          snapshot.text.includes('Read 4 files') === (point === 'third'),
        {timeoutMs: 5000},
      );
      await host.terminal.keyboard.press('Control+O');
      await host.terminal.screen.waitForText('FIRST_BRANCH_BODY', {
        timeoutMs: 5000,
      });
      const expanded = await host.terminal.screen.text();
      expect(expanded.includes('SECOND_BRANCH_BODY')).toBe(point === 'second');
      expect(expanded.includes('THIRD_BRANCH_BODY')).toBe(point === 'third');
      expect(expanded).not.toContain('CHANGED_ON_DISK');
      await host.terminal.keyboard.press('Control+O');
    }
    await host.command('/lifecycle-fork');
    await host.terminal.screen.waitForText('Forked to new session', {
      timeoutMs: 5000,
    });
    const forked = await host.terminal.screen.text();
    expect(forked).toContain('Read 2 files');
    expect(forked).not.toContain('Read 3 files');
    expect(forked).not.toContain('Read 4 files');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('FIRST_BRANCH_BODY', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).not.toContain(
      'SECOND_BRANCH_BODY',
    );
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await host.close();
  }
}, 30000);
