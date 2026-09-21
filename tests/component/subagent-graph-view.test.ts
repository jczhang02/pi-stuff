import {expect, test} from 'bun:test';
import {
  KeybindingsManager,
  TUI_KEYBINDINGS,
  stripTerminalSequences,
  visibleWidth,
} from '@earendil-works/pi-tui';
import type {Theme} from '@earendil-works/pi-coding-agent';
import type {RunSnapshot, TaskSnapshot} from '../../src/subagent/records';
import {GraphView} from '../../src/subagent/graph-view';

const theme: Pick<Theme, 'fg'> = {fg: (_color, text) => text};

function task(
  id: string,
  needs: string[] = [],
  status: TaskSnapshot['status'] = 'queued',
  agent = id,
  assignment = `${agent} task`,
): TaskSnapshot {
  return {
    id,
    agent,
    task: assignment,
    cwd: '/tmp',
    prompt: '',
    write: false,
    tools: ['read'],
    explicitTools: false,
    needs,
    maxRuntimeMs: 1_000,
    requestId: `request-${id}`,
    status,
    finalText: '',
    pendingInstructions: [],
    history: [],
    configurationNotes: [],
  };
}

function run(tasks: TaskSnapshot[]): RunSnapshot {
  return {
    id: 'run-graph',
    mode: 'parallel',
    notifyPerTask: true,
    status: 'running',
    tasks,
    intercom: [],
  };
}

function plain(lines: readonly string[]): string[] {
  return lines.map(stripTerminalSequences);
}

test('GraphView renders stable DAG order and every explicit diamond edge', () => {
  const snapshot = run([
    task('alpha'),
    task('beta', ['alpha']),
    task('gamma', ['alpha']),
    task('review', ['beta', 'gamma']),
  ]);
  const view = new GraphView(snapshot, 'review');
  const lines = plain(view.render(120, 10, theme));
  const rendered = lines.join('\n');

  expect(rendered.indexOf('alpha')).toBeLessThan(rendered.indexOf('beta'));
  expect(rendered.indexOf('beta')).toBeLessThan(rendered.indexOf('review'));
  expect(rendered).toContain('▶○ beta');
  expect(rendered).toContain('▶○ gamma');
  expect(rendered).toContain('└─▶● review');
  expect(rendered).toContain('┤');
});

test('GraphView disambiguates duplicate agents with assignments and metrics', () => {
  const snapshot = run([
    task('first', [], 'completed', 'explorer', 'Read lifecycle'),
    task('second', [], 'completed', 'explorer', 'Inspect cancellation'),
    task(
      'review',
      ['first', 'second'],
      'completed',
      'reviewer',
      'Compare findings',
    ),
  ]);
  const review = snapshot.tasks[2];
  if (review === undefined) throw new Error('Missing review task.');
  review.startedAt = 0;
  review.endedAt = 62_000;
  review.usage = {output: 1_200, turns: 1};
  const rendered = plain(
    new GraphView(snapshot, 'review').render(120, 10, theme),
  ).join('\n');

  expect(rendered).toContain('○ explorer · Read lifecycle');
  expect(rendered).toContain('○ explorer · Inspect cancel');
  expect(rendered).toContain('● reviewer');
  expect(rendered).toContain('Done · reviewer · Compare findings · 1m 2s');
  expect(rendered).toContain('▶');
  expect(rendered).not.toContain('first');
  expect(rendered).not.toContain('second');
});

test('GraphView navigation uses configured selection bindings', () => {
  const snapshot = run([
    task('alpha'),
    task('beta', ['alpha']),
    task('gamma', ['alpha']),
    task('review', ['beta', 'gamma']),
  ]);
  const view = new GraphView(snapshot, 'review');
  const keys = new KeybindingsManager(TUI_KEYBINDINGS, {
    'tui.select.up': 'k',
    'tui.select.down': 'j',
  });
  const up = keys.getKeys('tui.select.up')[0];
  const down = keys.getKeys('tui.select.down')[0];

  expect(view.selectedTask()?.id).toBe('review');
  expect(up).toBeDefined();
  expect(down).toBeDefined();
  if (up !== undefined && down !== undefined) {
    expect(view.handleInput(up, keys)).toBe(true);
    expect(view.selectedTask()?.id).toBe('gamma');
    expect(view.handleInput(down, keys)).toBe(true);
    expect(view.selectedTask()?.id).toBe('review');
  }
});

test('GraphView keeps selection visible and marks edges crossing the viewport', () => {
  const snapshot = run([
    task('alpha'),
    task('beta', ['alpha']),
    task('gamma', ['beta']),
    task('delta', ['gamma']),
    task('epsilon', ['delta']),
    task('zeta', ['epsilon']),
  ]);
  const view = new GraphView(snapshot, 'delta');
  const lines = plain(view.render(40, 7, theme));

  expect(lines.join('\n')).toContain('● delta');
  expect(lines.join('\n')).toMatch(/[↑↓←→]/);
  expect(Math.max(...lines.map(visibleWidth))).toBeLessThanOrEqual(40);
});

