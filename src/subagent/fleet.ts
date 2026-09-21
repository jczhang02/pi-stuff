import {truncateToWidth, visibleWidth} from '@earendil-works/pi-tui';
import type {Theme} from '@earendil-works/pi-coding-agent';
import type {RunSnapshot, TaskSnapshot} from './records';

export interface FleetRow {
  run: RunSnapshot;
  task: TaskSnapshot;
}

export function compactCount(value: number): string {
  return Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  })
    .format(value)
    .toLowerCase();
}

export function taskState(
  task: TaskSnapshot,
  tasks?: readonly TaskSnapshot[],
): string {
  if (task.status === 'stopping') return 'Stopping';
  if (task.finalizing) return 'Finalizing';
  if (task.preservationError)
    return `${task.status === 'completed' ? 'Done' : task.status} · Commit failed`;
  switch (task.status) {
    case 'queued':
      return task.needs.some(id => {
        const prerequisite = tasks?.find(candidate => candidate.id === id);
        return (
          prerequisite &&
          (prerequisite.status !== 'completed' || prerequisite.finalizing)
        );
      })
        ? 'Waiting'
        : 'Queued';
    case 'starting':
      return 'Starting';
    case 'awaiting_parent':
      return 'Waiting for main';
    case 'running':
      return '';
    case 'completed':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'stopped':
      return 'Stopped';
    case 'skipped':
      return 'Skipped';
  }
}

export function requestTime(task: TaskSnapshot, now: number): string {
  return task.startedAt === undefined
    ? '—'
    : `${Math.max(0, Math.floor(((task.endedAt ?? now) - task.startedAt) / 1000))}s`;
}

export function requestTokens(task: TaskSnapshot): string {
  return task.usage?.output === undefined
    ? '↓ — tokens'
    : `↓ ${compactCount(task.usage.output)} tokens`;
}

function cell(text: string, width: number, right = false): string {
  const clipped = truncateToWidth(
    text.replace(/[\r\n\t]/g, ' '),
    Math.max(0, width),
    '…',
  );
  const padding = ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
  return right ? padding + clipped : clipped + padding;
}

// Widths belong to the visible list, never to one row independently.
export function fleetLines(
  rows: readonly FleetRow[],
  selected: number,
  focused: boolean,
  width: number,
  theme: Theme,
  now: number,
): string[] {
  const names = ['main', ...rows.map(row => row.task.agent)];
  const nameWidth = Math.min(
    24,
    Math.max(...names.map(visibleWidth)),
    Math.max(4, Math.floor(width / 4)),
  );
  const elapsedWidth = Math.max(
    2,
    ...rows.map(row => visibleWidth(requestTime(row.task, now))),
  );
  const tokenWidth = Math.max(
    10,
    ...rows.map(row => visibleWidth(requestTokens(row.task))),
  );
  const stateWidth = Math.max(
    0,
    ...rows.map(row => visibleWidth(taskState(row.task, row.run.tasks))),
  );
  const metricWidth = elapsedWidth + 3 + tokenWidth;
  const tailWidth = Math.min(
    Math.max(metricWidth + 1 + Math.min(stateWidth, 8), stateWidth),
    Math.max(0, width - nameWidth - 4),
  );
  const descriptionWidth = Math.max(0, width - nameWidth - tailWidth - 4);
  const main = `${focused && selected === 0 ? '●' : '○'} main`;
  return [
    theme.fg(focused && selected === 0 ? 'accent' : 'text', main),
    ...rows.map((row, index) => {
      const task = row.task;
      const state = taskState(task, row.run.tasks);
      const metrics =
        ['running', 'completed', 'failed', 'stopped'].includes(task.status) &&
        !task.finalizing &&
        !task.preservationError;
      let tail = state;
      if (metrics && tailWidth >= metricWidth) {
        const prefixWidth = tailWidth - metricWidth;
        tail =
          cell(state, Math.max(0, prefixWidth - 1)) +
          (prefixWidth ? ' ' : '') +
          cell(requestTime(task, now), elapsedWidth, true) +
          ' · ' +
          cell(requestTokens(task), tokenWidth, true);
      }
      const tone =
        task.preservationError || task.status === 'failed'
          ? 'error'
          : task.status === 'completed'
            ? 'success'
            : task.status === 'awaiting_parent' || task.status === 'stopped'
              ? 'warning'
              : 'muted';
      const icon =
        focused && selected === index + 1 ? theme.fg('accent', '●') : '○';
      return (
        icon +
        ' ' +
        cell(task.agent, nameWidth) +
        ' ' +
        cell(task.task, descriptionWidth) +
        ' ' +
        theme.fg(tone, cell(tail, tailWidth, true))
      );
    }),
  ];
}
