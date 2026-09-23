import type {ContextUsage, Theme} from '@earendil-works/pi-coding-agent';
import {truncateToWidth, visibleWidth} from '@earendil-works/pi-tui';
import type {GitState} from './git';
import type {Compaction} from './usage';

export interface FooterView {
  directory: string;
  model: string;
  thinking: string;
  usage: ContextUsage | undefined;
  capacity: number | undefined;
  compaction: Compaction | undefined;
  hit: number | undefined;
  git: GitState;
  branch: string | null;
  statuses: ReadonlyMap<string, string>;
}

// Status providers retain colors, but cannot move the cursor or create rows.
export function statusText(text: string): string {
  let output = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 27) {
      const start = i++;
      if (text[i] === '[') {
        while (i + 1 < text.length && text.charCodeAt(i + 1) < 64) i++;
        i++;
        const parameters = text.slice(start + 2, i);
        if (text[i] === 'm' && /^[\d;:]*$/.test(parameters))
          output += text.slice(start, i + 1);
      } else if (']PX^_'.includes(text[i] ?? ' ')) {
        while (i + 1 < text.length) {
          i++;
          if (text.charCodeAt(i) === 7) break;
          if (text.charCodeAt(i) === 27 && text[i + 1] === '\\') {
            i++;
            break;
          }
        }
      }
    } else if (code === 9 || code === 10 || code === 13) output += ' ';
    else if (code >= 32 && !(code >= 127 && code <= 159)) output += text[i];
  }
  return output;
}

interface Field {
  text: string;
  side: 'left' | 'right';
  priority: number;
}

function row(width: number, fields: Field[], separator: string): string {
  const selected = [...fields];
  const zone = (side: Field['side']) =>
    selected
      .filter(field => field.side === side)
      .map(field => field.text)
      .filter(Boolean)
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
  if (!right) return truncateToWidth(left, width, '…');
  return truncateToWidth(
    left +
      ' '.repeat(
        Math.max(0, width - visibleWidth(left) - visibleWidth(right)),
      ) +
      right,
    width,
    '…',
  );
}

function tokens(value: number): string {
  return value >= 1_000_000
    ? `${+(value / 1_000_000).toFixed(1)}m`
    : value >= 1000
      ? `${+(value / 1000).toFixed(1)}k`
      : `${value}`;
}

function context(theme: Theme, view: FooterView, separator: string): string {
  const capacity = view.usage?.contextWindow ?? view.capacity;
  const size = capacity && capacity > 0 ? tokens(capacity) : '?';
  const used = view.usage?.tokens;
  const percent =
    used != null && capacity && capacity > 0
      ? (used / capacity) * 100
      : undefined;
  let color: 'accent' | 'warning' | 'error' | 'text' = 'text';
  if (percent !== undefined && used != null && view.compaction && capacity) {
    const {enabled, reserveTokens} = view.compaction;
    const threshold = enabled ? capacity - reserveTokens : capacity;
    color =
      used >= threshold * (enabled ? 1 : 0.9)
        ? 'error'
        : used >= threshold * (enabled ? 0.9 : 0.8)
          ? 'warning'
          : 'accent';
  }
  const filled =
    percent === undefined
      ? 0
      : Math.max(0, Math.min(10, Math.round(percent / 10)));
  const meter =
    percent === undefined
      ? ''
      : ` ${theme.fg(color, '━'.repeat(filled))}${theme.fg('borderMuted', '━'.repeat(10 - filled))}`;
  const hit =
    view.hit === undefined
      ? ''
      : `${separator}${theme.fg('muted', 'hit')} ${theme.fg('text', `${+view.hit.toFixed(1)}%`)}`;
  return `${theme.fg('muted', 'ctx')} ${theme.fg(color, percent === undefined ? '?' : `${Math.round(percent)}%`)}${theme.fg('muted', `/${size}`)}${meter}${hit}`;
}

export function renderFooter(
  width: number,
  theme: Theme,
  view: FooterView,
): string[] {
  if (width <= 0) return ['', ''];
  const sep = theme.fg('muted', ' · ');
  const path = statusText(view.directory);
  const split = path.lastIndexOf('/') + 1;
  const directory =
    theme.fg('muted', path.slice(0, split)) +
    theme.fg('accent', theme.bold(path.slice(split)));
  const snapshot = view.git.kind === 'ready' ? view.git.snapshot : undefined;
  const identity =
    snapshot?.branch ??
    (view.git.kind === 'unknown' ? (view.branch ?? '') : '');
  const branch = identity ? theme.fg('accent', statusText(identity)) : '';
  const counts: string[] = [];
  if (snapshot) {
    if (snapshot.operation)
      counts.push(theme.fg('warning', snapshot.operation));
    if (snapshot.conflicts)
      counts.push(theme.fg('error', `!${snapshot.conflicts}`));
    if (snapshot.staged)
      counts.push(theme.fg('success', `+${snapshot.staged}`));
    if (snapshot.modified)
      counts.push(theme.fg('warning', `~${snapshot.modified}`));
    if (snapshot.untracked)
      counts.push(theme.fg('warning', `?${snapshot.untracked}`));
    if (!counts.length) counts.push(theme.fg('muted', 'clean'));
  } else if (view.git.kind === 'unknown')
    counts.push(theme.fg('muted', 'git ?'));
  const worktree = counts.join(sep);
  const divergence = [
    snapshot?.ahead ? theme.fg('accent', `↑${snapshot.ahead}`) : '',
    snapshot?.behind ? theme.fg('warning', `↓${snapshot.behind}`) : '',
  ]
    .filter(Boolean)
    .join(sep);
  const git = [branch, worktree, divergence].filter(Boolean).join(sep);
  const first: Field[] = [];
  const second: Field[] = [];
  const required = (text: string, side: Field['side']): Field => ({
    text,
    side,
    priority: Infinity,
  });
  if (visibleWidth(path) + visibleWidth(git) + (git ? 2 : 0) <= width) {
    first.push(required(directory, 'left'), required(git, 'right'));
  } else if (
    visibleWidth(path) + visibleWidth(branch) + (branch ? 2 : 0) <=
    width
  ) {
    first.push(required(directory, 'left'), required(branch, 'right'));
    second.push(
      required([worktree, divergence].filter(Boolean).join(sep), 'right'),
    );
  } else {
    first.push(
      required(
        truncateToWidth(
          directory,
          Math.max(0, width - visibleWidth(worktree) - (worktree ? 2 : 0)),
          '…',
        ),
        'left',
      ),
      required(worktree, 'right'),
    );
    second.push(
      required(
        truncateToWidth(
          branch,
          Math.max(0, width - visibleWidth(divergence) - (divergence ? 2 : 0)),
          '…',
        ),
        'left',
      ),
      required(divergence, 'right'),
    );
  }
  first.push({text: context(theme, view, sep), side: 'left', priority: 90});
  if (!second.some(field => field.side === 'left' && field.text)) {
    second.push(
      {
        text: theme.fg('text', statusText(view.model)),
        side: 'left',
        priority: 80,
      },
      {text: theme.fg('muted', view.thinking), side: 'left', priority: 70},
    );
  }
  const statuses = [...view.statuses].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  statuses.forEach(([, text], index) =>
    second.push({
      text: statusText(text) + '\x1b[0m',
      side: 'right',
      priority: -index,
    }),
  );
  return [row(width, first, sep), row(width, second, sep)];
}
