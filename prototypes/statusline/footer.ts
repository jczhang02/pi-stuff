// Throwaway two-row layout study. Git and usage values are sample data.
import type {Theme} from '@earendil-works/pi-coding-agent';
import {truncateToWidth, visibleWidth} from '@earendil-works/pi-tui';

export type Scenario = 'base' | 'extended' | 'long';
export interface FooterState {
  scenario: Scenario;
  model: string;
  thinking: string;
  completed: number;
  running: boolean;
}

interface Field {
  priority: number;
  text: string;
}

// Keep each optional field whole, then render selected fields in reading order.
function fit(prefix: string, fields: Field[], width: number): string {
  const selected = new Set<Field>();
  let used = visibleWidth(prefix);
  for (const field of [...fields].sort((a, b) => b.priority - a.priority)) {
    const needed = visibleWidth(field.text) + (used > 0 ? 1 : 0);
    if (used + needed > width) continue;
    selected.add(field);
    used += needed;
  }
  return [
    prefix,
    ...fields.filter(field => selected.has(field)).map(field => field.text),
  ]
    .filter(Boolean)
    .join(' ');
}

export function renderFooter(
  width: number,
  theme: Theme,
  state: FooterState,
): string[] {
  const context = Math.min(100, 30 + state.completed);
  const filled = Math.round(context / 10);
  const meter =
    theme.fg('thinkingMedium', '━'.repeat(filled)) +
    theme.fg('borderMuted', '━'.repeat(10 - filled));
  const project =
    state.scenario === 'long'
      ? '~/dev/研究工具/pi-stuff-statusline'
      : '~/dev/pi-stuff';
  const branch =
    state.scenario === 'long'
      ? 'codex/statusline-responsive-prototype'
      : 'main';
  const changes =
    state.scenario === 'base'
      ? theme.fg('success', 'clean')
      : `${theme.fg('success', '+1')} ${theme.fg('warning', '~1')} ${state.scenario === 'long' ? theme.fg('error', '!1') : theme.fg('warning', '?1')} ${theme.fg('muted', '↑2 ↓1')}`;
  const git = `${theme.fg('muted', branch)} ${changes}`;
  const identitiesFit = visibleWidth(project) + 1 + visibleWidth(git) <= width;
  const namesFit = visibleWidth(project) + 1 + visibleWidth(branch) <= width;
  const directoryWidth = namesFit
    ? width
    : Math.max(0, width - visibleWidth(changes) - 1);
  const directory = theme.bold(truncateToWidth(project, directoryWidth, '…'));
  const identity = truncateToWidth(
    `${directory} ${identitiesFit ? git : namesFit ? theme.fg('muted', branch) : changes}`,
    width,
    '…',
  );
  // Keep directory and branch together when possible, moving counts before metrics.
  const gitOverflow = identitiesFit
    ? ''
    : namesFit
      ? changes
      : theme.fg('muted', truncateToWidth(branch, width, '…'));
  const extras: Field[] =
    state.scenario === 'base' || !identitiesFit
      ? []
      : [
          {
            priority: 20,
            text: theme.fg(
              'muted',
              `goal ${state.running ? 'running' : 'active'}`,
            ),
          },
          {
            priority: 10,
            text: theme.fg('muted', 'Codex used 5h 41% · week 63%'),
          },
        ];
  const statistics: Field[] = [
    {
      priority: 80,
      text: `${state.model} · ${theme.fg('muted', state.thinking)}`,
    },
    {
      priority: 100,
      text: `ctx ${theme.fg('thinkingMedium', `${context}%`)} ${meter}`,
    },
    {priority: 70, text: theme.fg('muted', '/272k')},
    {priority: 30, text: theme.fg('muted', 'auto')},
    {priority: 90, text: 'hit 83.8%'},
    {
      priority: 60,
      text: theme.fg(
        'muted',
        `↑${119 + state.completed}k ↓${27 + state.completed}k`,
      ),
    },
    {priority: 50, text: theme.fg('muted', 'R620k')},
    {priority: 40, text: theme.fg('muted', 'W8k')},
    {
      priority: 20,
      text: theme.fg(
        'muted',
        `est $${(0.91 + state.completed * 0.01).toFixed(3)} (sub)`,
      ),
    },
    {priority: 10, text: theme.fg('muted', '(openai-codex)')},
  ];
  return [fit(identity, extras, width), fit(gitOverflow, statistics, width)];
}
