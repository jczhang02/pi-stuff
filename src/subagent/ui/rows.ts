import type {Theme, ThemeColor} from '@earendil-works/pi-coding-agent';
import {
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui';

// Nerd Fonts / Font Awesome. Keep all Fleet status and navigation glyphs here.
export const icons = {
  selected: '\uf105',
  main: '\uf111',
  queued: '\uf017',
  starting: '\uf110',
  running: '\uf10c',
  awaiting_parent: '\uf059',
  completed: '\uf00c',
  failed: '\uf06a',
  aborted: '\uf04d',
  input: '\uf062',
  output: '\uf063',
};

export interface FleetRow {
  name: string;
  status: keyof Pick<
    typeof icons,
    | 'queued'
    | 'starting'
    | 'running'
    | 'awaiting_parent'
    | 'completed'
    | 'failed'
    | 'aborted'
  >;
  activity: string;
  input: number;
  output: number;
  seconds: number;
}

export function singleLine(value: string): string {
  return [...stripTerminalSequences(value)]
    .map(character => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || (code >= 127 && code <= 159) ? ' ' : character;
    })
    .join('')
    .trim();
}

export function tokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

export function duration(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${value % 60}s`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
}

function column(value: string, width: number): string {
  const text = truncateToWidth(value, Math.max(0, width), '…');
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
}

export function renderFleet(
  rows: readonly FleetRow[],
  selected: number | undefined,
  width: number,
  theme: Theme,
  maxRows = 6,
): string[] {
  if (rows.length < 2) return [];
  const nameWidth = Math.min(
    20,
    Math.max(7, ...rows.map(row => visibleWidth(singleLine(row.name)))),
  );
  const stats = rows.map(
    row =>
      `${duration(row.seconds).padStart(7)} · ${icons.input} ${tokens(row.input).padStart(5)} · ${icons.output} ${tokens(row.output).padStart(5)}`,
  );
  const statsWidth = Math.max(...stats.map(visibleWidth));
  const start = Math.max(
    0,
    Math.min((selected ?? 0) - maxRows + 1, rows.length - maxRows),
  );
  const visible = rows.slice(start, start + maxRows);
  const activityWidth = Math.max(0, width - nameWidth - statsWidth - 8);
  const result = visible.map((row, index) => {
    const position = index + start;
    const color: ThemeColor =
      row.status === 'failed'
        ? 'error'
        : row.status === 'awaiting_parent'
          ? 'warning'
          : 'muted';
    const marker =
      position === selected ? theme.fg('accent', icons.selected) : ' ';
    const icon = position === 0 ? icons.main : icons[row.status];
    const name = column(
      singleLine(row.name),
      Math.min(nameWidth, Math.max(4, width - statsWidth - 6)),
    );
    const identity = `${marker} ${theme.fg(color, icon)} ${position === 0 ? theme.bold(name) : name}`;
    const activity = activityWidth
      ? `  ${column(singleLine(row.activity), activityWidth)}`
      : '';
    const right = position === 0 ? '' : (stats[position] ?? '');
    const left = identity + activity;
    const padding = ' '.repeat(
      Math.max(1, width - visibleWidth(left) - visibleWidth(right)),
    );
    const line = truncateToWidth(
      left + padding + theme.fg('muted', right),
      width,
      '…',
    );
    return position === selected
      ? theme.bg('selectedBg', column(line, width))
      : line;
  });
  if (start > 0 || start + maxRows < rows.length)
    result.push(
      theme.fg(
        'dim',
        `  ${start + 1}–${Math.min(start + maxRows, rows.length)} / ${rows.length}`,
      ),
    );
  return result;
}
