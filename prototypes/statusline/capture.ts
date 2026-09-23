// One-shot terminal exercise and evidence capture, not a permanent test suite.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {TerminalControl} from '@kitlangton/terminal-control';
import type {Session} from '@kitlangton/terminal-control';
import {visibleWidth} from '@earendil-works/pi-tui';
import type {Scenario} from './footer';
import {createHost, font, root, runEffect, terminalBinary} from './host';
import type {Palette} from './host';

const output = resolve(
  process.argv[2] ?? join(tmpdir(), 'pi-statusline-captures'),
);
const themes: Palette[] = ['catppuccin-latte', 'catppuccin-mocha'];
const scenarios: Scenario[] = ['base', 'extended', 'long'];

async function capture(session: Session, name: string): Promise<string> {
  // A PTY resize can settle before Pi's debounced redraw arrives.
  await session.screen.waitUntil(
    snapshot => {
      const lines = snapshot.text.split('\n');
      const start = lines.findIndex(line => line.startsWith('~/dev/'));
      const runtime = lines[start + 1] ?? '';
      // A resized old frame must not masquerade as a newly right-aligned row.
      const completeTail = /(?:medium|gpt-6-astra|↓1)$/u.test(
        runtime.trimEnd(),
      );
      return (
        start >= 0 &&
        completeTail &&
        lines
          .slice(start, start + 2)
          .every(line => visibleWidth(line.trimEnd()) === snapshot.frame.cols)
      );
    },
    {timeoutMs: 5000},
  );
  const snapshot = await session.screen.capture({
    settleMs: 500,
    deadlineMs: 5000,
    includeAnsi: true,
  });
  assert.equal(snapshot.frame.rows, 16);
  const lines = snapshot.text.split('\n');
  const start = lines.findIndex(line => line.startsWith('~/dev/'));
  assert.ok(start >= 0, snapshot.text);
  const footer = lines.slice(start, start + 2).map(line => line.trimEnd());
  assert.equal(footer.length, 2);
  assert.doesNotMatch(
    footer[0] ?? '',
    /goal|codex used|ctx|hit/u,
    'Repository row stays focused',
  );
  assert.doesNotMatch(
    footer.join(' '),
    /R620k|W8k|est \$|openai-codex|auto/u,
    'Routine detail fields do not return at wider widths',
  );
  if (
    footer.join(' ').includes('goal') ||
    footer.join(' ').includes('codex used')
  ) {
    assert.ok(
      footer[1]?.includes('goal active · codex used 5h 41% · week 63%'),
      'Extension group must be complete, not a clipped resize frame',
    );
  }
  for (const line of footer) {
    assert.equal(
      visibleWidth(line),
      snapshot.frame.cols,
      'Right-hand fields reach the right edge',
    );
    assert.doesNotMatch(
      line,
      /[A-Z]|\||^ · | · $|·  |  ·/u,
      'Lowercase sample labels and clean dot separators',
    );
    assert.equal(
      line.split(/ {2,}/u).length,
      2,
      'Exactly one elastic gap separates the two zones',
    );
    if (line.includes('ctx')) assert.match(line, /ctx 31% ━{10}/u);
  }
  assert.ok(
    lines.slice(start + 2).every(line => line.trim() === ''),
    'Exactly two footer rows',
  );
  const path = join(output, name);
  assert.ok(snapshot.ansi);
  await writeFile(`${path}.ansi`, snapshot.ansi);
  await writeFile(`${path}.txt`, snapshot.text);
  const png = Bun.spawn(
    [
      terminalBinary,
      'save',
      '--input',
      `${path}.ansi`,
      '--cols',
      String(snapshot.frame.cols),
      '--rows',
      String(snapshot.frame.rows),
      '--format',
      'png',
      '--out',
      `${path}.png`,
      '--font-family',
      font,
      '--cell-width',
      '9',
      '--cell-height',
      '18',
      '--padding',
      '2',
      '--pixel-ratio',
      '1',
    ],
    {cwd: root, stdout: 'ignore', stderr: 'inherit'},
  );
  assert.equal(await png.exited, 0);
  return footer.join('\n');
}

