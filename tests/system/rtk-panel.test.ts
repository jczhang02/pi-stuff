import {test, expect} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';
import {access, writeFile, readFile, unlink, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {expectUsageLayout} from './rtk-usage-helpers';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function panelBounds(
  screen: string,
  title: string,
):
  | {lines: string[]; titleIndex: number; top: number; bottom: number}
  | undefined {
  const lines = screen.split(/\r?\n/u);
  const titleIndex = lines.findIndex(
    (line, index) =>
      line.includes(title) &&
      index > 0 &&
      (lines[index - 1]?.trim().startsWith('─') ||
        lines[index - 2]?.trim().startsWith('─')),
  );
  if (titleIndex < 0) return undefined;
  let top = -1;
  for (let index = titleIndex - 1; index >= 0; index--) {
    if (lines[index]?.trim().startsWith('─')) {
      top = index;
      break;
    }
  }
  const bottom = lines.findIndex(
    (line, index) => index > titleIndex && line.trim().startsWith('─'),
  );
  return top < 0 || bottom < 0 ? undefined : {lines, titleIndex, top, bottom};
}

function panelHeight(screen: string, title: string): number {
  const panel = panelBounds(screen, title);
  return panel === undefined ? 0 : panel.bottom - panel.top + 1;
}

function panelLineOffset(screen: string, title: string, text: string): number {
  const panel = panelBounds(screen, title);
  if (panel === undefined) return -1;
  const lineIndex = panel.lines.findIndex(
    (line, index) =>
      index > panel.titleIndex && index < panel.bottom && line.includes(text),
  );
  return lineIndex < 0 ? -1 : lineIndex - panel.titleIndex;
}

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

test('RTK native home honors selection remaps while reports retain their existing Escape control', async () => {
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
    expect(await host.terminal.screen.text()).toContain(
      'k/j navigate  ctrl+y select  ctrl+g back',
    );
    await host.terminal.keyboard.type('jj');
    await host.terminal.keyboard.press('Control+Y');
    await host.terminal.screen.waitForText('RTK / Diagnostics', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.press('Control+G');
    await host.terminal.screen.waitForText('RTK / Diagnostics', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Configure RTK and inspect usage.', {
      timeoutMs: 3000,
    });
  } finally {
    await host.close();
  }
}, 30000);

