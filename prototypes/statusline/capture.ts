// One-shot terminal exercise and evidence capture, not a permanent test suite.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {TerminalControl} from '@kitlangton/terminal-control';
import type {Session} from '@kitlangton/terminal-control';
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
    snapshot =>
      snapshot.text
        .split('\n')
        .some(line => line.startsWith('~/dev/') && line.includes('hit 83.8%')),
    {timeoutMs: 5000},
  );
  const snapshot = await session.screen.capture({
    settleMs: 200,
    deadlineMs: 3000,
    includeAnsi: true,
  });
  assert.equal(snapshot.frame.rows, 50);
  const lines = snapshot.text.split('\n');
  const footer = lines.filter(line => line.includes('hit 83.8%'));
  assert.equal(footer.length, 1, snapshot.text);
  const text = footer[0]?.trimEnd() ?? '';
  assert.doesNotMatch(
    text,
    / {2}|\|/u,
    'No repeated spaces or separator clutter',
  );
  if (text.includes('ctx')) assert.match(text, /ctx 31% ━{10}/u);
  assert.doesNotMatch(footer[0] ?? '', /\+\d/u);
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
  return footer[0] ?? '';
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
            viewport: {cols: 150, rows: 50},
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
            const wide = await capture(session, `${theme}-${scenario}-150`);
            evidence.push(`${theme}/${scenario}/150: ${wide}`);
            for (const cols of [100, 80, 50, 150]) {
              await session.resize({cols, rows: 50});
              await session.screen.waitForIdle({
                quietForMs: 200,
                timeoutMs: 5000,
              });
              const footer = await capture(
                session,
                `${theme}-${scenario}-${cols}`,
              );
              evidence.push(`${theme}/${scenario}/${cols}: ${footer}`);
              if (cols === 50) {
                if (scenario === 'long') {
                  assert.equal(
                    footer.trimEnd(),
                    '~/dev/研究工具/pi-stuff-statusline hit 83.8%',
                  );
                } else {
                  assert.match(
                    footer,
                    /^~\/dev\/pi-stuff main\* ctx 31% ━{10} hit 83\.8%\s*$/u,
                  );
                }
              }
              assert.ok(
                footer.startsWith(
                  scenario === 'long'
                    ? '~/dev/研究工具/pi-stuff-statusline '
                    : '~/dev/pi-stuff ',
                ),
              );
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
