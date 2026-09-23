import {expect, test} from 'bun:test';
import type {Frame} from '@kitlangton/terminal-control';
import {writeFile, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

function footerColor(frame: Frame, text: string) {
  for (let y = frame.rows - 3; y < frame.rows; y++) {
    const row = frame.cells.filter(cell => cell.y === y);
    const x = row
      .map(cell => cell.text)
      .join('')
      .indexOf(text);
    if (x >= 0) return row.find(cell => cell.x === x)?.foreground;
  }
  throw new Error(`Footer text absent: ${text}`);
}

test('Pi statusline: enabled by default and native fallback on reload', async () => {
  const host = await launchPi();
  try {
    await host.terminal.screen.waitForText('ctx ', {timeoutMs: 3000});
    expect(await host.terminal.screen.text()).toContain('fixture · off');
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      '{"statusline":{"enabled":false}}',
    );
    await host.reload();
    await host.terminal.screen.waitForText('(auto)', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).not.toContain('ctx ');
  } finally {
    await host.close();
  }
}, 30000);

test('Pi statusline: real Git counts and activity refresh after external branch changes', async () => {
  const host = await launchPi();
  try {
    const git = async (...args: string[]) => {
      const result = Bun.spawn(['git', ...args], {
        cwd: host.directory,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(await result.exited).toBe(0);
    };
    await git('init', '-b', 'statusline-test');
    await writeFile(join(host.directory, '.gitignore'), 'agent/\nsessions/\n');
    await git('add', '.gitignore');
    await host.restart([]);
    await host.terminal.screen.waitForText('statusline-test', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('+1');
    await git('checkout', '-b', 'BranchCase');
    await host.invoke('read', JSON.stringify({path: '.gitignore'}));
    await host.terminal.screen.waitForText('BranchCase', {timeoutMs: 5000});
  } finally {
    await host.close();
  }
}, 30000);

test('Pi statusline: native usage, latest hit, extensions, themes, resize and branch navigation', async () => {
  let cached = 8380;
  const host = await launchPi(
    '{"naming":{"automatic":false}}',
    join(import.meta.dir, 'fixtures/statusline-controls.ts'),
    'rtk',
    'fullscreen',
    () => {
      const chunk = {
        id: 'statusline',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'fixture',
      };
      return new Response(
        `data: ${JSON.stringify({...chunk, choices: [{index: 0, delta: {content: 'The local changes have been checked.'}, finish_reason: null}]})}\n\ndata: ${JSON.stringify({...chunk, choices: [{index: 0, delta: {}, finish_reason: 'stop'}], usage: {prompt_tokens: 10000, completion_tokens: 10, total_tokens: 10010, prompt_tokens_details: {cached_tokens: cached}}})}\n\ndata: [DONE]\n\n`,
        {headers: {'content-type': 'text/event-stream'}},
      );
    },
  );
  try {
    await host.command('Check the current changes');
    await host.terminal.screen.waitForText('hit 83.8%', {timeoutMs: 5000});
    let screen = await host.terminal.screen.text();
    expect(screen).toContain('ctx 8%/128k ━━━━━━━━━━');
    cached = 0;
    await host.command('Check them once more');
    await host.terminal.screen.waitForText('hit 0%', {timeoutMs: 5000});
    await host.command('/status-fixture segments');
    await host.terminal.screen.waitForText('ThirdParty · ProviderCase', {
      timeoutMs: 5000,
    });
    for (const theme of ['light', 'dark']) {
      await host.command(`/status-fixture ${theme}`);
      await host.terminal.screen.waitForText(`STATUS_READY_${theme}`, {
        timeoutMs: 5000,
      });
      for (const cols of [150, 100, 80, 50]) {
        await host.terminal.resize({cols, rows: 30});
        screen = await host.terminal.screen.text();
        expect(screen).toContain('fixture · off');
        expect(screen).not.toContain('git ?');
        expect(screen).not.toContain('ProviderCas…');
      }
    }
    await host.terminal.resize({cols: 150, rows: 30});
    await host.command('/status-fixture clear');
    await host.terminal.screen.waitForText('STATUS_READY_clear', {
      timeoutMs: 5000,
    });
    expect(
      (await host.terminal.screen.text()).split('\n').slice(-3).join('\n'),
    ).not.toContain('ThirdParty');
    await host.command('/status-fixture model');
    await host.terminal.screen.waitForText('naming · off', {timeoutMs: 5000});
    await host.command('/host-tree');
    await host.terminal.screen.waitForText('HOST_TREE_READY', {
      timeoutMs: 5000,
    });
    expect(
      (await host.terminal.screen.text()).split('\n').slice(-3).join('\n'),
    ).not.toContain('hit ');
  } finally {
    await host.close();
  }
}, 45000);

test('Pi statusline: native compaction unknown state, settings reload, model window and resume', async () => {
  const host = await launchPi(
    '{"naming":{"automatic":false}}',
    join(import.meta.dir, 'fixtures/statusline-controls.ts'),
    'rtk',
    'fullscreen',
    () => {
      const chunk = {
        id: 'compaction',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'fixture',
      };
      return new Response(
        `data: ${JSON.stringify({...chunk, choices: [{index: 0, delta: {content: 'Verified change. '.repeat(100)}, finish_reason: null}]})}\n\ndata: ${JSON.stringify({...chunk, choices: [{index: 0, delta: {}, finish_reason: 'stop'}], usage: {prompt_tokens: 10000, completion_tokens: 10, total_tokens: 10010, prompt_tokens_details: {cached_tokens: 8380}}})}\n\ndata: [DONE]\n\n`,
        {headers: {'content-type': 'text/event-stream'}},
      );
    },
  );
  try {
    await writeFile(
      join(host.agent, 'settings.json'),
      JSON.stringify({
        compaction: {
          enabled: true,
          reserveTokens: 117000,
          keepRecentTokens: 32,
        },
      }),
    );
    await host.reload();
    for (const prompt of ['Review the implementation', 'Review the tests']) {
      await host.command(prompt);
      await host.terminal.screen.waitForText('hit 83.8%', {timeoutMs: 5000});
      await host.terminal.screen.waitForIdle({timeoutMs: 5000});
    }
    await host.command('/status-fixture colors');
    await host.terminal.screen.waitForText('accent warning error text', {
      timeoutMs: 5000,
    });
    let frame = await host.terminal.screen.frame();
    expect(footerColor(frame, '8%')).toEqual(footerColor(frame, 'warning'));
    await host.command('/status-fixture compact');
    await host.terminal.screen.waitForText('STATUS_READY_compact', {
      timeoutMs: 10000,
    });
    await host.terminal.screen.waitForText('ctx ?/128k', {timeoutMs: 5000});
    expect(
      (await host.terminal.screen.text()).split('\n').slice(-3).join('\n'),
    ).not.toContain('━');
    await host.command('Continue the review');
    await host.terminal.screen.waitForText('ctx 8%/128k', {timeoutMs: 5000});
    const modelsPath = join(host.agent, 'models.json');
    await writeFile(
      modelsPath,
      (await readFile(modelsPath, 'utf8')).replace(
        '"id":"naming"',
        '"id":"naming","contextWindow":64000',
      ),
    );
    await host.reload();
    await host.command('/status-fixture colors');
    await host.terminal.screen.waitForText('accent warning error text', {
      timeoutMs: 5000,
    });
    await host.command('/status-fixture model');
    await host.terminal.screen.waitForText('ctx 16%/64k', {timeoutMs: 5000});
    frame = await host.terminal.screen.frame();
    expect(footerColor(frame, '16%')).toEqual(footerColor(frame, 'error'));
    await writeFile(
      join(host.agent, 'settings.json'),
      '{"compaction":{"enabled":false}}',
    );
    await host.reload();
    await host.command('/status-fixture colors');
    await host.terminal.screen.waitForText('accent warning error text', {
      timeoutMs: 5000,
    });
    frame = await host.terminal.screen.frame();
    expect(footerColor(frame, '16%')).toEqual(footerColor(frame, 'accent'));
    await host.restart(['--continue']);
    await host.terminal.screen.waitForText('hit 83.8%', {timeoutMs: 5000});
    await host.command('/status-fixture takeover');
    await host.terminal.screen.waitForText('OTHER_FOOTER', {timeoutMs: 5000});
    await host.command('Continue with the other footer');
    await host.terminal.screen.waitForIdle({timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('OTHER_FOOTER');
    await host.command('/new');
    await host.terminal.screen.waitForText('New session started', {
      timeoutMs: 5000,
    });
    await host.terminal.screen.waitForText('ctx 0%/128k', {timeoutMs: 5000});
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await host.close();
  }
}, 45000);
