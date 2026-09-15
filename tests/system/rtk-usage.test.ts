import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

function reportBody(screen: string): string {
  const lines = screen.split(/\r?\n/u);
  const title = lines.findIndex(line => line.includes('RTK / Usage'));
  const page = lines.findIndex(
    (line, index) => index > title && /Page \d+\/\d+/u.test(line),
  );
  return title < 0 || page < 0 ? '' : lines.slice(title + 1, page).join('\n');
}

test('Usage renders the native RTK JSON summary', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-usage-fixture');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  gain)
    printf '%s' '{"summary":{"total_commands":37,"total_input":15432,"total_output":8120,"total_saved":7312,"avg_savings_pct":47.4,"total_time_ms":91800,"avg_time_ms":2481}}'
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

    await host.command('/rtk gain');
    await host.terminal.screen.waitForText('RTK / Usage', {timeoutMs: 5000});
    await host.terminal.screen.waitForText('Total commands', {timeoutMs: 5000});
    const screen = await host.terminal.screen.text();
    expect(screen).toContain('37');
    expect(screen).toContain('7.3k');
    expect(screen).toContain('Before RTK');
    expect(screen).toContain('After RTK');
    expect(screen).not.toContain('Input tokens');
    expect(screen).not.toContain('Output tokens');
    expect(screen).not.toContain('No report loaded.');
    await host.terminal.resize({cols: 56, rows: 26});
    await host.terminal.screen.waitForText('Estimated output tokens', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('billing');
  } finally {
    await host.close();
  }
}, 30000);

test('Usage renders native daily rows without treating missing data as zero', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-daily-fixture');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  gain)
    if [ "$2" = "--daily" ] || [ "$3" = "--daily" ]; then
      printf '%s' '{"summary":{"total_commands":43,"total_input":19876,"total_output":9234,"total_saved":10642,"avg_savings_pct":53.5,"total_time_ms":118000,"avg_time_ms":2744},"daily":['
      i=1
      while [ "$i" -le 11 ]; do
        if [ "$i" -gt 1 ]; then printf ','; fi
        printf '{"date":"2026-09-%02d","commands":%d,"input_tokens":%d,"output_tokens":%d,"saved_tokens":%d,"savings_pct":50.0,"total_time_ms":%d,"avg_time_ms":100}' "$i" "$i" "$((i * 100))" "$((i * 50))" "$((i * 50))" "$((i * 100))"
        i=$((i + 1))
      done
      printf '%s' ',{"date":"2026-09-15","commands":22,"input_tokens":9676,"output_tokens":4334,"saved_tokens":5342,"savings_pct":55.2,"total_time_ms":62000,"avg_time_ms":2818}]}'
    else
      printf '%s' '{"summary":{"total_commands":43,"total_input":19876,"total_output":9234,"total_saved":10642,"avg_savings_pct":53.5,"total_time_ms":118000,"avg_time_ms":2744}}'
    fi
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

    await host.command('/rtk gain');
    await host.terminal.screen.waitForText('Total commands', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Daily savings', {timeoutMs: 5000});
    let screen = await host.terminal.screen.text();
    expect(screen).toContain('Page 1/2');
    expect(screen).toContain('2026-09-01');
    expect(screen).not.toContain('2026-09-15');
    await host.terminal.keyboard.type(']');
    await host.terminal.screen.waitForText('2026-09-15', {timeoutMs: 5000});
    screen = await host.terminal.screen.text();
    expect(screen).toContain('22');
    expect(screen).toContain('5.3k');
    expect(screen).not.toContain('No Daily data');
    await host.terminal.keyboard.type('[');
    await host.terminal.screen.waitForText('Page 1/2', {timeoutMs: 5000});
    await host.terminal.resize({cols: 56, rows: 26});
    await host.terminal.screen.waitForText('Page 1/2', {timeoutMs: 5000});
    const narrow = await host.terminal.screen.text();
    expect(narrow).toContain('Page 1/2');
    expect(narrow).toContain('Rate');
    expect(narrow).toContain('r Refresh');
    expect(narrow).toContain('Esc Back');
    expect(narrow).toContain('2026-09-01');
    await host.terminal.keyboard.type(']');
    await host.terminal.screen.waitForText('Page 2/2', {timeoutMs: 5000});
    const lastPage = await host.terminal.screen.text();
    expect(lastPage).toContain('2026-09-15');
    expect(lastPage).toContain('55.2%');
    expect(lastPage).not.toContain('2026-09-01');
    await host.terminal.keyboard.type('[');
    await host.terminal.screen.waitForText('Page 1/2', {timeoutMs: 5000});
  } finally {
    await host.close();
  }
}, 30000);

