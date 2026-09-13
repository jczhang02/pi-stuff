// Throwaway UI contracts shared by five source-informed observation candidates.
import type {Theme} from '@earendil-works/pi-coding-agent';
import {
  HStack,
  ScrollView,
  VStack,
  truncateToWidth,
  visibleWidth,
  type Component,
} from '@earendil-works/pi-tui';
import type {
  ObservationAgent,
  ObservationMessage,
} from '../subagent-observation-prototype/scenario';

export type {ObservationAgent, ObservationMessage};
export type Variant = 'inspector' | 'monitor' | 'inbox' | 'trace' | 'stacks';

// Pi 0.85.1 has a runtime-writable primary field, but no setPrimary API.
export class ViewScroll extends ScrollView {
  override primary = false;
}

export interface LabContext {
  agents: ObservationAgent[];
  theme: Theme;
  selected(): number;
  select(index: number): void;
  refresh(): void;
  focusEditor(): void;
  openConversation(index: number): void;
  conversation(index: number): ViewScroll;
  message(index: number, message: ObservationMessage): Component;
  scroll(component: Component, follow?: 'none' | 'end'): ViewScroll;
  activateScroll(scroll: ViewScroll): void;
  rows(): number;
  clock(): number;
}

export interface LabView {
  layout(width: number, height: number): Component;
  input(data: string): boolean;
  hint(): string;
  tick?(): void;
}

export const icons = {
  running: '\uf10c',
  waiting: '\uf059',
  completed: '\uf00c',
  stopped: '\uf04d',
  failed: '\uf06a',
};
export const statusText = {
  running: '运行中',
  waiting: '等待回复',
  completed: '已完成',
  stopped: '已停止',
  failed: '失败',
};
export const amount = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
export const duration = (n: number) =>
  n >= 60
    ? `${Math.floor(n / 60)}m ${Math.floor(n % 60)}s`
    : `${Math.floor(n)}s`;
export const metrics = (agent: ObservationAgent) =>
  `${duration(agent.elapsed)} · \uf062 ${amount(agent.inputTokens)} · \uf063 ${amount(agent.outputTokens)}`;
export function fit(text: string, width: number): string {
  const clipped = truncateToWidth(text, Math.max(0, width), '…');
  return clipped + ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
}
export function status(agent: ObservationAgent, theme: Theme): string {
  const color =
    agent.status === 'failed'
      ? 'error'
      : agent.status === 'waiting' || agent.status === 'stopped'
        ? 'warning'
        : agent.status === 'completed'
          ? 'success'
          : 'muted';
  return theme.fg(color, `${icons[agent.status]} `);
}

export function rows(
  render: (width: number) => string[],
  click?: (row: number, column: number) => void,
): Component {
  return {
    render: width => render(width).map(line => truncateToWidth(line, width)),
    invalidate() {},
    handleMouse(event) {
      if (click && event.type === 'press' && event.button === 'left') {
        click(event.y, event.x);
        return {handled: true};
      }
      return undefined;
    },
  };
}

// A native layout frame: the body remains a layout node, so ScrollView receives
// viewport allocation and mouse events instead of being flattened to text.
export function panel(
  title: () => string,
  body: Component,
  ctx: LabContext,
): Component {
  const border = (text: string) => ctx.theme.fg('borderMuted', text);
  const side = () =>
    rows(() => Array.from({length: ctx.rows()}, () => border('│')));
  return new VStack([
    rows(width => [border(`╭─ ${fit(title(), Math.max(0, width - 6))} ─╮`)]),
    {
      component: new HStack([
        {component: side(), basis: 1, shrink: 0},
        {component: body, basis: 0, grow: 1},
        {component: side(), basis: 1, shrink: 0},
      ]),
      basis: 0,
      grow: 1,
    },
    rows(width => [border(`╰${'─'.repeat(Math.max(0, width - 2))}╯`)]),
  ]);
}

export function current(ctx: LabContext): ObservationAgent {
  const agent = ctx.agents[ctx.selected()];
  if (!agent) throw new Error('Selected agent is missing');
  return agent;
}
