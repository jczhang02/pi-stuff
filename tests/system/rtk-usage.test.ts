import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';
import {
  collectReportPages,
  expectUsageLayout,
  foregroundFor,
  goToFirstReportPage,
  pageNumber,
  panelHeight,
  reportContent,
} from './rtk-usage-helpers';

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
    expectUsageLayout(
      screen,
      'Total commands',
      'Global statistics or this working directory.',
    );
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
    const narrow = await host.terminal.screen.text();
    expectUsageLayout(
      narrow,
      'Estimated output tokens',
      'Global statistics or this working directory.',
    );
    expect(narrow).toContain('billing');
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
    expectUsageLayout(screen, 'Daily savings', 'Native RTK gain report.');
    const firstPage = pageNumber(screen);
    expect(firstPage.current).toBe(1);
    expect(firstPage.total).toBeGreaterThan(1);
    expect(screen).toContain('2026-09-01');
    expect(screen).toContain('Daily savings');
    expect(screen).toContain('Date');
    expect(screen).toContain('Commands');
    expect(screen).toContain('Saved');
    expect(screen).toContain('Rate');
    expect(screen).not.toContain('2026-09-15');
    await host.terminal.keyboard.type(']');
    await host.terminal.screen.waitForText('2026-09-15', {timeoutMs: 5000});
    screen = await host.terminal.screen.text();
    expect(screen).toContain('22');
    expect(screen).toContain('5.3k');
    expect(screen).toContain('Daily savings');
    expect(screen).toContain('Date');
    expect(screen).toContain('Commands');
    expect(screen).toContain('Saved');
    expect(screen).toContain('Rate');
    expect(screen).not.toContain('No Daily data');
    await host.terminal.keyboard.type('[');
    await host.terminal.screen.waitForText(/Page 1\/\d+/u, {timeoutMs: 5000});
    await host.terminal.resize({cols: 56, rows: 26});
    await host.terminal.screen.waitForText(/Page 1\/\d+/u, {timeoutMs: 5000});
    const narrow = await host.terminal.screen.text();
    expectUsageLayout(narrow, 'Daily savings', 'Native RTK gain report.');
    expect(panelHeight(await host.terminal.screen.frame())).toBe(22);
    expect(pageNumber(narrow).current).toBe(1);
    expect(pageNumber(narrow).total).toBeGreaterThan(1);
    expect(narrow).toContain('Rate');
    expect(narrow).toContain('r Refresh');
    expect(narrow).toContain('Esc Back');
    expect(narrow).toContain('2026-09-01');
    await host.terminal.keyboard.type(']');
    await host.terminal.screen.waitForText(/Page 2\/\d+/u, {timeoutMs: 5000});
    const lastPage = await host.terminal.screen.text();
    expect(lastPage).toContain('2026-09-15');
    expect(lastPage).toContain('55.2%');
    expect(lastPage).not.toContain('2026-09-01');
    await host.terminal.keyboard.type('[');
    await host.terminal.screen.waitForText(/Page 1\/\d+/u, {timeoutMs: 5000});
  } finally {
    await host.close();
  }
}, 30000);