test('Usage marks malformed native period data as unsupported', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-malformed-period-fixture');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  gain)
    if [ "$2" = "--daily" ]; then
      printf '%s' '{"summary":{"total_commands":2,"total_input":100,"total_output":50,"total_saved":50,"avg_savings_pct":50.0,"total_time_ms":1000,"avg_time_ms":500},"daily":[{"date":"2026-09-15","commands":2}]}'
    else
      printf '%s' '{"summary":{"total_commands":2,"total_input":100,"total_output":50,"total_saved":50,"avg_savings_pct":50.0,"total_time_ms":1000,"avg_time_ms":500}}'
    fi
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

    await host.command('/rtk gain');
    await host.terminal.screen.waitForText('Total commands', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Usage report unsupported', {
      timeoutMs: 5000,
    });
    const screen = await host.terminal.screen.text();
    expect(screen).toContain('unsupported JSON usage report');
    expect(screen).not.toContain('No daily usage recorded');
  } finally {
    await host.close();
  }
}, 30000);

test('Usage rejects blank native text reports as unsupported', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-blank-text-fixture');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  gain)
    case "$2:$3" in
      --history:*|*:--history|--failures:*|*:--failures) exit 0 ;;
      --daily:*|--weekly:*|--monthly:*|*:--daily|*:--weekly|*:--monthly) printf '%s' '{"summary":{"total_commands":3,"total_input":300,"total_output":150,"total_saved":150,"avg_savings_pct":50.0,"total_time_ms":300,"avg_time_ms":100},"daily":[{"date":"2026-09-15","commands":3,"input_tokens":300,"output_tokens":150,"saved_tokens":150,"savings_pct":50.0,"total_time_ms":300,"avg_time_ms":100}],"weekly":[{"week_start":"2026-09-15","week_end":"2026-09-21","commands":3,"input_tokens":300,"output_tokens":150,"saved_tokens":150,"savings_pct":50.0,"total_time_ms":300,"avg_time_ms":100}],"monthly":[{"month":"2026-09","commands":3,"input_tokens":300,"output_tokens":150,"saved_tokens":150,"savings_pct":50.0,"total_time_ms":300,"avg_time_ms":100}]}' ;;
      *) printf '%s' '{"summary":{"total_commands":3,"total_input":300,"total_output":150,"total_saved":150,"avg_savings_pct":50.0,"total_time_ms":300,"avg_time_ms":100}}' ;;
    esac
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

    await host.command('/rtk gain');
    await host.terminal.screen.waitForText('Total commands', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    for (const expected of [
      'Daily savings',
      'Weekly savings',
      'Monthly savings',
    ]) {
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText(expected, {timeoutMs: 5000});
    }
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Usage report unsupported', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain(
      'unsupported history report',
    );
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Refreshing usage', {
      timeoutMs: 5000,
    });
    await host.terminal.screen.waitForText('Usage report unsupported', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain(
      'unsupported parse-failure report',
    );
  } finally {
    await host.close();
  }
}, 30000);

