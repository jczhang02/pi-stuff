// Stateless task presentation shared by compact and expanded FleetView rows.
import type {Theme} from '@earendil-works/pi-coding-agent';
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import type {FleetAgent, FleetTask} from './prototype-model';

export interface FleetColumns {
  readonly width: number;
  readonly name: number;
  readonly status: number;
  readonly elapsed: number;
  readonly tokens: number;
}

export function oneLine(text: string): string {
  return text
    .replace(/[\r\n\t]/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

function formatTokens(value: number): string {
  if (value < 1000) return `${value}`;
  if (value < 10000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1000000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1000000).toFixed(1)}M`;
}

function formatElapsed(value: number): string {
  if (value < 60) return `${Math.max(0, Math.round(value))}s`;
  return `${Math.floor(value / 60)}m ${Math.max(0, Math.round(value % 60))}s`;
}

function statusText(theme: Theme, task: FleetTask): string {
  let label = '';
  let color: 'error' | 'warning' | 'muted' | 'success' | undefined;
  switch (task.status) {
    case 'queued':
      label = 'Queued';
      color = 'warning';
      break;
    case 'waiting':
      label = task.actions.includes('reply')
        ? 'Needs reply'
        : 'Waiting dependencies';
      color = 'warning';
      break;
    case 'cancelling':
      label = 'Stopping';
      color = 'warning';
      break;
    case 'cancelled':
      label = 'Cancelled';
      color = 'muted';
      break;
    case 'failed':
      label = 'Failed';
      color = 'error';
      break;
    case 'skipped':
      label = 'Skipped';
      color = 'muted';
      break;
    case 'completed':
      label = 'Done';
      color = 'success';
      break;
    case 'running':
      break;
  }
  return color === undefined ? '' : theme.fg(color, label);
}

function alignRight(left: string, right: string, width: number): string {
  if (right.length === 0 || width < 60)
    return truncateToWidth(left, width, '...');
  const rightWidth = visibleWidth(right);
  if (rightWidth >= width) return truncateToWidth(right, width, '...');
  const clipped = truncateToWidth(
    left,
    Math.max(1, width - rightWidth - 1),
    '...',
  );
  return `${clipped}${' '.repeat(Math.max(1, width - visibleWidth(clipped) - rightWidth))}${right}`;
}

export function appendWrapped(
  lines: string[],
  text: string,
  prefix: string,
  width: number,
  theme: Theme,
): void {
  const available = Math.max(8, width - visibleWidth(prefix));
  for (const paragraph of text.replaceAll('\r', '').split('\n')) {
    const wrapped = wrapTextWithAnsi(
      paragraph.replaceAll('\t', '  '),
      available,
    );
    for (const line of wrapped)
      lines.push(theme.fg('text', `${prefix}${line}`));
  }
}

/** Measure the whole snapshot so expansion does not move the shared columns. */
export function fleetColumns(
  theme: Theme,
  agents: readonly FleetAgent[],
  width: number,
): FleetColumns {
  let name = 0;
  let status = 0;
  let elapsed = 0;
  let tokens = 0;
  for (const agent of agents) {
    name = Math.max(name, visibleWidth(oneLine(agent.name)));
    for (const task of agent.tasks) {
      status = Math.max(status, visibleWidth(statusText(theme, task)));
      elapsed = Math.max(
        elapsed,
        visibleWidth(formatElapsed(task.elapsedSeconds)),
      );
      tokens = Math.max(tokens, visibleWidth(formatTokens(task.outputTokens)));
    }
  }
  return {
    width,
    name: Math.min(name, Math.floor(width / 4)),
    status,
    elapsed,
    tokens,
  };
}

export function agentRow(
  theme: Theme,
  columns: FleetColumns,
  agent: FleetAgent,
  icon: string,
  toggle = '  ',
): string {
  const name = truncateToWidth(oneLine(agent.name), columns.name, '...');
  const task = agent.tasks.at(-1);
  if (agent.name === 'main' || task === undefined)
    return theme.fg('text', `${icon} ${name}`);
  const padding = ' '.repeat(columns.name - visibleWidth(name));
  const left = `${icon} ${name}${padding}  ${toggle}${oneLine(task.description || 'No task')}`;
  return taskRow(theme, columns, left, task);
}

export function taskRow(
  theme: Theme,
  columns: FleetColumns,
  left: string,
  task: FleetTask,
): string {
  const label = statusText(theme, task);
  const status = label + ' '.repeat(columns.status - visibleWidth(label));
  const waitingOnDependencies =
    task.status === 'queued' ||
    (task.status === 'waiting' && !task.actions.includes('reply'));
  const elapsed = formatElapsed(task.elapsedSeconds).padStart(columns.elapsed);
  const tokens = formatTokens(task.outputTokens).padStart(columns.tokens);
  const metrics = `${elapsed} · ↓ ${tokens} tokens`;
  const right = `${status}${columns.status > 0 ? '  ' : ''}${
    waitingOnDependencies
      ? ' '.repeat(visibleWidth(metrics))
      : theme.fg('accent', metrics)
  }`;
  return theme.fg('text', alignRight(left, right, columns.width));
}

export function appendTaskSummary(
  lines: string[],
  task: FleetTask,
  prefix: string,
  width: number,
  theme: Theme,
): void {
  const summary = [task.detail, task.model ? `Model · ${task.model}` : ''];
  if (
    task.progress &&
    !['completed', 'cancelled', 'failed', 'skipped'].includes(task.status)
  )
    summary.push(
      truncateToWidth(
        `Progress · ${oneLine(task.progress)}`,
        Math.max(8, width - visibleWidth(prefix)),
        '...',
      ),
    );
  if (task.question) {
    summary.push(`Question · ${task.question.text}`);
    summary.push(
      task.question.answer !== undefined
        ? `Answer · ${task.question.answer}`
        : task.actions.includes('reply')
          ? 'Needs your reply.'
          : 'No answer received.',
    );
  }
  for (const text of summary.filter(Boolean))
    appendWrapped(lines, text, prefix, width, theme);
}
