// Protocol regression: the foreground mirror must never write palette mutations.
import {TerminalControl} from '@kitlangton/terminal-control';
import {join} from 'node:path';
import {SettingsManager} from '@earendil-works/pi-coding-agent';
import {terminalBinary, root, runEffect} from './launch';
await runEffect(async () => {
  const driver = await TerminalControl.make({binaryPath: terminalBinary});
  try {
    for (const mode of [
      'inherited',
      'light',
      'dark',
      'cancel',
      'kitty-live',
      'kitty-replay',
    ] as const) {
      const live = mode === 'kitty-live';
      const replay = mode === 'cancel' || mode === 'kitty-replay';
      const name = `pi-palette-${process.pid}-${mode}`;
      const session = await driver.launch({
        command: [
          process.execPath,
          join(import.meta.dir, 'run.ts'),
          live ? 'live' : replay ? 'replay' : 'thoughts',
          '--name',
          name,
          ...(mode === 'inherited'
            ? []
            : [
                '--theme',
                mode === 'light' ? 'catppuccin-latte' : 'catppuccin-mocha',
              ]),
        ],
        cwd: root,
        host: 'opentui',
        viewport: {cols: 100, rows: 36},
      });
      try {
        if (live) {
          await session.screen.waitForText('Welcome back!', {timeoutMs: 15000});
          await session.keyboard.press('Enter');
        }
        await session.screen.waitForText(
          live
            ? 'Running'
            : replay
              ? 'Checking pagination'
              : SettingsManager.create(root).getHideThinkingBlock()
                ? 'Thoughts · 4s'
                : 'Thoughts:',
          {timeoutMs: 15000},
        );
        if (live || replay) {
          if (mode.startsWith('kitty'))
            await session.keyboard.write(
              new TextEncoder().encode('\u001b[27u'),
            );
          else await session.keyboard.press('Escape');
          await session.screen.waitForText('Operation aborted', {
            timeoutMs: 5000,
          });
        }
        await session.keyboard.press('Control+D');
        const exit = await session.waitForExit({timeoutMs: 10000});
        if (exit.reason !== 'exited' || !exit.exit.success)
          throw new Error(`${mode}: foreground did not exit cleanly`);
        const bytes = await session.transcript.ansi();
        const output = new TextDecoder().decode(bytes);
        const osc = output
          .split('\u001b]')
          .slice(1)
          .map(
            sequence => sequence.split('\u0007')[0]?.split('\u001b\\')[0] ?? '',
          );
        const mutations = osc.filter(
          value =>
            /^(?:4|10|11|12|104|110|111|112)(?:;|$)/u.test(value) &&
            !value.endsWith(';?'),
        );
        if (mutations.length)
          throw new Error(`${mode}: palette mutation ${mutations.join(', ')}`);
        console.log(`${mode}: clean exit, no outer palette setters or resets`);
      } finally {
        await session.stop();
      }
    }
  } finally {
    await driver.close();
  }
});
