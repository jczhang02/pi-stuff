import {expect, test} from 'bun:test';
import {
  decodeUsageReport,
  parseFailures,
  type FailureReport,
} from '../../src/rtk/report';

const NATIVE_FAILURES = `RTK Parse Failures
════════════════════════════════════════════════════════════

Total failures:    15
Recovery rate:     60.0%

Top Commands (by frequency)
────────────────────────────────────────────────────────────
     3x  git status
     3x  /bin/true
     1x  rtk unsupported --flag
     1x  custom-multiline-command
reason: first line
rea...
     1x  command-with-a-deliberately-long-name-that-nati...
     1x  command-15
     1x  command-14
     1x  command-13
     1x  command-12
     1x  command-11

Recent Failures (last 10)
────────────────────────────────────────────────────────────
  2026-09-15T10:14 [ok] command-15
  2026-09-15T10:13 [FAIL] command-14
  2026-09-15T10:12 [ok] command-13
  2026-09-15T10:11 [FAIL] command-12
  2026-09-15T10:10 [ok] command-11
  2026-09-15T10:09 [FAIL] command-with-a-deliberately-long-name...
  2026-09-15T10:08 [ok] custom-multiline-command
reason: firs...
  2026-09-15T10:07 [FAIL] git status
  2026-09-15T10:06 [ok] git status
  2026-09-15T10:05 [FAIL] rtk unsupported --flag
`;

const EXPECTED_FAILURES: FailureReport = {
  total: 15,
  recoveryRate: 60,
  topCommands: [
    {command: 'git status', count: 3},
    {command: '/bin/true', count: 3},
    {command: 'rtk unsupported --flag', count: 1},
    {
      command: 'custom-multiline-command\nreason: first line\nrea...',
      count: 1,
    },
    {command: 'command-with-a-deliberately-long-name-that-nati...', count: 1},
    {command: 'command-15', count: 1},
    {command: 'command-14', count: 1},
    {command: 'command-13', count: 1},
    {command: 'command-12', count: 1},
    {command: 'command-11', count: 1},
  ],
  recent: [
    {time: '2026-09-15T10:14', command: 'command-15', recovered: true},
    {time: '2026-09-15T10:13', command: 'command-14', recovered: false},
    {time: '2026-09-15T10:12', command: 'command-13', recovered: true},
    {time: '2026-09-15T10:11', command: 'command-12', recovered: false},
    {time: '2026-09-15T10:10', command: 'command-11', recovered: true},
    {
      time: '2026-09-15T10:09',
      command: 'command-with-a-deliberately-long-name...',
      recovered: false,
    },
    {
      time: '2026-09-15T10:08',
      command: 'custom-multiline-command\nreason: firs...',
      recovered: true,
    },
    {time: '2026-09-15T10:07', command: 'git status', recovered: false},
    {time: '2026-09-15T10:06', command: 'git status', recovered: true},
    {
      time: '2026-09-15T10:05',
      command: 'rtk unsupported --flag',
      recovered: false,
    },
  ],
};

test('parseFailures decodes the RTK 0.45 native export into fields', async () => {
  const ansi = NATIVE_FAILURES.replace(
    'RTK Parse Failures',
    '\x1b[1mRTK Parse Failures\x1b[0m',
  ).replace('Total failures:    15', '\x1b[2mTotal failures:    15\x1b[0m');
  expect(parseFailures(ansi)).toEqual(EXPECTED_FAILURES);

  const outcome = await decodeUsageReport('Failures', ansi, '', 0);
  expect(outcome).toEqual({
    state: 'ready',
    snapshot: {kind: 'failures', failures: EXPECTED_FAILURES},
  });
});

test('parseFailures preserves the exact native report limits and text', () => {
  const result = parseFailures(NATIVE_FAILURES);
  if (result === undefined || result === 'empty')
    throw new Error('Expected a structured native failure report.');
  expect(result.topCommands).toHaveLength(10);
  expect(result.recent).toHaveLength(10);
  expect(result.topCommands[3]?.command).toContain('reason: first line');
  expect(result.recent[6]?.command).toContain('reason: firs...');
  expect(result.topCommands[4]?.command).toEndWith('...');
  expect(result.recent[5]?.command).toEndWith('...');
});

test('parseFailures preserves blank lines, indentation, and divider-like command text', () => {
  const report = `RTK Parse Failures
════════════════════════════════════════════════════════════

Total failures:    1
Recovery rate:     100.0%

Top Commands (by frequency)
────────────────────────────────────────────────────────────
     1x  printf "first

  second
───

Recent Failures (last 10)
────────────────────────────────────────────────────────────
  2026-09-15T10:14 [ok] printf "first

  second
───
`;
  const result = parseFailures(report);
  if (result === undefined || result === 'empty')
    throw new Error('Expected a structured native failure report.');
  expect(result.topCommands).toEqual([
    {count: 1, command: 'printf "first\n\n  second\n───'},
  ]);
  expect(result.recent).toEqual([
    {
      time: '2026-09-15T10:14',
      command: 'printf "first\n\n  second\n───',
      recovered: true,
    },
  ]);
});

test('parseFailures rejects a recognized title without report data', () => {
  expect(
    parseFailures(
      'RTK Parse Failures\n════════════════════════════════════════════════════════════\n',
    ),
  ).toBeUndefined();
});

test('parseFailures rejects invalid statuses and counters', () => {
  const invalidReports = [
    NATIVE_FAILURES.replace('[FAIL]', '[failed]'),
    NATIVE_FAILURES.replace('Total failures:    15', 'Total failures:    0'),
    NATIVE_FAILURES.replace(
      'Recovery rate:     60.0%',
      'Recovery rate:     101.0%',
    ),
    NATIVE_FAILURES.replace('     3x  git status', '     16x  git status'),
  ];
  for (const report of invalidReports)
    expect(parseFailures(report)).toBeUndefined();
});

test('parseFailures recognizes only the exact two-line empty report', () => {
  const empty =
    "No parse failures recorded.\nThis means all commands parsed successfully (or fallback hasn't triggered yet).";
  expect(parseFailures(empty)).toBe('empty');
  expect(parseFailures(`${empty}\nextra output`)).toBeUndefined();
});
