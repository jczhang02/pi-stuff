import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('detail shows native tool evidence and folds it after completion and during composition', async () => {
  const finish = Promise.withResolvers<void>();
  const readFinished = Promise.withResolvers<void>();
  let called = false;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    async request => {
      if (request.tools?.some(tool => tool.function.name === 'subagent'))
        return undefined;
      if (!called) {
        called = true;
        return {
          type: 'tool_call',
          name: 'read',
          arguments: JSON.stringify({path: 'activity-evidence.txt'}),
        };
      }
      readFinished.resolve();
      await finish.promise;
      return {
        type: 'content',
        content:
          'ACTIVITY_REPORT: Cancellation preserves the original request evidence.',
      };
    },
  );
  try {
    await host.terminal.resize({cols: 150, rows: 50});
    await writeFile(
      join(host.directory, 'activity-evidence.txt'),
      'ACTIVITY_RECORDED_TOOL_TEXT\n',
    );
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        agent: 'investigator',
        task: 'Inspect retained tool evidence',
        tools: ['read'],
        notifyPerTask: false,
      }),
    );
    await readFinished.promise;
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● main', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● investigator', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('activity-evidence.txt', {
      timeoutMs: 5000,
    });
    const working = await host.terminal.screen.text();
    expect(working).toContain('▾ Activity');
    expect(working).toContain('activity-evidence.txt');
    expect(working).toContain('Inspect retained tool evidence');
    await host.terminal.keyboard.type('m');
    await host.terminal.screen.waitForText('Message investigator', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).not.toContain(
      'read activity-evidence.txt',
    );
    await host.terminal.keyboard.type('Preserve this draft');
    finish.resolve();
    await host.terminal.screen.waitForText('Done', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('Preserve this draft');
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('f latest', {timeoutMs: 5000});
    await host.terminal.keyboard.type('f');
    await host.terminal.screen.waitForText('ACTIVITY_REPORT', {
      timeoutMs: 5000,
    });
    const completed = await host.terminal.screen.text();
    expect(completed).toContain('▸ Activity');
    expect(completed).not.toContain('read activity-evidence.txt');
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('activity-evidence.txt', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('ACTIVITY_REPORT');
  } finally {
    finish.resolve();
    await host.close();
  }
}, 60000);
