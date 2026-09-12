import {getMarkdownTheme, type Theme} from '@earendil-works/pi-coding-agent';
import {
  Markdown,
  Text,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui';
import type {DemoAgent, Status} from './model';

export type Variant = 'A' | 'B' | 'C';
export const variants: Variant[] = ['A', 'B', 'C'];
export const names = {A: '紧凑列表', B: '按状态分组', C: '列表与预览'};

export function statusText(status: Status, theme: Theme): string {
  const color =
    status === '等待输入'
      ? 'warning'
      : status === '已完成'
        ? 'success'
        : status === '已停止'
          ? 'warning'
          : 'accent';
  return theme.fg(color, status);
}

function cell(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, '…');
  return clipped + ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
}

function selection(
  text: string,
  selected: boolean,
  theme: Theme,
  width: number,
): string {
  const line = cell(`${selected ? '›' : ' '} ${text}`, width);
  return selected ? theme.bg('selectedBg', line) : line;
}

export function VariantA(
  agents: DemoAgent[],
  selected: number,
  width: number,
  theme: Theme,
): string[] {
  return [
    theme.fg('dim', `  ${cell('代理', 14)}${cell('状态', 12)}最近活动`),
    '',
    ...agents.flatMap((agent, index) => {
      const badge = agent.unread > 0 ? `  +${agent.unread} 新消息` : '';
      return [
        selection(
          `${cell(agent.name, 14)}${cell(statusText(agent.status, theme), 12)}${agent.activity}${badge}`,
          index === selected,
          theme,
          width,
        ),
        theme.fg(
          'dim',
          `  ${agent.role} · ${agent.tools} 次工具 · ${agent.elapsed}s`,
        ),
        '',
      ];
    }),
  ];
}

export function VariantB(
  agents: DemoAgent[],
  selected: number,
  width: number,
  theme: Theme,
): string[] {
  const groups: Status[] = ['等待输入', '运行中', '已完成', '已停止'];
  return groups.flatMap(status => {
    const members = agents.filter(agent => agent.status === status);
    if (!members.length) return [];
    return [
      theme.bold(`${statusText(status, theme)}  ${members.length}`),
      ...members.flatMap(agent => [
        selection(
          `${agent.name} · ${agent.role}${agent.unread ? ' · 有新消息' : ''}`,
          agents.indexOf(agent) === selected,
          theme,
          width,
        ),
        ...new Text(`  ${agent.activity}`, 0, 0)
          .render(width)
          .map(line => theme.fg('muted', line)),
      ]),
      '',
    ];
  });
}

export function VariantC(
  agents: DemoAgent[],
  selected: number,
  width: number,
  theme: Theme,
): string[] {
  const agent = agents[selected];
  if (!agent) return [];
  const listWidth = width >= 90 ? 31 : width;
  const list = agents.flatMap((entry, index) => [
    selection(entry.name, index === selected, theme, listWidth),
    `  ${statusText(entry.status, theme)} · ${entry.elapsed}s`,
    '',
  ]);
  const detailWidth = width >= 90 ? width - listWidth - 3 : width;
  const latest = agent.messages.findLast(
    message => message.kind === 'assistant',
  );
  const detail = [
    theme.bold(`${agent.name} · ${agent.role}`),
    '',
    ...new Text(agent.task, 0, 0).render(detailWidth),
    '',
    theme.fg('dim', '最近消息'),
    ...new Markdown(
      latest?.kind === 'assistant' ? latest.text : '',
      0,
      0,
      getMarkdownTheme(),
    ).render(detailWidth),
    '',
    theme.fg('accent', 'Enter 进入完整对话'),
  ];
  if (width < 90)
    return [
      ...agents.map((entry, index) =>
        selection(
          `${entry.name} · ${statusText(entry.status, theme)}`,
          index === selected,
          theme,
          width,
        ),
      ),
      theme.fg('border', '─'.repeat(width)),
      ...detail,
    ];
  return Array.from(
    {length: Math.max(list.length, detail.length)},
    (_, index) =>
      `${cell(list[index] ?? '', listWidth)} ${theme.fg('border', '│')} ${detail[index] ?? ''}`,
  );
}

export function orderedAgents(
  agents: DemoAgent[],
  variant: Variant,
): DemoAgent[] {
  if (variant !== 'B') return agents;
  const rank: Record<Status, number> = {
    等待输入: 0,
    运行中: 1,
    已完成: 2,
    已停止: 3,
  };
  return agents.toSorted((a, b) => rank[a.status] - rank[b.status]);
}