test('Usage repeats table headers on every page for all native report tables', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-table-header-fixture');
    const periodStats = Array.from({length: 12}, (_, index) => ({
      commands: index + 1,
      input_tokens: (index + 1) * 100,
      output_tokens: (index + 1) * 50,
      saved_tokens: (index + 1) * 50,
      savings_pct: 50,
      total_time_ms: (index + 1) * 100,
      avg_time_ms: 100,
    }));
    const report = JSON.stringify({
      summary: {
        total_commands: 78,
        total_input: 7800,
        total_output: 3900,
        total_saved: 3900,
        avg_savings_pct: 50,
        total_time_ms: 7800,
        avg_time_ms: 100,
      },
      daily: periodStats.map((stats, index) => ({
        date: `2026-09-${String(index + 1).padStart(2, '0')}`,
        ...stats,
      })),
      weekly: periodStats.map((stats, index) => ({
        week_start: `2026-09-${String(index + 1).padStart(2, '0')}`,
        week_end: `2026-09-${String(index + 7).padStart(2, '0')}`,
        ...stats,
      })),
      monthly: periodStats.map((stats, index) => ({
        month: `2026-${String(index + 1).padStart(2, '0')}`,
        ...stats,
      })),
    });
    const historyRows = Array.from(
      {length: 10},
      (_, index) =>
        `09-15 11:${String(14 - index).padStart(2, '0')} ▲ history-command-${index + 1}-${'x'.repeat(90)} -50% (${index + 1}00)`,
    );
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  gain)
    case "$2:$3" in
      *--history*) printf '%s\\n' 'Recent Commands' ${historyRows.map(row => `'${row}'`).join(' ')} ;;
      *) printf '%s' '${report}' ;;
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
    const tables = [
      {view: 'Daily', heading: 'Daily savings', label: 'Date'},
      {view: 'Weekly', heading: 'Weekly savings', label: 'Week'},
      {view: 'Monthly', heading: 'Monthly savings', label: 'Month'},
      {view: 'History', heading: 'Recent commands', label: 'Time'},
    ];
    for (const table of tables) {
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText(table.heading, {timeoutMs: 5000});
      expectUsageLayout(
        await host.terminal.screen.text(),
        table.heading,
        'Native RTK gain report.',
      );
      const pages = await collectReportPages(host.terminal);
      expect(pages.length).toBeGreaterThan(1);
      for (const page of pages) {
        expect(page).toContain(table.heading);
        expect(page).toContain(table.label);
        if (table.view !== 'History') expect(page).toContain('Commands');
        expect(page).toContain('Saved');
        expect(page).toContain('Rate');
      }
      expect(panelHeight(await host.terminal.screen.frame())).toBe(22);
    }
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
    expectUsageLayout(
      screen,
      'Usage report unsupported',
      'Native RTK gain report.',
    );
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
    let screen = await host.terminal.screen.text();
    expectUsageLayout(
      screen,
      'Usage report unsupported',
      'Native RTK gain report.',
    );
    expect(screen).toContain('unsupported history report');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Refreshing usage', {
      timeoutMs: 5000,
    });
    await host.terminal.screen.waitForText('Usage report unsupported', {
      timeoutMs: 5000,
    });
    screen = await host.terminal.screen.text();
    expectUsageLayout(
      screen,
      'Usage report unsupported',
      'Native RTK gain report.',
    );
    expect(screen).toContain('unsupported parse-failure report');
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
    let screen = await host.terminal.screen.text();
    expectUsageLayout(screen, 'Recent commands', 'Native RTK gain report.');
    expect(screen).toContain('09-15 11:04');
    expect(screen).toContain('git status');
    expect(screen).toContain('1.2k');
    expect(screen).toContain('83%');
    expect(screen).not.toContain('Input tokens');
    expect(screen).toContain('Recent commands');
    expect(screen).toContain('Time');
    expect(screen).toContain('Command');
    expect(screen).toContain('Saved');
    expect(screen).toContain('Rate');
    const pages = await collectReportPages(host.terminal);
    expect(pages.length).toBeGreaterThan(1);
    expect(
      reportContent(pages).replace(/\s+/gu, '').replace('9.9k99%', ''),
    ).toContain(longCommand);
    await host.terminal.resize({cols: 56, rows: 26});
    await goToFirstReportPage(host.terminal);
    const narrowFirstScreen = await host.terminal.screen.text();
    expectUsageLayout(
      narrowFirstScreen,
      'Recent commands',
      'Native RTK gain report.',
    );
    expect(panelHeight(await host.terminal.screen.frame())).toBe(22);
    const narrowPages = await collectReportPages(host.terminal);
    const narrowFirst = narrowPages[0] ?? '';
    expect(narrowFirst).toContain('Rate');
    expect(narrowFirstScreen).toContain('r Refresh');
    expect(narrowFirstScreen).toContain('Esc Back');
    expect(narrowFirstScreen).toContain('Page 1/');
    expect(
      reportContent(narrowPages).replace(/\s+/gu, '').replace('9.9k99%', ''),
    ).toContain(longCommand);
    expect(narrowPages.join('')).toContain('9.9k');
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