test('Usage renders native history text with only fields RTK provides', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-history-fixture');
    const longCommand = `history-last-command-${'x'.repeat(120)}`;
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  gain)
    case "$2" in
      --history)
        printf '%s\n' 'RTK Token Savings (Global Scope)' 'Recent Commands' '──────────────────────────────────────────────────────────'
        printf '%s\n' '09-15 11:04 ▲ git status -83% (1.2k)' '09-15 10:41 ■ bun test -42% (540)' '09-15 10:20 ▲ this-command-name-is-intentionally-long-to-test-column-preservation -91% (2.7k)'
        i=6
        while [ "$i" -ge 1 ]; do
          printf '09-15 10:%02d ▲ command-%02d -60%% (%dk)\n' "$i" "$i" "$((i * 100))"
          i=$((i - 1))
        done
        printf '%s\n' '09-15 09:59 ▲ ${longCommand} -99% (9.9k)'
        ;;
      --daily|--weekly|--monthly)
        printf '%s' '{"summary":{"total_commands":3,"total_input":3000,"total_output":1500,"total_saved":1500,"avg_savings_pct":50.0,"total_time_ms":3000,"avg_time_ms":1000},"daily":[{"date":"2026-09-15","commands":3,"input_tokens":3000,"output_tokens":1500,"saved_tokens":1500,"savings_pct":50.0,"total_time_ms":3000,"avg_time_ms":1000}],"weekly":[{"week_start":"2026-09-15","week_end":"2026-09-21","commands":3,"input_tokens":3000,"output_tokens":1500,"saved_tokens":1500,"savings_pct":50.0,"total_time_ms":3000,"avg_time_ms":1000}],"monthly":[{"month":"2026-09","commands":3,"input_tokens":3000,"output_tokens":1500,"saved_tokens":1500,"savings_pct":50.0,"total_time_ms":3000,"avg_time_ms":1000}]}'
        ;;
      *)
        printf '%s' '{"summary":{"total_commands":3,"total_input":3000,"total_output":1500,"total_saved":1500,"avg_savings_pct":50.0,"total_time_ms":3000,"avg_time_ms":1000}}'
        ;;
    esac
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

    await host.command('/rtk gain');
    await host.terminal.screen.waitForText('Total commands', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    for (const expected of [
      'Daily savings',
      'Weekly savings',
      'Monthly savings',
      'Recent commands',
    ]) {
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText(expected, {timeoutMs: 5000});
    }
    const screen = await host.terminal.screen.text();
    expect(screen).toContain('09-15 11:04');
    expect(screen).toContain('git status');
    expect(screen).toContain('1.2k');
    expect(screen).toContain('83%');
    expect(screen).not.toContain('Input tokens');
    expect(screen).toContain('Page 1/2');
    await host.terminal.keyboard.type(']');
    await host.terminal.screen.waitForText('Page 2/2', {timeoutMs: 5000});
    const lastPage = await host.terminal.screen.text();
    expect(lastPage).toContain('9.9k');
    expect(
      reportBody(lastPage).replace(/\s+/gu, '').replace('9.9k99%', ''),
    ).toContain(longCommand);
    await host.terminal.resize({cols: 56, rows: 26});
    for (let index = 0; index < 20; index++)
      await host.terminal.keyboard.type('[');
    await host.terminal.screen.waitForText('Page 1/', {timeoutMs: 5000});
    const narrowFirst = await host.terminal.screen.text();
    expect(narrowFirst).toContain('Rate');
    expect(narrowFirst).toContain('r Refresh');
    expect(narrowFirst).toContain('Esc Back');
    for (let index = 0; index < 20; index++)
      await host.terminal.keyboard.type(']');
    await host.terminal.screen.waitUntil(
      screen => {
        const page = /Page (\d+)\/(\d+)/u.exec(screen.text);
        return page?.[1] === page?.[2];
      },
      {timeoutMs: 5000},
    );
    const narrowLast = await host.terminal.screen.text();
    expect(narrowLast).toContain('Page ');
    await host.terminal.keyboard.type('[');
    await host.terminal.screen.waitForText('Page 2/', {timeoutMs: 5000});
    const narrowMiddle = await host.terminal.screen.text();
    expect(narrowMiddle).toContain('9.9k');
    expect(
      `${reportBody(narrowMiddle)}${reportBody(narrowLast)}`
        .replace(/\s+/gu, '')
        .replace('9.9k99%', ''),
    ).toContain(longCommand);
  } finally {
    await host.close();
  }
}, 30000);

