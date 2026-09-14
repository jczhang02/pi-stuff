import {test, expect} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';
import {writeFile, readFile} from 'node:fs/promises';
import {join} from 'node:path';

test('RTK Settings saves ANSI choice and applies it to the next Bash result', async () => {
  const host = await launchPi();
  try {
    await host.command('/rtk');
    await host.terminal.screen.waitForText('Configure RTK and inspect usage.', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('RTK / Settings', {timeoutMs: 3000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('RTK setting saved.', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Configure RTK and inspect usage.', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      async () =>
        !(await host.terminal.screen.text()).includes(
          'Configure RTK and inspect usage.',
        ),
      {timeoutMs: 3000},
    );
    expect(
      await host.invoke(
        'bash',
        JSON.stringify({command: "printf '\\033[31mRED\\033[0m'"}),
      ),
    ).toBe('\x1b[31mRED\x1b[0m');
    await host.reload();
    expect(
      await host.invoke(
        'bash',
        JSON.stringify({command: "printf '\\033[31mRED\\033[0m'"}),
      ),
    ).toBe('\x1b[31mRED\x1b[0m');
  } finally {
    await host.close();
  }
}, 30000);

test('RTK follows remapped selection keys and remains escapable below its minimum size', async () => {
  const host = await launchPi();
  try {
    await writeFile(
      join(host.agent, 'keybindings.json'),
      JSON.stringify({
        'tui.select.down': 'j',
        'tui.select.up': 'k',
        'tui.select.confirm': 'ctrl+y',
        'tui.select.cancel': 'ctrl+g',
      }),
    );
    await host.command('/reload');
    await host.terminal.screen.waitForText('Reloaded keybindings', {
      timeoutMs: 5000,
    });
    await host.command('/rtk');
    await host.terminal.screen.waitForText('Configure RTK and inspect usage.', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.type('jj');
    await host.terminal.keyboard.press('Control+Y');
    await host.terminal.screen.waitForText('RTK / Diagnostics', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.press('Control+G');
    await host.terminal.screen.waitForText('Configure RTK and inspect usage.', {
      timeoutMs: 3000,
    });
    await host.terminal.resize({cols: 45, rows: 20});
    await host.terminal.screen.waitForText('RTK needs more room', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.press('Control+G');
    await host.terminal.screen.waitUntil(
      screen => !screen.text.includes('RTK needs more room'),
      {timeoutMs: 3000},
    );
  } finally {
    await host.close();
  }
}, 30000);

test('Settings refuses an external edit without changing the active ANSI policy', async () => {
  const host = await launchPi();
  try {
    await host.command('/rtk integration');
    await host.terminal.screen.waitForText('RTK / Settings', {timeoutMs: 3000});
    const external = '{"rtk":{"rewrite":false}}';
    await writeFile(join(host.agent, 'pi-stuff.json'), external);
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Settings changed on disk.', {
      timeoutMs: 3000,
    });
    expect(await readFile(join(host.agent, 'pi-stuff.json'), 'utf8')).toBe(
      external,
    );
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Configure RTK and inspect usage.', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      async () =>
        !(await host.terminal.screen.text()).includes(
          'Configure RTK and inspect usage.',
        ),
      {timeoutMs: 3000},
    );
    expect(
      await host.invoke(
        'bash',
        JSON.stringify({command: "printf '\\033[31mRED\\033[0m'"}),
      ),
    ).toBe('RED');
  } finally {
    await host.close();
  }
}, 30000);

test('Executable editor validates and persists an absolute RTK path', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, "my rtk's binary");
    await writeFile(
      executable,
      '#!/bin/sh\n[ "$1" = --version ] && printf \'rtk 0.45.0\'\n',
      {mode: 0o700},
    );
    await host.command('/rtk integration');
    await host.terminal.screen.waitForText('RTK / Settings', {timeoutMs: 3000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Automatic discovery', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Enter an absolute RTK path.', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.type(executable);
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('RTK setting saved.', {
      timeoutMs: 3000,
    });
    expect(await readFile(join(host.agent, 'pi-stuff.json'), 'utf8')).toContain(
      JSON.stringify(executable),
    );
    await host.terminal.screen.waitForText('0.45.0', {timeoutMs: 3000});
  } finally {
    await host.close();
  }
}, 30000);
