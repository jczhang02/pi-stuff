import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import {stripVTControlCharacters} from 'node:util';
import type {Theme} from '@earendil-works/pi-coding-agent';
import {isPendingQuestion} from '../coordinator-mailbox';
import type {AgentRecord, FleetRecord, TaskRecord} from '../records';

export const MAIN_ID = 'main';

export type DisplayState =
  | 'Queued'
  | 'Waiting'
  | 'Held'
  | 'Cancelling'
  | 'Done'
  | 'Incomplete'
  | 'Failed'
  | 'Cancelled'
  | 'Skipped'
  | 'Interrupted'
  | 'Unknown'
  | 'Save failed'
  | 'Unavailable'
  | '';

export interface FleetColumns {
  readonly width: number;
  readonly name: number;
  readonly description: number;
  readonly state: number;
  readonly elapsed: number;
  readonly tokens: number;
}

export function oneLine(text: string): string {
  return stripVTControlCharacters(text)
    .replace(/[\r\n\t]/gu, ' ')
    .replace(/ +/gu, ' ')
    .trim();
}

export function taskForAgent(
  snapshot: FleetRecord,
  agentId: string,
): TaskRecord | undefined {
  const tasks = snapshot.tasks.filter(task => task.agentId === agentId);
  const active = tasks
    .filter(task =>
      ['starting', 'executing', 'waiting', 'cancelling', 'unknown'].includes(
        task.phase,
      ),
    )
    .toSorted((left, right) => left.admittedAt - right.admittedAt)
    .at(-1);
  if (active !== undefined) return active;
  return tasks.filter(task => task.phase !== 'queued').at(-1) ?? tasks.at(-1);
}

export function agentForTask(
  snapshot: FleetRecord,
  taskId: string,
): AgentRecord | undefined {
  const task = snapshot.tasks.find(item => item.id === taskId);
  return task === undefined
    ? undefined
    : snapshot.agents.find(agent => agent.id === task.agentId);
}

export function taskForId(
  snapshot: FleetRecord,
  taskId: string | undefined,
): TaskRecord | undefined {
  return taskId === undefined
    ? undefined
    : snapshot.tasks.find(task => task.id === taskId);
}

export function stateOf(task: TaskRecord | undefined): DisplayState {
  if (task === undefined) return '';
  if (task.durability === 'failed') return 'Save failed';
  if (task.phase === 'queued') return 'Queued';
  if (task.phase === 'waiting') return 'Waiting';
  if (task.phase === 'cancelling') return 'Cancelling';
  if (task.phase === 'unknown') return 'Unknown';
  if (task.phase !== 'ended') return '';
  switch (task.outcome) {
    case 'fulfilled':
      return task.durability === 'saved' ? 'Done' : 'Unavailable';
    case 'unable':
    case 'incomplete':
      return 'Incomplete';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    case 'skipped':
      return 'Skipped';
    case 'interrupted':
      return 'Interrupted';
    default:
      return task.durability === 'saved' ? 'Incomplete' : 'Unavailable';
  }
}

export function stateColor(theme: Theme, state: DisplayState): string {
  if (state === 'Done') return theme.fg('success', state);
  if (state === 'Failed' || state === 'Save failed')
    return theme.fg('error', state);
  if (
    state === 'Queued' ||
    state === 'Waiting' ||
    state === 'Held' ||
    state === 'Cancelling'
  )
    return theme.fg('warning', state);
  if (state === 'Unknown' || state === 'Unavailable')
    return theme.fg('error', state);
  if (state === '') return '';
  return theme.fg('muted', state);
}

export function formatTokens(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.max(0, Math.round(value))}`;
  if (value < 10000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1000000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1000000).toFixed(1)}M`;
}

export function elapsedSeconds(
  task: TaskRecord | undefined,
  now: number,
): number | undefined {
  if (task?.startedAt === null || task?.startedAt === undefined)
    return undefined;
  const end = task.endedAt ?? now;
  return Math.max(0, (end - task.startedAt) / 1000);
}

