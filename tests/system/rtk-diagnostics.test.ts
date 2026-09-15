import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Diagnostics displays the resolved executable and bounded native config', async () => {
  const host = await launchPi();
  try {
    const executable = join(
      host.directory,
      `${'diagnostics-'.padEnd(116, 'x')}-fixture`,
    );
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  config)
    printf '\\033[31mNative RTK config\\033[0m\\n'
    printf 'hook_install_hint = "do not execute suggestions"\\n'
    i=0
    while [ "$i" -lt 40 ]; do
      printf 'config_line_%02d = "read only"\\n' "$i"
      i=$((i + 1))
    done
    printf 'config_tail = "visible after scrolling"\\n'
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

    await host.command('/rtk diagnostics');
    await host.terminal.screen.waitForText('RTK / Diagnostics', {
      timeoutMs: 5000,
    });
    await host.terminal.screen.waitForText('Native RTK config', {
      timeoutMs: 5000,
    });
    let screen = await host.terminal.screen.text();
    expect(screen).toContain('0.45.0');
    expect(screen).toContain('custom');
    expect(screen).toContain(executable.slice(0, 40));
    expect(screen).toContain(
      'hook_install_hint = "do not execute suggestions"',
    );
    expect(screen).not.toContain('\x1b[31m');

    await host.terminal.screen.waitForText('Page 1/', {timeoutMs: 5000});
    await host.terminal.keyboard.press('PageDown');
    await host.terminal.screen.waitForText('Page 1/', {timeoutMs: 3000});
    await host.terminal.keyboard.type(']'.repeat(20));
    await host.terminal.screen.waitForText('config_tail', {timeoutMs: 3000});
    screen = await host.terminal.screen.text();
    expect(screen).toContain('config_tail = "visible after scrolling"');
    expect(screen).toContain('[ Previous');
  } finally {
    await host.close();
  }
}, 30000);

test('Diagnostics keeps rewrite failures separate from native parser output', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-diagnostics-failure-fixture');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  rewrite) printf 'rewrite preparation failed' >&2; exit 7 ;;
  config)
    printf '\\033[32mRTK Parse Failures\\033[0m\\n'
    printf 'native parser failure: malformed report\\n'
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

    await host.invoke('bash', JSON.stringify({command: 'printf ORIGINAL'}));
    await host.command('/rtk diagnostics');
    await host.terminal.screen.waitForText('Last integration rewrite failure', {
      timeoutMs: 5000,
    });
    const screen = await host.terminal.screen.text();
    const failureStart = screen.indexOf('Last integration rewrite failure');
    const configStart = screen.indexOf('Native RTK config');
    expect(failureStart).toBeGreaterThanOrEqual(0);
    expect(configStart).toBeGreaterThan(failureStart);
    expect(screen.slice(failureStart, configStart)).toContain(
      'RTK exited with code 7: rewrite preparation failed',
    );
    expect(screen.slice(configStart)).toContain('RTK Parse Failures');
    expect(screen.slice(configStart)).toContain('native parser failure');
  } finally {
    await host.close();
  }
}, 30000);

test('Escape cancels a pending diagnostics read before stale config appears', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-diagnostics-slow-fixture');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  config) sleep 2; printf 'late config output\\n' ;;
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

    await host.command('/rtk diagnostics');
    await host.terminal.screen.waitForText('Refreshing diagnostics', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      async () =>
        !(await host.terminal.screen.text()).includes('RTK / Diagnostics'),
      {timeoutMs: 3000},
    );
    expect(await host.terminal.screen.text()).toContain(
      'Configure RTK and inspect usage.',
    );
  } finally {
    await host.close();
  }
}, 30000);