test('Usage keeps native failures global and restores the previous scope', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-failures-fixture');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  gain)
    case "$2:$3" in
      --failures:*|*:--failures)
        printf '%s' 'RTK Parse Failures
════════════════════════════════════════════════════════════

Total failures: 4
Recovery rate: 75.0%

Recent Failures (last 10)
  2026-09-15T11:04 [ok] git status
'
        ;;
      --daily:*|--weekly:*|--monthly:*|*:--daily|*:--weekly|*:--monthly)
        printf '%s' '{"summary":{"total_commands":4,"total_input":4000,"total_output":1000,"total_saved":3000,"avg_savings_pct":75.0,"total_time_ms":4000,"avg_time_ms":1000},"daily":[{"date":"2026-09-15","commands":4,"input_tokens":4000,"output_tokens":1000,"saved_tokens":3000,"savings_pct":75.0,"total_time_ms":4000,"avg_time_ms":1000}],"weekly":[{"week_start":"2026-09-15","week_end":"2026-09-21","commands":4,"input_tokens":4000,"output_tokens":1000,"saved_tokens":3000,"savings_pct":75.0,"total_time_ms":4000,"avg_time_ms":1000}],"monthly":[{"month":"2026-09","commands":4,"input_tokens":4000,"output_tokens":1000,"saved_tokens":3000,"savings_pct":75.0,"total_time_ms":4000,"avg_time_ms":1000}]}'
        ;;
      --history:*|*:--history)
        printf '%s' 'Recent Commands
09-15 11:04 ▲ git status -75% (3k)
'
        ;;
      *)
        printf '%s' '{"summary":{"total_commands":4,"total_input":4000,"total_output":1000,"total_saved":3000,"avg_savings_pct":75.0,"total_time_ms":4000,"avg_time_ms":1000}}'
        ;;
    esac
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

    await host.command('/rtk gain');
    await host.terminal.screen.waitForText('Total commands', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Scope  Project', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    for (const expected of [
      'Daily savings',
      'Weekly savings',
      'Monthly savings',
      'Recent commands',
      'Parse failures',
    ]) {
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText(expected, {timeoutMs: 5000});
    }
    let screen = await host.terminal.screen.text();
    expect(screen).toContain('Global · native RTK report · scope fixed');
    expect(screen).toContain('Total failures: 4');
    expect(screen).not.toContain('Scope  Project');

    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Total commands', {timeoutMs: 5000});
    screen = await host.terminal.screen.text();
    expect(screen).toContain('Scope  Project');
  } finally {
    await host.close();
  }
}, 30000);

test('Usage does not treat a command containing the empty marker as empty', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-failures-marker-fixture');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  gain)
    case "$2:$3" in
      --failures:*|*:--failures)
        printf '%s' 'RTK Parse Failures
════════════════════════════════════════════════════════════

Total failures: 1
Recovery rate: 0.0%

Recent Failures (last 10)
  2026-09-15T11:04 [FAIL] rg "No parse failures recorded." src
'
        ;;
      *)
        printf '%s' '{"summary":{"total_commands":1,"total_input":100,"total_output":50,"total_saved":50,"avg_savings_pct":50.0,"total_time_ms":100,"avg_time_ms":100}}'
        ;;
    esac
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

    await host.command('/rtk gain');
    await host.terminal.screen.waitForText('Total commands', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    for (let index = 0; index < 5; index++)
      await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Parse failures', {timeoutMs: 5000});
    let screen = await host.terminal.screen.text();
    expect(screen).toContain('Total failures: 1');
    expect(screen).toContain('Page 1/2');
    expect(screen).not.toContain('rg "No parse failures recorded." src');
    await host.terminal.keyboard.type(']');
    await host.terminal.screen.waitForText(
      'rg "No parse failures recorded." src',
      {
        timeoutMs: 5000,
      },
    );
    screen = await host.terminal.screen.text();
    expect(screen).toContain('rg "No parse failures recorded." src');
    expect(screen).not.toContain('No parse failures recorded\n');
  } finally {
    await host.close();
  }
}, 30000);

