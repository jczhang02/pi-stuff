// Stateless task presentation shared by compact and expanded FleetView rows.
import type {Theme} from '@earendil-works/pi-coding-agent';
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import type {FleetTask} from './prototype-model';

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

export function alignRight(left: string, right: string, width: number): string {
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

export function taskStats(theme: Theme, task: FleetTask): string {
  const status = statusText(theme, task);
  const waitingOnDependencies =
    task.status === 'queued' ||
    (task.status === 'waiting' && !task.actions.includes('reply'));
  if (waitingOnDependencies) return status;
  const metrics = `${formatElapsed(task.elapsedSeconds)} · ↓ ${formatTokens(task.outputTokens)} tokens`;
  return status.length === 0
    ? theme.fg('accent', metrics)
    : `${status}  ${theme.fg('accent', metrics)}`;
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
