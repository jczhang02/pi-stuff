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

test('Mid-turn compaction retains a visible retrieval group through reload', async () => {
  const host = await launchPi(
    '{}',
    resolve('tests/system/fixtures/ui-lifecycle.ts'),
    'ui',
  );
  try {
    await host.terminal.resize({cols: 100, rows: 55});
    await writeFile(
      join(host.agent, 'settings.json'),
      JSON.stringify({
        compaction: {enabled: false, keepRecentTokens: 1, reserveTokens: 100},
      }),
    );
    await host.reload();
    await writeFile(join(host.directory, 'discarded.txt'), 'DISCARDED_BODY');
    await writeFile(join(host.directory, 'kept.txt'), 'RETAINED_BODY');
    const kept = {name: 'read', parameters: JSON.stringify({path: 'kept.txt'})};
    await host.sequence([
      {name: 'read', parameters: JSON.stringify({path: 'discarded.txt'})},
      kept,
      kept,
    ]);
    expect(await host.terminal.screen.text()).toContain('Read 3 files');
    await writeFile(
      join(host.directory, 'kept.txt'),
      'CHANGED_AFTER_COMPACTION',
    );
    await host.command('/compact fixture-split-retrieval');
    await host.terminal.screen.waitForText('Compacted', {timeoutMs: 5000});
    for (const stage of ['live', 'reload']) {
      if (stage === 'reload') await host.reload();
      const compact = await host.terminal.screen.text();
      expect(compact).toContain('Read 2 files');
      expect(compact).not.toContain('Read 3 files');
      await host.terminal.keyboard.press('Control+O');
      await host.terminal.screen.waitForText('RETAINED_BODY', {
        timeoutMs: 5000,
      });
      const expanded = await host.terminal.screen.text();
      expect(expanded).not.toContain('DISCARDED_BODY');
      expect(expanded).not.toContain('CHANGED_AFTER_COMPACTION');
      await host.terminal.keyboard.press('Control+O');
    }
    await host.invoke('read', kept.parameters);
    const continued = await host.terminal.screen.text();
    expect(continued).toContain('Read 2 files');
    expect(continued).toContain('Read 1 file');
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await host.close();
  }
}, 30000);

test('Restored compaction separates retained retrievals from direct continuation', async () => {
  const host = await launchPi(
    '{}',
    resolve('tests/system/fixtures/ui-lifecycle.ts'),
    'ui',
  );
  try {
    await host.terminal.resize({cols: 100, rows: 55});
    await writeFile(join(host.directory, 'read.txt'), 'BOUNDARY_BODY');
    const read = {name: 'read', parameters: JSON.stringify({path: 'read.txt'})};
    await host.sequence([read, read, read]);
    expect(await host.terminal.screen.text()).toContain('Read 3 files');
    await host.command('/lifecycle-compacted-history');
    await host.terminal.screen.waitForText('Resumed session', {
      timeoutMs: 5000,
    });
    for (const stage of ['resume', 'reload']) {
      if (stage === 'reload') await host.reload();
      const screen = await host.terminal.screen.text();
      expect(screen).toContain('Read 2 files');
      expect(screen).toContain('Read 1 file');
      expect(screen).not.toContain('Read 3 files');
    }
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await host.close();
  }
}, 30000);