Top Commands (by frequency)
────────────────────────────────────────────────────────────
     4x  git status

Recent Failures (last 10)
────────────────────────────────────────────────────────────
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
    expectUsageLayout(
      await host.terminal.screen.text(),
      'Parse failures · Recent failures',
      'Native RTK gain report.',
    );
    const pages = await collectReportPages(host.terminal);
    expect(pages.length).toBeGreaterThan(1);
    const firstPage = pages[0] ?? '';
    const lastPage = pages.at(-1) ?? '';
    expect(firstPage).toContain('Parse failures · Recent failures');
    expect(firstPage).toContain('Global · 4 failures · 75% recovered');
    expect(firstPage).toContain('Recovered');
    expect(lastPage).toContain('Parse failures · Top commands');
    expect(lastPage).toContain('4');
    expect(pages.join('\n')).not.toContain('RTK Parse Failures');
    expect(pages.join('\n')).not.toContain('Total failures: 4');
    expect(pages.join('\n')).not.toContain('═');

    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Total commands', {timeoutMs: 5000});
    const screen = await host.terminal.screen.text();
    expectUsageLayout(screen, 'Total commands', 'Native RTK gain report.');
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
────────────────────────────────────────────────────────────
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
    const screen = await host.terminal.screen.text();
    expectUsageLayout(
      screen,
      'Parse failures · Recent failures',
      'Native RTK gain report.',
    );
    expect(screen).toContain('Parse failures · Recent failures');
    expect(screen).toContain('Global · 1 failures · 0% recovered');
    expect(screen).toContain('Failed');
    expect(screen).toContain('rg "No parse failures recorded." src');
    expect(screen).not.toContain('No parse failures recorded\n');
    expect(screen).not.toContain('RTK Parse Failures');
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
    expectUsageLayout(
      screen,
      'No parse failures recorded',
      'Native RTK gain report.',
    );
    expect(screen).toContain(
      'Global RTK reports no parser or fallback failures.',
    );
    expect(screen).not.toContain('Usage report unsupported');
  } finally {
    await host.close();
  }
}, 30000);