test('GraphView distinguishes an unmet prerequisite from a completed one', () => {
  const snapshot = run([
    task('done', [], 'completed'),
    task('ready', ['done']),
    task('running', [], 'running'),
    task('blocked', ['running']),
  ]);
  const view = new GraphView(snapshot, 'ready');
  const rendered = plain(view.render(100, 8, theme)).join('\n');

  expect(rendered).toContain('Queued · ready');
  const blocked = new GraphView(snapshot, 'blocked');
  expect(plain(blocked.render(100, 8, theme)).join('\n')).toContain(
    'Waiting for running · blocked',
  );
});

test('a clipped source is marked even when its edge begins at the viewport', () => {
  const snapshot = run([
    task('source', [], 'queued', 'source_long_name'),
    task('second', ['source']),
    task('third', ['second']),
    task('last', ['third']),
  ]);
  const lines = plain(new GraphView(snapshot, 'last').render(80, 12, theme));
  expect(lines[1]).toStartWith('←');
});

test('separate dependency pairs do not become a shared bus', () => {
  const snapshot = run([
    task('alpha'),
    task('beta'),
    task('only-alpha', ['alpha']),
    task('only-beta', ['beta']),
  ]);
  const rendered = plain(
    new GraphView(snapshot, 'only-alpha').render(120, 12, theme),
  ).join('\n');
  expect(rendered).not.toMatch(/[├┤┬┴┼╳]/);
  expect(rendered).toContain('▶● only-alpha');
  expect(rendered).toContain('▶○ only-beta');
});

test('crossing edges are distinct from connected junctions', () => {
  const snapshot = run([
    task('alpha'),
    task('beta'),
    task('only-beta', ['beta']),
    task('only-alpha', ['alpha']),
  ]);
  const rendered = plain(
    new GraphView(snapshot, 'only-alpha').render(120, 12, theme),
  ).join('\n');
  expect(rendered).toContain('╳ crossing');
  expect(rendered).not.toContain('┼');
});

test('long selected names cannot hide the waiting reason', () => {
  const snapshot = run([
    task('source'),
    task(
      'consumer',
      ['source'],
      'queued',
      'Investigate cancellation behavior and preserve the source report for validation',
    ),
  ]);
  const rendered = plain(
    new GraphView(snapshot, 'consumer').render(80, 10, theme),
  ).join('\n');
  expect(rendered).toContain('Waiting for source');
});

test('a prerequisite connecting to both joins remains a connection at a crossing', () => {
  const snapshot = run([
    task('alpha'),
    task('beta'),
    task('both-one', ['alpha', 'beta']),
    task('both-two', ['alpha', 'beta']),
  ]);
  const rendered = plain(
    new GraphView(snapshot, 'both-two').render(120, 12, theme),
  ).join('\n');
  expect(rendered).toContain('┼');
  expect(rendered).not.toContain('╳ crossing');
  expect(rendered).toContain('▶○ both-one');
  expect(rendered).toContain('▶● both-two');
});

test('duplicate long roles preserve distinct assignment text at 80 columns', () => {
  const snapshot = run([
    task(
      'one',
      [],
      'completed',
      'independent-researcher',
      'Lifecycle evidence',
    ),
    task('two', [], 'completed', 'independent-researcher', 'Mailbox behavior'),
    task('join', ['one', 'two'], 'queued', 'reviewer'),
  ]);
  const lines = plain(new GraphView(snapshot, 'join').render(80, 10, theme));
  expect(lines[1]).toContain('Lifecyc');
  expect(lines[3]).toContain('Mailbox');
  expect(lines[1]).not.toContain('one');
  expect(lines[3]).not.toContain('two');
  expect(lines.every(line => visibleWidth(line) <= 80)).toBe(true);
});

test('graph keeps request metrics when the selected assignment is long', () => {
  const selected = task(
    'review',
    [],
    'completed',
    'reviewer',
    'Review cancellation and persistence '.repeat(10),
  );
  selected.startedAt = 0;
  selected.endedAt = 2_714_000;
  selected.usage = {output: 8_200, turns: 1};
  for (const width of [80, 120]) {
    const lines = plain(
      new GraphView(run([selected]), selected.id).render(width, 8, theme),
    );
    expect(lines.at(-1)).toContain('Done · reviewer');
    expect(lines.at(-1)).toEndWith('45m 14s · ↓ 8.2k tokens');
    expect(visibleWidth(lines.at(-1) ?? '')).toBeLessThanOrEqual(width);
  }
});