await runEffect(async () => {
  await mkdir(output, {recursive: true});
  const terminal = await TerminalControl.make({binaryPath: terminalBinary});
  const evidence: string[] = [];
  try {
    for (const theme of themes) {
      for (const scenario of scenarios) {
        const host = await createHost(scenario, theme, true);
        try {
          const session = await terminal.launch({
            command: host.command,
            cwd: host.directory,
            env: host.env,
            inheritEnv: false,
            host: 'opentui',
            viewport: {cols: 150, rows: 16},
          });
          try {
            await session.screen.waitForText(
              'Ready for review before committing.',
              {timeoutMs: 20000},
            );
            await session.screen.waitForText('ctx 31%', {timeoutMs: 5000});
            await session.keyboard.type(
              'Review the changes before committing.',
            );
            await session.screen.waitForText(
              'Review the changes before committing.',
              {timeoutMs: 5000},
            );
            const wide = await capture(session, `${theme}-${scenario}-150`);
            evidence.push(`${theme}/${scenario}/150: ${wide}`);
            for (const cols of [100, 80, 50, 150]) {
              await session.resize({cols, rows: 16});
              await session.screen.waitForIdle({
                quietForMs: 200,
                timeoutMs: 5000,
              });
              const footer = await capture(
                session,
                `${theme}-${scenario}-${cols}`,
              );
              evidence.push(`${theme}/${scenario}/${cols}: ${footer}`);
              assert.ok(
                footer.startsWith(
                  scenario === 'long'
                    ? '~/dev/研究工具/pi-stuff-statusline'
                    : '~/dev/pi-stuff',
                ),
              );
              if (scenario === 'base') assert.match(footer, /main · clean/u);
              else {
                assert.ok(
                  footer.includes(
                    scenario === 'long'
                      ? 'codex/statusline-responsive-prototype'
                      : 'main',
                  ),
                  'Full branch survives every tested width',
                );
                assert.ok(
                  footer.includes(
                    scenario === 'long' ? '+1 ~1 !1' : '+1 ~1 ?1',
                  ),
                  'All working-tree counters survive every tested width',
                );
              }
              if (scenario !== 'base')
                assert.ok(
                  footer.includes('↑2 ↓1'),
                  'Both divergence counters survive',
                );
              if (scenario !== 'long' || cols >= 100) {
                assert.match(footer, /hit 83\.8%/u);
                assert.match(footer, /ctx 31% ━{10}/u);
              }
              if (cols === 150)
                assert.equal(footer, wide, 'Fields must restore after resize');
            }
            // Submit the edited draft, interrupt real streaming, then submit again.
            await session.keyboard.press('Backspace');
            await session.keyboard.type('!');
            await session.keyboard.press('Enter');
            await session.screen.waitForText(
              'Review the changes before committing!',
              {timeoutMs: 5000},
            );
            await session.screen.waitForText('Working', {timeoutMs: 5000});
            await session.keyboard.press('Escape');
            await session.screen.waitForText(/aborted/iu, {timeoutMs: 5000});
            await session.keyboard.type('Run the checks again.');
            await session.keyboard.press('Enter');
            await session.screen.waitForText('ctx 32%', {timeoutMs: 5000});
            evidence.push(
              `${theme}/${scenario}: editing, submit, cancel, resubmit passed`,
            );
          } catch (error) {
            console.error(await session.screen.text());
            throw error;
          } finally {
            await session.stop();
          }
        } finally {
          await host.cleanup();
        }
      }
    }
  } finally {
    await terminal.close();
    await writeFile(
      join(output, 'verification.txt'),
      `${evidence.join('\n')}\n`,
    );
  }
  console.log(evidence.join('\n'));
});
