import {expect, test} from 'bun:test';
import type {Theme} from '@earendil-works/pi-coding-agent';
import {stripTerminalSequences, visibleWidth} from '@earendil-works/pi-tui';
import {fleetLines, requestTime, requestTokens} from '../../src/subagent/fleet';
import type {RunSnapshot, TaskSnapshot} from '../../src/subagent/records';

const theme: Pick<Theme, 'fg'> = {fg: (_color, text) => text};

function task(
  id: string,
  status: TaskSnapshot['status'],
  output: number,
  startedAt: number,
  endedAt: number | undefined,
  agent: string,
  assignment: string,
  pendingInstructions: string[] = [],
): TaskSnapshot {
  const result: TaskSnapshot = {
    id,
    agent,
    task: assignment,
    cwd: '/tmp',
    prompt: '',
    write: false,
    tools: ['read'],
    explicitTools: false,
    needs: [],
    maxRuntimeMs: 1_000,
    requestId: `request-${id}`,
    status,
    finalText: '',
    startedAt,
    usage: {output, turns: 1},
    pendingInstructions,
    configurationNotes: [],
    history: [],
  };
  if (endedAt !== undefined) result.endedAt = endedAt;
  return result;
}

function run(tasks: TaskSnapshot[]): RunSnapshot {
  return {
    id: 'run-fleet',
    mode: 'parallel',
    notifyPerTask: true,
    status: 'running',
    tasks,
    intercom: [],
  };
}

function sequenceX(line: string, sequence: string): number {
  return line.indexOf(sequence);
}

test('request time uses compact seconds, minutes, and hours', () => {
  expect(
    requestTime(task('seconds', 'running', 1, 0, 59_000, 'a', 'a'), 0),
  ).toBe('59s');
  expect(
    requestTime(task('minutes', 'running', 1, 0, 62_000, 'a', 'a'), 0),
  ).toBe('1m 2s');
  expect(
    requestTime(task('hours', 'completed', 1, 0, 3_661_000, 'a', 'a'), 0),
  ).toBe('1h 1m');
});

test('Fleet uses native activity, compact assignment fallback, and queue count', () => {
  const active = task(
    'active',
    'running',
    1_200,
    0,
    undefined,
    'reader',
    'Inspect the entire repository for lifecycle regressions\nInclude all evidence.',
    ['first steer', 'second steer'],
  );
  const fallback = task(
    'fallback',
    'completed',
    2_400,
    0,
    3_661_000,
    'reviewer',
    'Compare retained reports\nDo not repeat this line.',
  );
  const snapshot = run([active, fallback]);
  const lines = fleetLines(
    [
      {
        run: snapshot,
        task: active,
        activity: 'Read src/subagent/runs.ts\nmore',
      },
      {run: snapshot, task: fallback, activity: undefined},
    ],
    1,
    true,
    120,
    theme,
    10_000,
  ).map(stripTerminalSequences);

  expect(lines[1]).toContain('Read src/subagent/runs.ts');
  expect(lines[1]).not.toContain('Inspect the entire repository');
  expect(lines[1]).toContain('2 queued');
  expect(lines[2]).toContain('Compare retained reports');
  expect(lines[2]).not.toContain('Do not repeat this line.');
  expect(sequenceX(lines[1] ?? '', 'Read src/subagent/runs.ts')).toBe(
    sequenceX(lines[2] ?? '', 'Compare retained reports'),
  );
  expect(
    sequenceX(lines[1] ?? '', requestTokens(active)) +
      visibleWidth(requestTokens(active)),
  ).toBe(120);
});

test('Fleet keeps mixed duration and token columns aligned', () => {
  const short = task('short', 'completed', 12, 0, 59_000, 'short', 'short');
  const medium = task(
    'medium',
    'completed',
    1_200,
    0,
    62_000,
    'medium',
    'medium',
  );
  const long = task('long', 'completed', 12_000, 0, 3_661_000, 'long', 'long');
  const lines = fleetLines(
    [
      {run: run([short, medium, long]), task: short},
      {run: run([short, medium, long]), task: medium},
      {run: run([short, medium, long]), task: long},
    ],
    0,
    true,
    100,
    theme,
    4_000_000,
  ).map(stripTerminalSequences);
  const elapsedEnd = [short, medium, long].map((item, index) => {
    const line = lines[index + 1] ?? '';
    return (
      sequenceX(line, requestTime(item, 4_000_000)) +
      visibleWidth(requestTime(item, 4_000_000))
    );
  });
  const tokenEnd = [short, medium, long].map((item, index) => {
    const line = lines[index + 1] ?? '';
    return (
      sequenceX(line, requestTokens(item)) + visibleWidth(requestTokens(item))
    );
  });

  expect(new Set(elapsedEnd).size).toBe(1);
  expect(new Set(tokenEnd).size).toBe(1);
  expect(tokenEnd[0]).toBe(100);
  expect(Math.max(...lines.map(visibleWidth))).toBeLessThanOrEqual(100);
});