test('Usage renders structured native failures, preserves tails, and keeps semantic colors', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-long-failures-fixture');
    const payloadTail = 'FAILURE_PAYLOAD_TAIL';
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0' ;;
  gain)
    case "$2:$3" in
      --failures:*|*:--failures)
        printf '%s\\n' 'RTK Parse Failures' '════════════════════════════════════════════════════════════' '' 'Total failures:    15' 'Recovery rate:     60.0%' '' 'Top Commands (by frequency)' '────────────────────────────────────────────────────────────' '     3x  git status' '     3x  /bin/true' '     1x  rtk unsupported --flag' '     1x  custom-multiline-command' 'reason: first line' 'rea...' '     1x  command-with-a-deliberately-long-name-that-nati...' '     1x  command-15' '     1x  command-14' '     1x  command-13' '     1x  command-12' '     1x  command-11' '' 'Recent Failures (last 10)' '────────────────────────────────────────────────────────────' '  2026-09-15T10:14 [ok] command-15' '  2026-09-15T10:13 [FAIL] command-14' '  2026-09-15T10:12 [ok] command-13' '  2026-09-15T10:11 [FAIL] command-12' '  2026-09-15T10:10 [ok] command-11' '  2026-09-15T10:09 [FAIL] command-with-a-deliberately-long-name...' '  2026-09-15T10:08 [ok] custom-multiline-command' 'reason: firs...' '  2026-09-15T10:07 [FAIL] git status' '  2026-09-15T10:06 [ok] git status' '  2026-09-15T10:05 [FAIL] rtk unsupported --flag ${payloadTail}'
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
    const firstScreen = await host.terminal.screen.text();
    const firstFrame = await host.terminal.screen.frame();
    expectUsageLayout(
      firstScreen,
      'Parse failures · Recent failures',
      'Native RTK gain report.',
    );
    expect(panelHeight(firstFrame)).toBe(22);
    expect(firstScreen).toContain('Parse failures · Recent failures');
    expect(firstScreen).toContain('Global · 15 failures · 60% recovered');
    expect(firstScreen).toContain('r Refresh');
    expect(firstScreen).toContain('Esc Back');
    expect(firstScreen).not.toContain('PageDown');
    expect(foregroundFor(firstFrame, 'Recovered')).not.toBe(
      foregroundFor(firstFrame, 'Failed'),
    );

    const pages = await collectReportPages(host.terminal);
    expect(pages.length).toBeGreaterThan(2);
    for (const page of pages) expect(page).toContain('Parse failures · ');
    expect(
      pages.some(page => page.includes('Parse failures · Top commands')),
    ).toBe(true);
    const content = reportContent(pages);
    const normalizedContent = content.replace(/\s+/gu, '');
    expect(normalizedContent).toContain(payloadTail);
    expect(normalizedContent).toContain(
      'command-with-a-deliberately-long-name...',
    );
    expect(content).not.toContain('RTK Parse Failures');
    expect(content).not.toContain('Total failures:    15');
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
        printf '%s\\n' 'RTK Parse Failures' '════════════════════════════════════════════════════════════' '' 'Total failures:    10' 'Recovery rate:     50.0%' '' 'Recent Failures (last 10)' '────────────────────────────────────────────────────────────' '  2026-09-15T10:01 [FAIL] first failure' '  2026-09-15T10:02 [ok] second failure' '  2026-09-15T10:03 [FAIL] third failure' '  2026-09-15T10:04 [ok] fourth failure' '  2026-09-15T10:05 [FAIL] fifth failure' '  2026-09-15T10:06 [ok] sixth failure' '  2026-09-15T10:07 [FAIL] seventh failure' '  2026-09-15T10:08 [ok] eighth failure' '  2026-09-15T10:09 [FAIL] ninth failure' '  2026-09-15T10:10 [ok] last failure marker'
        ;;
      --history:*) printf '%s' 'No tracking data yet.' ;;
      *) printf '%s' '{"summary":{"total_commands":1,"total_input":100,"total_output":50,"total_saved":50,"avg_savings_pct":50.0,"total_time_ms":100,"avg_time_ms":100},"daily":[],"weekly":[],"monthly":[]}' ;;
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
      'No daily usage recorded',
      'No weekly usage recorded',
      'No monthly usage recorded',
      'No recent commands recorded',
      'Parse failures',
    ]) {
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText(expected, {timeoutMs: 5000});
    }
    await host.terminal.resize({cols: 56, rows: 26});
    await host.terminal.screen.waitForText('Page 1/', {timeoutMs: 5000});
    expectUsageLayout(
      await host.terminal.screen.text(),
      'Parse failures · Recent failures',
      'Native RTK gain report.',
    );
    const pages = await collectReportPages(host.terminal);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages)
      expect(page).toContain('Parse failures · Recent failures');
    const content = reportContent(pages);
    expect(content).toContain('first failure');
    expect(content).toContain('last failure marker');
    expect(content.indexOf('first failure')).toBeLessThan(
      content.indexOf('last failure marker'),
    );
    await goToFirstReportPage(host.terminal);
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
    expectUsageLayout(
      await host.terminal.screen.text(),
      'Refreshing usage',
      'Native RTK gain report.',
    );
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
