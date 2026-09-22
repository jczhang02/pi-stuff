// Throwaway layout study. Fields are either present in full or absent.
import type {Theme} from '@earendil-works/pi-coding-agent';
import {visibleWidth} from '@earendil-works/pi-tui';

export type Scenario = 'base' | 'extended' | 'long';
export interface FooterState {
  scenario: Scenario;
  model: string;
  thinking: string;
  completed: number;
  running: boolean;
}

interface Field {
  id: string;
  priority: number;
  text: string;
}

export function renderFooter(
  width: number,
  theme: Theme,
  state: FooterState,
): string {
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
      : 'main*';
  const fields: Field[] = [
    {id: 'project', priority: 110, text: theme.bold(project)},
    {id: 'branch', priority: 30, text: theme.fg('success', branch)},
    {
      id: 'model',
      priority: 80,
      text: theme.fg('accent', `${state.model} · ${state.thinking}`),
    },
    {id: 'context', priority: 100, text: `ctx ${context}% ${meter}`},
    {id: 'cache', priority: 90, text: 'hit 83.8%'},
  ];
  if (state.scenario !== 'base') {
    fields.push(
      {
        id: 'goal',
        priority: 70,
        text: `goal ${theme.fg('thinkingMedium', state.running ? 'running' : 'active')}`,
      },
      {id: 'quota', priority: 60, text: 'Codex used 5h 41% · week 63%'},
    );
  }
  fields.push(
    {
      id: 'tokens',
      priority: 20,
      text: theme.fg(
        'muted',
        `↑${119 + state.completed}k ↓${27 + state.completed}k`,
      ),
    },
    {
      id: 'cost',
      priority: 10,
      text: theme.fg(
        'muted',
        `est $${(0.91 + state.completed * 0.01).toFixed(2)}`,
      ),
    },
  );

  const separator = ' ';
  const selected = new Set<string>();
  let used = 0;
  for (const field of [...fields].sort((a, b) => b.priority - a.priority)) {
    const needed =
      visibleWidth(field.text) + (selected.size > 0 ? separator.length : 0);
    if (used + needed > width) continue;
    selected.add(field.id);
    used += needed;
  }
  return fields
    .filter(field => selected.has(field.id))
    .map(field => field.text)
    .join(separator);
}