test('RTK executable editor keeps Escape while its size notice honors native cancellation', async () => {
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
    await host.command('/rtk integration');
    await host.terminal.screen.waitForText('RTK / Settings', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.type('jj');
    await host.terminal.keyboard.press('Control+Y');
    await host.terminal.screen.waitForText('Automatic discovery', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.type('j');
    await host.terminal.keyboard.press('Control+Y');
    await host.terminal.screen.waitForText('Enter an absolute RTK path.', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Automatic discovery', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      screen => !screen.text.includes('RTK executable'),
      {timeoutMs: 3000},
    );
    expect(await host.terminal.screen.text()).toContain('RTK / Settings');
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

test('RTK cancels a root usage query before opening Settings', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-slow-root-fixture');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  gain)
    touch '${host.directory}/root-started'
    sleep 2
    touch '${host.directory}/root-finished'
    printf '%s' 'stale-root-error' >&2
    exit 7
    ;;
  *) exit 2 ;;
esac
`,
      {mode: 0o700},
    );
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      JSON.stringify({rtk: {executable}}),
    );
    await host.reload();

    await host.command('/rtk');
    await host.terminal.screen.waitForText('Configure RTK and inspect usage.', {
      timeoutMs: 5000,
    });
    await host.terminal.screen.waitUntil(
      async () => exists(join(host.directory, 'root-started')),
      {timeoutMs: 3000},
    );
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('RTK / Settings', {
      timeoutMs: 3000,
    });
    await new Promise(resolve => setTimeout(resolve, 2500));
    expect(await exists(join(host.directory, 'root-finished'))).toBe(false);
    expect(await host.terminal.screen.text()).not.toContain('stale-root-error');
  } finally {
    await host.close();
  }
}, 30000);

test('RTK keeps short pages compact and each page stable during loading', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-layout-fixture');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) sleep 3; printf 'rtk 0.45.0' ;;
  gain) sleep 1; printf '%s' '{"summary":{"total_commands":3,"total_input":300,"total_output":150,"total_saved":150,"avg_savings_pct":50.0,"total_time_ms":300,"avg_time_ms":100}}' ;;
  config) sleep 1; printf '%s\n' 'Native RTK config' 'config_line = "stable"' ;;
  *) exit 2 ;;
esac
`,
      {mode: 0o700},
    );
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      JSON.stringify({rtk: {executable}}),
    );
    await host.reload();

    await host.command('/rtk');
    await host.terminal.screen.waitForText('Configure RTK and inspect usage.', {
      timeoutMs: 5000,
    });
    await host.terminal.screen.waitForText('refreshing', {timeoutMs: 3000});
    const rootLoadingScreen = await host.terminal.screen.text();
    const rootHeight = panelHeight(rootLoadingScreen, 'RTK');
    expect(rootHeight).toBeGreaterThan(0);
    expect(rootHeight).toBeLessThanOrEqual(17);
    const rootLoadingFooter = panelLineOffset(
      rootLoadingScreen,
      'RTK',
      'enter select  escape/ctrl+c back',
    );
    expect(rootLoadingFooter).toBeGreaterThan(0);
    const rootLoadingSettings = panelLineOffset(
      rootLoadingScreen,
      'RTK',
      'Settings',
    );
    expect(rootLoadingSettings).toBeGreaterThan(0);

    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('RTK / Settings', {
      timeoutMs: 3000,
    });
    await host.terminal.screen.waitForText('checking', {timeoutMs: 3000});
    const settingsPendingScreen = await host.terminal.screen.text();
    const settingsHeight = panelHeight(settingsPendingScreen, 'RTK / Settings');
    expect(settingsHeight).toBeGreaterThan(0);
    expect(settingsHeight).toBeLessThan(22);
    const settingsControl = panelLineOffset(
      settingsPendingScreen,
      'RTK / Settings',
      'Command rewrite',
    );
    expect(settingsControl).toBeGreaterThan(0);
    await host.terminal.screen.waitForText('0.45.0', {timeoutMs: 5000});
    const settingsReadyScreen = await host.terminal.screen.text();
    expect(panelHeight(settingsReadyScreen, 'RTK / Settings')).toBe(
      settingsHeight,
    );
    expect(
      panelLineOffset(settingsReadyScreen, 'RTK / Settings', 'Command rewrite'),
    ).toBe(settingsControl);

    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Configure RTK and inspect usage.', {
      timeoutMs: 3000,
    });
    await host.terminal.screen.waitForText('3 commands', {timeoutMs: 5000});
    const rootReadyScreen = await host.terminal.screen.text();
    expect(panelHeight(rootReadyScreen, 'RTK')).toBe(rootHeight);
    expect(
      panelLineOffset(
        rootReadyScreen,
        'RTK',
        'enter select  escape/ctrl+c back',
      ),
    ).toBe(rootLoadingFooter);
    expect(panelLineOffset(rootReadyScreen, 'RTK', 'Settings')).toBe(
      rootLoadingSettings,
    );
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Refreshing usage', {
      timeoutMs: 3000,
    });
    const loadingScreen = await host.terminal.screen.text();
    expectUsageLayout(
      loadingScreen,
      'Refreshing usage',
      'Global statistics or this working directory.',
    );
    expect(panelHeight(loadingScreen, 'RTK / Usage')).toBe(22);
    const loadingFooter = panelLineOffset(
      loadingScreen,
      'RTK / Usage',
      'r Refresh · Esc Back',
    );
    expect(loadingFooter).toBeGreaterThan(0);
    await host.terminal.screen.waitForText('Total commands', {
      timeoutMs: 5000,
    });
    const readyScreen = await host.terminal.screen.text();
    expectUsageLayout(
      readyScreen,
      'Total commands',
      'Global statistics or this working directory.',
    );
    expect(panelHeight(readyScreen, 'RTK / Usage')).toBe(22);
    const readyFooter = panelLineOffset(
      readyScreen,
      'RTK / Usage',
      'r Refresh · Esc Back',
    );
    expect(readyFooter).toBe(loadingFooter);
    await host.terminal.resize({cols: 56, rows: 26});
    const narrowUsageScreen = await host.terminal.screen.text();
    expectUsageLayout(
      narrowUsageScreen,
      'Total commands',
      'Global statistics or this working directory.',
    );
    expect(panelHeight(narrowUsageScreen, 'RTK / Usage')).toBe(22);

    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Configure RTK and inspect usage.', {
      timeoutMs: 3000,
    });
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('RTK / Diagnostics', {
      timeoutMs: 3000,
    });
    expect(
      panelHeight(await host.terminal.screen.text(), 'RTK / Diagnostics'),
    ).toBe(22);
  } finally {
    await host.close();
  }
}, 30000);

