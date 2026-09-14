import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

test('Pi executes a rewrite through the selected absolute RTK path', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, "rtk tool's");
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0';;
  rewrite) printf 'rtk fixture';;
  fixture) printf '\\033[32mCOMPACT\\033[0m\\n';;
  *) exit 2;;
esac
`,
      {mode: 0o700},
    );
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      JSON.stringify({rtk: {executable}}),
    );
    await host.reload();
    expect(await host.terminal.screen.text()).not.toContain(
      'Invalid or unreadable pi-stuff.json',
    );
    expect(
      await host.invoke('bash', JSON.stringify({command: 'printf RAW'})),
    ).toBe('COMPACT\n');
  } finally {
    await host.close();
  }
}, 30000);

test('Pi accepts an advisory RTK rewrite without treating it as a failure', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-advisory');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0';;
  rewrite) printf 'rtk fixture'; exit 3;;
  fixture) printf 'ADVISORY_OK\\n';;
  *) exit 2;;
esac
`,
      {mode: 0o700},
    );
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      JSON.stringify({rtk: {executable}}),
    );
    await host.reload();
    expect(
      await host.invoke('bash', JSON.stringify({command: 'printf RAW'})),
    ).toBe('ADVISORY_OK\n');
  } finally {
    await host.close();
  }
}, 30000);

test('Pi keeps ANSI when cleanup is explicitly disabled', async () => {
  const host = await launchPi();
  try {
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      JSON.stringify({rtk: {ansi: false}}),
    );
    await host.reload();
    expect(await host.terminal.screen.text()).not.toContain(
      'Invalid or unreadable pi-stuff.json',
    );
    const output = await host.invoke(
      'bash',
      JSON.stringify({command: "printf '\\033[31mRED\\033[0m'"}),
    );
    expect(output).toBe('\x1b[31mRED\x1b[0m');
  } finally {
    await host.close();
  }
}, 30000);

test('Pi removes ANSI from the model-bound Bash result without RTK', async () => {
  const host = await launchPi();
  try {
    const output = await host.invoke(
      'bash',
      JSON.stringify({command: "printf '\\033[31mRED ERROR\\033[0m 中文\\n'"}),
    );
    expect(output).toBe('RED ERROR 中文\n');
  } finally {
    await host.close();
  }
}, 30000);

test('Pi binds every rewritten RTK position without changing command data', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, "rtk tool's");
    const pathReport = join(host.directory, 'rewrite-path');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0';;
  rewrite) printf '%s' "$PATH" > '${pathReport}'; printf "rtk fixture && 'rtk' fixture 'rtk'";;
  fixture) if [ "$2" = 'rtk' ] || [ -z "$2" ]; then printf 'ARG_OK\\n'; else printf 'ARG_CHANGED\\n'; fi;;
  *) exit 2;;
esac
`,
      {mode: 0o700},
    );
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      JSON.stringify({rtk: {executable}}),
    );
    await host.reload();
    expect(
      await host.invoke(
        'bash',
        JSON.stringify({command: 'git status && git diff'}),
      ),
    ).toBe('ARG_OK\nARG_OK\n');
    expect(await readFile(pathReport, 'utf8')).toBe('/usr/bin:/bin');
  } finally {
    await host.close();
  }
}, 30000);

test('Pi bypasses rewriting when the original command contains expansion', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-unsafe-original');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0';;
  rewrite) printf 'rtk changed';;
  changed) printf 'CHANGED';;
  *) exit 2;;
esac
`,
      {mode: 0o700},
    );
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      JSON.stringify({rtk: {executable}}),
    );
    await host.reload();
    expect(
      await host.invoke(
        'bash',
        JSON.stringify({command: 'printf "$(printf ORIGINAL)"'}),
      ),
    ).toBe('ORIGINAL');
  } finally {
    await host.close();
  }
}, 30000);

test('Pi leaves unsupported rewrites and invalid custom paths fail-open', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-unsupported');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0';;
  rewrite) exit 1;;
  *) exit 2;;