export function formatElapsed(
  task: TaskRecord | undefined,
  now: number,
): string {
  const seconds = elapsedSeconds(task, now);
  if (seconds === undefined) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function outputTokens(task: TaskRecord | undefined): number | undefined {
  return task?.usage?.output;
}

export function taskNeedsAttention(
  snapshot: FleetRecord,
  task: TaskRecord | undefined,
): boolean {
  if (task === undefined) return false;
  if (
    task.phase === 'unknown' ||
    (snapshot.agents.find(agent => agent.id === task.agentId)?.held === true &&
      snapshot.tasks.some(
        candidate =>
          candidate.agentId === task.agentId && candidate.phase === 'queued',
      )) ||
    task.durability === 'failed' ||
    task.outcome === 'failed' ||
    task.outcome === 'interrupted' ||
    task.outcome === 'incomplete' ||
    task.outcome === 'unable'
  )
    return true;
  return snapshot.messages.some(
    message =>
      (message.taskId === task.id ||
        (message.taskId === null && message.fromTaskId === task.id)) &&
      (message.kind === 'question'
        ? isPendingQuestion(snapshot, message)
        : message.consumedAt === null),
  );
}

function attentionTargets(snapshot: FleetRecord): ReadonlySet<string> {
  const tasks = snapshot.agents.flatMap(agent => {
    const task = taskForAgent(snapshot, agent.id);
    return task !== undefined && taskNeedsAttention(snapshot, task)
      ? [task]
      : [];
  });
  const notices = snapshot.notices.filter(
    notice =>
      !notice.acknowledged &&
      !notice.id.startsWith('ended:') &&
      !notice.id.startsWith('settled:'),
  );
  const mainMessages = snapshot.messages
    .filter(
      message =>
        message.taskId === null &&
        (message.kind === 'question'
          ? isPendingQuestion(snapshot, message)
          : message.consumedAt === null),
    )
    .map(message => message.fromTaskId ?? `message:${message.id}`);
  return new Set([
    ...tasks.map(task => task.id),
    ...notices.map(notice => notice.taskId),
    ...mainMessages,
  ]);
}

export function countAttention(snapshot: FleetRecord): number {
  return attentionTargets(snapshot).size;
}

export function attentionTaskForAgent(
  snapshot: FleetRecord,
  agentId: string,
): TaskRecord | undefined {
  const targets = attentionTargets(snapshot);
  const current = taskForAgent(snapshot, agentId);
  if (current !== undefined && targets.has(current.id)) return current;
  return snapshot.tasks.findLast(
    task => task.agentId === agentId && targets.has(task.id),
  );
}

export function formatRange(
  first: number,
  last: number,
  total: number,
): string {
  if (total === 0) return '0 agents';
  return `${first + 1}-${last + 1} of ${total}`;
}

export function computeFleetColumns(
  snapshot: FleetRecord,
  width: number,
  now: number,
  attentionOnly = false,
): FleetColumns {
  const agents = snapshot.agents;
  const tasks = agents.map(agent =>
    attentionOnly
      ? attentionTaskForAgent(snapshot, agent.id)
      : taskForAgent(snapshot, agent.id),
  );
  const name = agents.reduce(
    (longest, agent) => Math.max(longest, visibleWidth(oneLine(agent.name))),
    visibleWidth(MAIN_ID),
  );
  const state = tasks.reduce(
    (longest, task) =>
      Math.max(longest, visibleWidth(stateOf(task)), 'Held'.length),
    0,
  );
  const elapsed = tasks.reduce(
    (longest, task) =>
      Math.max(longest, visibleWidth(formatElapsed(task, now))),
    1,
  );
  const tokens = tasks.reduce(
    (longest, task) =>
      Math.max(longest, visibleWidth(formatTokens(outputTokens(task)))),
    1,
  );
  const fixed = 19 + state + elapsed + tokens;
  const maxName = Math.max(6, Math.floor(Math.max(24, width - fixed) / 3));
  const maxDescription = Math.max(8, width - fixed - Math.min(name, maxName));
  return {
    width,
    name: Math.min(name, maxName),
    description: maxDescription,
    state,
    elapsed,
    tokens,
  };
}

export function renderFleetRow(
  snapshot: FleetRecord,
  agent: AgentRecord,
  selected: boolean,
  columns: FleetColumns,
  theme: Theme,
  now: number,
  task = taskForAgent(snapshot, agent.id),
): string {
  const marker = selected ? theme.fg('accent', '●') : theme.fg('muted', '○');
  const name = truncateToWidth(oneLine(agent.name), columns.name, '…');
  const nameCell =
    name + ' '.repeat(Math.max(0, columns.name - visibleWidth(name)));
  if (agent.id === MAIN_ID)
    return truncateToWidth(`${marker} ${nameCell}`, columns.width, '');
  const queued = snapshot.tasks.filter(
    candidate =>
      candidate.id !== task?.id &&
      candidate.agentId === agent.id &&
      candidate.phase === 'queued',
  ).length;
  const queue =
    queued > 0
      ? columns.description >= 12
        ? ` · ${queued} ${agent.held ? 'held' : 'queued'}`
        : ` +${queued}`
      : '';
  const description =
    truncateToWidth(
      oneLine(task?.description ?? 'No current assignment'),
      Math.max(0, columns.description - visibleWidth(queue)),
      '…',
    ) + queue;
  const descriptionCell =
    description +
    ' '.repeat(Math.max(0, columns.description - visibleWidth(description)));
  const state = stateColor(
    theme,
    agent.held && task?.phase === 'queued' ? 'Held' : stateOf(task),
  );
  const stateCell =
    state + ' '.repeat(Math.max(0, columns.state - visibleWidth(state)));
  const elapsed = formatElapsed(task, now).padStart(columns.elapsed);
  const tokenValue = formatTokens(outputTokens(task)).padStart(columns.tokens);
  const tokens = `↓ ${tokenValue} tokens`;
  const row = `${marker} ${nameCell}  ${descriptionCell}  ${stateCell}  ${elapsed}  ${tokens}`;
  return truncateToWidth(row, columns.width, '');
}

export function appendWrapped(
  lines: string[],
  text: string,
  prefix: string,
  width: number,
  theme: Theme,
): void {
  const available = Math.max(8, width - visibleWidth(prefix));
  const source = stripVTControlCharacters(text)
    .replaceAll('\r', '')
    .replaceAll('\t', '  ');
  for (const paragraph of source.split('\n')) {
    const wrapped = wrapTextWithAnsi(paragraph, available);
    if (wrapped.length === 0) lines.push(theme.fg('text', prefix));
    else
      for (const line of wrapped)
        lines.push(theme.fg('text', `${prefix}${line}`));
  }
}

export function sectionTitle(
  theme: Theme,
  title: string,
  open: boolean,
): string {
  return `${theme.fg('muted', open ? '▾' : '▸')} ${title}`;
}

export function timestamp(value: number | null): string {
  if (value === null) return '—';
  return new Date(value).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function safeText(
  value: string | null | undefined,
  fallback: string,
): string {
  const trimmed =
    value == null ? undefined : stripVTControlCharacters(value).trim();
  return trimmed ? trimmed : fallback;
}