test('Settings refuses an external edit without changing the active ANSI policy', async () => {
  const host = await launchPi();
  try {
    await host.command('/rtk integration');
    await host.terminal.screen.waitForText('RTK / Settings', {timeoutMs: 3000});
    await host.terminal.resize({cols: 56, rows: 26});
    const before = await host.terminal.screen.text();
    const height = panelHeight(before, 'RTK / Settings');
    const control = panelLineOffset(
      before,
      'RTK / Settings',
      'Command rewrite',
    );
    const external = '{"rtk":{"rewrite":false}}';
    await writeFile(join(host.agent, 'pi-stuff.json'), external);
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Settings changed on disk.', {
      timeoutMs: 3000,
    });
    const failed = await host.terminal.screen.text();
    expect(panelHeight(failed, 'RTK / Settings')).toBeGreaterThanOrEqual(
      height,
    );
    expect(panelLineOffset(failed, 'RTK / Settings', 'Command rewrite')).toBe(
      control,
    );
    await host.terminal.keyboard.press('ArrowDown');
    const shorterDescription = await host.terminal.screen.text();
    expect(panelHeight(shorterDescription, 'RTK / Settings')).toBeGreaterThan(
      0,
    );
    expect(
      panelLineOffset(shorterDescription, 'RTK / Settings', 'Command rewrite'),
    ).toBe(control);
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
    await host.terminal.resize({cols: 56, rows: 26});
    const editorHeight = panelHeight(
      await host.terminal.screen.text(),
      'RTK / Settings',
    );
    expect(editorHeight).toBeLessThanOrEqual(12);
    const invalid = join(host.directory, 'invalid-rtk');
    await writeFile(invalid, '#!/bin/sh\nsleep 1\nexit 1\n', {mode: 0o700});
    await host.terminal.keyboard.type(invalid);
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Validating and saving...', {
      timeoutMs: 3000,
    });
    expect(
      panelHeight(await host.terminal.screen.text(), 'RTK / Settings'),
    ).toBe(editorHeight);
    await host.terminal.screen.waitForText('did not report', {
      timeoutMs: 3000,
    });
    expect(
      panelHeight(await host.terminal.screen.text(), 'RTK / Settings'),
    ).toBe(editorHeight);
    await host.terminal.keyboard.press('Control+U');
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

test('a repeated native toggle during save settles to the committed RTK value', async () => {
  const host = await launchPi();
  let writer: ReturnType<typeof Bun.spawn> | undefined;
  try {
    await host.command('/rtk integration');
    await host.terminal.screen.waitForText('Command rewrite', {
      timeoutMs: 4000,
    });
    const path = join(host.agent, 'pi-stuff.json');
    await unlink(path);
    expect(Bun.spawnSync(['mkfifo', path]).exitCode).toBe(0);
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitUntil(
      async () =>
        (await readdir(host.agent)).some(file => file.endsWith('.tmp')),
      {timeoutMs: 4000},
    );
    await host.terminal.keyboard.press('Enter');
    writer = Bun.spawn(
      ['sh', '-c', 'printf %s "$2" > "$1"', 'rtk-fixture', path, '{}'],
      {stdout: 'ignore', stderr: 'pipe'},
    );
    expect(await writer.exited).toBe(0);
    await host.terminal.screen.waitForText('RTK setting saved.', {
      timeoutMs: 4000,
    });
    expect(await readFile(path, 'utf8')).toContain('"rewrite": false');
    expect(await host.terminal.screen.text()).toMatch(
      /Command rewrite\s+disabled/u,
    );
    await host.terminal.keyboard.press('Control+C');
    await host.terminal.screen.waitForText('Configure RTK', {timeoutMs: 4000});
  } finally {
    writer?.kill();
    await host.close();
  }
}, 30000);