esac
`,
      {mode: 0o700},
    );
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      JSON.stringify({rtk: {executable}}),
    );
    await host.reload();
    expect(
      await host.invoke('bash', JSON.stringify({command: 'printf ORIGINAL'})),
    ).toBe('ORIGINAL');

    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      JSON.stringify({rtk: {executable: join(host.directory, 'missing-rtk')}}),
    );
    await host.reload();
    expect(
      await host.invoke('bash', JSON.stringify({command: 'printf STILL_RAW'})),
    ).toBe('STILL_RAW');
  } finally {
    await host.close();
  }
}, 30000);

test('Pi deduplicates rewrite failure notices until reload', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-notify-failure');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0';;
  rewrite) printf 'fixture rewrite failed' >&2; exit 7;;
  *) exit 2;;
esac
`,
      {mode: 0o700},
    );
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      JSON.stringify({rtk: {executable}}),
    );
    await host.reload();
    await host.invoke('bash', JSON.stringify({command: 'printf FIRST'}));
    await host.terminal.screen.waitForText('RTK rewrite failed', {
      timeoutMs: 5000,
    });
    await host.invoke('bash', JSON.stringify({command: 'printf SECOND'}));
    let screen = await host.terminal.screen.text();
    expect(screen.match(/RTK rewrite failed/gu)?.length).toBe(1);

    await host.reload();
    await host.invoke('bash', JSON.stringify({command: 'printf THIRD'}));
    await host.terminal.screen.waitForText('RTK rewrite failed', {
      timeoutMs: 5000,
    });
    screen = await host.terminal.screen.text();
    expect(screen.match(/RTK rewrite failed/gu)?.length).toBe(1);
  } finally {
    await host.close();
  }
}, 30000);

test('Pi cancellation blocks raw fallback and its side effects', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-cancel');
    const rewriteStarted = join(host.directory, 'rewrite-started');
    const rawSideEffect = join(host.directory, 'raw-side-effect');
    const rewriteSideEffect = join(host.directory, 'rewrite-side-effect');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0';;
  rewrite) printf started > '${rewriteStarted}'; sleep 1; printf 'REWRITE_SIDE_EFFECT' > '${rewriteSideEffect}'; printf 'rtk raw';;
  raw) printf 'RAW_FROM_RTK';;
  *) exit 2;;
esac
`,
      {mode: 0o700},
    );
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      JSON.stringify({rtk: {executable}}),
    );
    await host.reload();
    await host.start(
      'bash',
      JSON.stringify({command: `printf ORIGINAL > '${rawSideEffect}'`}),
    );
    await host.terminal.screen.waitUntil(
      async () => {
        try {
          await readFile(rewriteStarted, 'utf8');
          return true;
        } catch {
          return false;
        }
      },
      {timeoutMs: 5000},
    );
    await host.terminal.keyboard.press('Escape');
    await new Promise<void>(resolve => setTimeout(resolve, 1_250));
    await expect(readFile(rawSideEffect, 'utf8')).rejects.toThrow();
    await expect(readFile(rewriteSideEffect, 'utf8')).rejects.toThrow();
  } finally {
    await host.close();
  }
}, 30000);

test('Pi does not execute or replay the original command after RTK starts it', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-failing');
    const counter = join(host.directory, 'counter');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0';;
  rewrite) printf 'rtk fail';;
  fail) count=$(cat '${counter}' 2>/dev/null || printf '0'); count=$((count + 1)); printf '%s' "$count" > '${counter}'; printf 'FAILED\\n'; exit 7;;
  *) exit 2;;
esac
`,
      {mode: 0o700},
    );
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      JSON.stringify({rtk: {executable}}),
    );
    await host.reload();
    await host.invoke(
      'bash',
      JSON.stringify({command: `printf ORIGINAL >> '${counter}'`}),
    );
    expect(await readFile(counter, 'utf8')).toBe('1');
  } finally {
    await host.close();
  }
}, 30000);

test.each([
  ['env FOO=bar', 'rtk'],
  ["'env' FOO=bar", 'rtk'],
  ['custom-wrapper', 'rtk'],
  ['custom-wrapper', "'rtk'"],
])(
  'Pi bypasses the whole rewrite when %s hides the %s executable position',
  async (wrapper, token) => {
    const host = await launchPi();
    try {
      const executable = join(host.directory, 'rtk-wrapped');
      const marker = join(host.directory, 'selected-command-started');
      const rewritten = `rtk fixture && ${wrapper} ${token} fixture`;
      const rewriteFile = join(host.directory, 'rewritten-command');
      await writeFile(rewriteFile, rewritten);
      await writeFile(
        executable,
        `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0';;
  rewrite) cat '${rewriteFile}';;
  fixture) printf STARTED > '${marker}'; printf COMPACT;;
  *) exit 2;;
esac
`,
        {mode: 0o700},
      );
      await writeFile(
        join(host.agent, 'pi-stuff.json'),
        JSON.stringify({rtk: {executable}}),
      );
      await host.reload();
      expect(
        await host.invoke(
          'bash',
          JSON.stringify({
            command: 'printf FIRST && env FOO=bar printf SECOND',
          }),
        ),
      ).toBe('FIRSTSECOND');
      await expect(readFile(marker, 'utf8')).rejects.toThrow();
    } finally {
      await host.close();
    }
  },
  30000,
);
