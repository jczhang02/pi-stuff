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

interface Group {
  priority: number;
  text: string;
}

const joinGroups = (groups: string[]) => groups.filter(Boolean).join('  ');

// Drop complete secondary groups, without backfilling gaps with small fields.
function fit(prefix: string, groups: Group[], width: number): string {
  const selected = [...groups];
  const line = () => joinGroups([prefix, ...selected.map(group => group.text)]);
  while (visibleWidth(line()) > width && selected.length > 0) {
    const lowest = Math.min(...selected.map(group => group.priority));
    selected.splice(
      selected.findIndex(group => group.priority === lowest),
      1,
    );
  }
  return line();
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
      ? theme.fg('muted', 'clean')
      : theme.fg('muted', '+1 ~1 ') +
        (state.scenario === 'long'
          ? theme.fg('error', '!1')
          : theme.fg('muted', '?1')) +
        theme.fg('muted', ' ↑2 ↓1');
  const bracket = (text: string) =>
    theme.fg('muted', '(') + text + theme.fg('muted', ')');
  const branchText = theme.fg('muted', branch);
  const git = bracket(`${branchText} ${changes}`);
  const names = bracket(branchText);
  const counts = bracket(changes);
  const identitiesFit = visibleWidth(project) + 1 + visibleWidth(git) <= width;
  const namesFit = visibleWidth(project) + 1 + visibleWidth(names) <= width;
  const directoryWidth = namesFit
    ? width
    : Math.max(0, width - visibleWidth(changes) - 1);
  const directory = theme.bold(truncateToWidth(project, directoryWidth, '…'));
  const identity = truncateToWidth(
    `${directory} ${identitiesFit ? git : namesFit ? names : changes}`,
    width,
    '…',
  );
  const gitOverflow = identitiesFit
    ? ''
    : namesFit
      ? counts
      : truncateToWidth(names, width, '…');

  const model = `${state.model} ${theme.fg('muted', state.thinking)}`;
  const cache = theme.fg('muted', 'hit 83.8%');
  const contextCore = `${theme.fg('muted', 'ctx')} ${context}% ${meter}`;
  const contextFull = `${contextCore} ${theme.fg('muted', '/272k')}`;
  const contextText =
    visibleWidth(joinGroups([gitOverflow, model, contextFull, cache])) <= width
      ? contextFull
      : contextCore;
  const groups: Group[] = [
    {priority: 80, text: model},
    {priority: 90, text: contextText},
    {priority: 100, text: cache},
  ];
  if (state.scenario !== 'base' && identitiesFit) {
    groups.push({
      priority: 10,
      text: theme.fg(
        'muted',
        `goal ${state.running ? 'running' : 'active'} · Codex used 5h 41% · week 63%`,
      ),
    });
  }
  return [identity, fit(gitOverflow, groups, width)];
}