test('Usage recognizes the native empty parse-failure report', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-empty-failures-fixture');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  gain)
    case "$2:$3" in
      --failures:*|*:--failures)
        printf '%s\n' 'No parse failures recorded.' "This means all commands parsed successfully (or fallback hasn't triggered yet)."
        ;;
      *)
        printf '%s' '{"summary":{"total_commands":1,"total_input":100,"total_output":50,"total_saved":50,"avg_savings_pct":50.0,"total_time_ms":100,"avg_time_ms":100}}'
        ;;
    esac
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

    await host.command('/rtk gain');
    await host.terminal.screen.waitForText('Total commands', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    for (let index = 0; index < 5; index++)
      await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('No parse failures recorded', {
      timeoutMs: 5000,
    });
    const screen = await host.terminal.screen.text();
    expect(screen).toContain(
      'Global RTK reports no parser or fallback failures.',
    );
    expect(screen).not.toContain('Usage report unsupported');
  } finally {
    await host.close();
  }
}, 30000);

test('Usage bounds a long failures report and keeps controls visible when resized', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-long-failures-fixture');
    const longFailureTail = 'x'.repeat(260);
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  gain)
    case "$2:$3" in
      --failures:*|*:--failures)
        printf '%s\\n' 'RTK Parse Failures' '════════════════════════════════════════════════════════════' 'Total failures: 15' 'Recent Failures (last 10)' '  01 [ok] command-01' '  02 [ok] command-02' '  03 [ok] command-03' '  04 [ok] command-04' '  05 [ok] command-05' '  06 [ok] command-06' '  07 [ok] command-07' '  08 [ok] command-08' '  09 [ok] command-09' '  10 [ok] command-10' '  11 [ok] command-11' '  12 [ok] command-12' '  13 [ok] command-13' '  14 [ok] command-14' '  15 [ok] command-15 reason-${longFailureTail} TAIL_REASON'
        ;;
      --daily:*|--weekly:*|--monthly:*|*:--daily|*:--weekly|*:--monthly)
        printf '%s' '{"summary":{"total_commands":15,"total_input":15000,"total_output":6000,"total_saved":9000,"avg_savings_pct":60.0,"total_time_ms":15000,"avg_time_ms":1000},"daily":[{"date":"2026-09-15","commands":15,"input_tokens":15000,"output_tokens":6000,"saved_tokens":9000,"savings_pct":60.0,"total_time_ms":15000,"avg_time_ms":1000}],"weekly":[{"week_start":"2026-09-15","week_end":"2026-09-21","commands":15,"input_tokens":15000,"output_tokens":6000,"saved_tokens":9000,"savings_pct":60.0,"total_time_ms":15000,"avg_time_ms":1000}],"monthly":[{"month":"2026-09","commands":15,"input_tokens":15000,"output_tokens":6000,"saved_tokens":9000,"savings_pct":60.0,"total_time_ms":15000,"avg_time_ms":1000}]}'
        ;;
      --history:*|*:--history)
        printf '%s\\n' 'Recent Commands' '09-15 11:04 ▲ command-01 -60% (600)'
        ;;
      *)
        printf '%s' '{"summary":{"total_commands":15,"total_input":15000,"total_output":6000,"total_saved":9000,"avg_savings_pct":60.0,"total_time_ms":15000,"avg_time_ms":1000}}'
        ;;
    esac
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

    await host.command('/rtk gain');
    await host.terminal.screen.waitForText('Total commands', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    for (const expected of [
      'Daily savings',
      'Weekly savings',
      'Monthly savings',
      'Recent commands',
      'Parse failures',
    ]) {
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText(expected, {timeoutMs: 5000});
    }
    await host.terminal.resize({cols: 56, rows: 26});
    await host.terminal.screen.waitForText('Page 1/', {
      timeoutMs: 5000,
    });
    let screen = await host.terminal.screen.text();
    expect(screen).toContain('Display');
    expect(screen).toContain('r Refresh');
    expect(screen).toContain('Esc Back');
    expect(screen).not.toContain('command-15');
    expect(screen).not.toContain('PageDown');

    await host.terminal.keyboard.type('[');
    await host.terminal.screen.waitForText('Page 1/', {timeoutMs: 5000});
    await host.terminal.keyboard.type(']'.repeat(10));
    await host.terminal.screen.waitForText('TAIL_REASON', {timeoutMs: 5000});
    const lastFailurePage = await host.terminal.screen.text();
    screen = lastFailurePage;
    expect(screen).toContain('TAIL_REASON');
    expect(screen).toContain('Page ');
    expect(screen).toContain('[ Previous');
    await host.terminal.keyboard.type('[');
    await host.terminal.screen.waitForText('command-15', {timeoutMs: 5000});
    const commandPage = await host.terminal.screen.text();
    expect(commandPage).toContain('command-15');
    expect(
      `${reportBody(commandPage)}${reportBody(lastFailurePage)}`.replace(
        /\s+/gu,
        '',
      ),
    ).toContain(`command-15reason-${longFailureTail}TAIL_REASON`);
  } finally {
    await host.close();
  }
}, 30000);

