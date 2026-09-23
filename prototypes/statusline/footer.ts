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
  text: string;
  side: 'left' | 'right';
  priority: number;
}

// Each zone uses dots; only the gap between left/right zones stretches.
function row(width: number, fields: Field[], separator: string): string {
  const selected = [...fields];
  const zone = (side: Field['side']) =>
    selected
      .filter(field => field.side === side)
      .map(field => field.text)
      .join(separator);
  const needed = () =>
    visibleWidth(zone('left')) +
    visibleWidth(zone('right')) +
    (zone('left') && zone('right') ? 2 : 0);
  while (
    needed() > width &&
    selected.some(field => Number.isFinite(field.priority))
  ) {
    const lowest = Math.min(...selected.map(field => field.priority));
    selected.splice(
      selected.findIndex(field => field.priority === lowest),
      1,
    );
  }
  const left = zone('left');
  const right = zone('right');
  if (!right) return left;
  return (
    left +
    ' '.repeat(Math.max(0, width - visibleWidth(left) - visibleWidth(right))) +
    right
  );
}

export function renderFooter(
  width: number,
  theme: Theme,
  state: FooterState,
): string[] {
  const separator = theme.fg('muted', ' · ');
  const project =
    state.scenario === 'long'
      ? '~/dev/研究工具/pi-stuff-statusline'
      : '~/dev/pi-stuff';
  const branch =
    state.scenario === 'long'
      ? 'codex/statusline-responsive-prototype'
      : 'main';
  const worktree =
    state.scenario === 'base'
      ? theme.fg('muted', 'clean')
      : theme.fg('muted', '+1 ~1 ') +
        (state.scenario === 'long'
          ? theme.fg('error', '!1')
          : theme.fg('muted', '?1'));
  const divergence =
    state.scenario === 'base' ? '' : theme.fg('muted', '↑2 ↓1');
  const git = [theme.fg('muted', branch), worktree, divergence]
    .filter(Boolean)
    .join(separator);
  const required = (text: string, side: Field['side']): Field => ({
    text,
    side,
    priority: Infinity,
  });
  const first: Field[] = [];
  const second: Field[] = [];
  const identitiesFit = visibleWidth(project) + 2 + visibleWidth(git) <= width;
  if (identitiesFit) {
    first.push(required(theme.bold(project), 'left'), required(git, 'right'));
  } else if (visibleWidth(project) + 2 + visibleWidth(branch) <= width) {
    first.push(
      required(theme.bold(project), 'left'),
      required(theme.fg('muted', branch), 'right'),
    );
    second.push(
      required([worktree, divergence].filter(Boolean).join(separator), 'left'),
    );
  } else {
    const pathWidth = Math.max(0, width - visibleWidth(worktree) - 2);
    first.push(
      required(theme.bold(truncateToWidth(project, pathWidth, '…')), 'left'),
      required(worktree, 'right'),
    );
    const branchWidth = Math.max(
      0,
      width - visibleWidth(divergence) - (divergence ? 2 : 0),
    );
    second.push(
      required(
        theme.fg('muted', truncateToWidth(branch, branchWidth, '…')),
        'left',
      ),
    );
    if (divergence) second.push(required(divergence, 'right'));
  }

  const context = Math.min(100, 30 + state.completed);
  const filled = Math.round(context / 10);
  const meter =
    theme.fg('thinkingMedium', '━'.repeat(filled)) +
    theme.fg('borderMuted', '━'.repeat(10 - filled));
  // Keep the requested context/capacity/hit block intact immediately after dir.
  first.push({
    text: `${theme.fg('muted', 'ctx')} ${context}% ${meter}${theme.fg('muted', '/ 272k')} · ${theme.fg('muted', 'hit 83.8%')}`,
    side: 'left',
    priority: 90,
  });
  if (identitiesFit && state.scenario !== 'base') {
    second.push({
      text: theme.fg(
        'muted',
        `goal ${state.running ? 'running' : 'active'} · codex used 5h 41% · week 63%`,
      ),
      side: 'left',
      priority: 10,
    });
  }
  // If the branch occupies the second row, it owns that row's right-hand budget too.
  if (second.every(field => field.side !== 'right')) {
    second.push(
      {text: state.model, side: 'right', priority: 80},
      {text: theme.fg('muted', state.thinking), side: 'right', priority: 30},
    );
  }
  return [row(width, first, separator), row(width, second, separator)];
}