test('Usage pages failures in native report order at both boundaries', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-paged-failures-fixture');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  gain)
    case "$2:$3" in
      --failures:*|*:--failures)
        printf '%s\\n' 'RTK Parse Failures' 'first failure' 'second failure' 'third failure' 'fourth failure' 'fifth failure' 'sixth failure' 'seventh failure' 'eighth failure' 'ninth failure' 'tenth failure' 'last failure marker'
        ;;
      *) printf '%s' '{"summary":{"total_commands":1,"total_input":100,"total_output":50,"total_saved":50,"avg_savings_pct":50.0,"total_time_ms":100,"avg_time_ms":100}}' ;;
    esac
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

    await host.command('/rtk gain');
    await host.terminal.screen.waitForText('Total commands', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    for (let index = 0; index < 5; index++)
      await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Parse failures', {
      timeoutMs: 5000,
    });
    await host.terminal.screen.waitForText('Page 1/', {timeoutMs: 5000});
    const firstPage = await host.terminal.screen.text();
    expect(firstPage).toContain('first failure');
    expect(firstPage).not.toContain('last failure marker');
    await host.terminal.keyboard.type(']');
    await host.terminal.screen.waitForText('last failure marker', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type(']');
    const lastPage = await host.terminal.screen.text();
    expect(lastPage).toContain('last failure marker');
    await host.terminal.keyboard.type('[');
    await host.terminal.screen.waitForText('first failure', {timeoutMs: 5000});
  } finally {
    await host.close();
  }
}, 30000);

test('Usage cancels a pending native report without painting stale data', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-cancel-fixture');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  gain)
    if [ "$2" = "--daily" ] || [ "$3" = "--daily" ]; then
      sleep 2
      printf '%s' '{"summary":{"total_commands":51,"total_input":5100,"total_output":2550,"total_saved":2550,"avg_savings_pct":50.0,"total_time_ms":5100,"avg_time_ms":1000},"daily":[{"date":"2026-09-15","commands":51,"input_tokens":5100,"output_tokens":2550,"saved_tokens":2550,"savings_pct":50.0,"total_time_ms":5100,"avg_time_ms":1000}]}'
    else
      printf '%s' '{"summary":{"total_commands":7,"total_input":700,"total_output":350,"total_saved":350,"avg_savings_pct":50.0,"total_time_ms":700,"avg_time_ms":1000}}'
    fi
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

    await host.command('/rtk gain');
    await host.terminal.screen.waitForText('Total commands', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Refreshing usage', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Configure RTK and inspect usage', {
      timeoutMs: 5000,
    });
    await new Promise(resolve => setTimeout(resolve, 2500));
    const screen = await host.terminal.screen.text();
    expect(screen).not.toContain('7 commands');
    expect(screen).not.toContain('2026-09-15');
    expect(screen).not.toContain('51');
  } finally {
    await host.close();
  }
}, 30000);
