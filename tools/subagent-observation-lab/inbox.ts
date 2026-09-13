// Throwaway Triage Queue candidate: sort agent updates by attention and read state.
import {
  HStack,
  VStack,
  matchesKey,
  type Component,
} from '@earendil-works/pi-tui';
import {
  fit,
  metrics,
  panel,
  rows,
  status,
  statusText,
  type LabContext,
  type LabView,
  type ObservationAgent,
  type ObservationMessage,
  type ViewScroll,
} from './shared';

type Group = 'needs' | 'other' | 'read';
type Focus = 'queue' | 'detail';
type ToolMessage = Extract<ObservationMessage, {kind: 'tool'}>;
const groups: Group[] = ['needs', 'other', 'read'];
const groupLabel: Record<Group, string> = {
  needs: '需要你',
  other: '其他',
  read: '已读',
};
const oneLine = (text: string): string => text.replace(/\s+/gu, ' ').trim();
const clamp = (value: number, length: number): number =>
  length <= 0 ? 0 : Math.max(0, Math.min(length - 1, value));
const target = (message: ToolMessage): string =>
  message.name === 'read'
    ? `${message.args.path}${message.args.offset === undefined ? '' : `:${message.args.offset}`}`
    : message.args.command;
const summary = (agent: ObservationAgent): string => {
  const message = agent.messages.at(-1);
  if (!message) return agent.activity;
  if (message.kind !== 'tool') return oneLine(message.text) || agent.activity;
  return `${message.name === 'read' ? '读取' : '执行'} ${target(message)} · ${oneLine(message.detail) || '等待结果'}`;
};
const subject = (agent: ObservationAgent): string =>
  ({
    waiting: '等待你的回复',
    failed: '需要处理失败',
    completed: '结果已到达',
    stopped: '任务已停止',
    running: '工作进展',
  })[agent.status];

export function createInbox(ctx: LabContext): LabView {
  const unread = new Map<string, boolean>();
  const lastSeen = new Map<string, number>();
  for (const agent of ctx.agents) {
    unread.set(agent.id, true);
    lastSeen.set(agent.id, agent.messages.at(-1)?.seq ?? 0);
  }
  let group: Group = 'needs';
  let focus: Focus = 'queue';
  let selectedAgent = ctx.selected();

  function syncUnread(): void {
    for (const agent of ctx.agents) {
      const latest = agent.messages.at(-1)?.seq ?? 0;
      const previous = lastSeen.get(agent.id) ?? latest;
      if (latest > previous) unread.set(agent.id, true);
      lastSeen.set(agent.id, latest);
    }
  }
  function entries(which: Group): number[] {
    syncUnread();
    return ctx.agents.flatMap((agent, index) => {
      const targetGroup = unread.get(agent.id)
        ? agent.status === 'waiting' || agent.status === 'failed'
          ? 'needs'
          : 'other'
        : 'read';
      return targetGroup === which ? [index] : [];
    });
  }
  selectedAgent = entries('needs')[0] ?? selectedAgent;
  function ensureSelection(): void {
    const list = entries(group);
    if (!list.includes(selectedAgent))
      selectedAgent = list[0] ?? clamp(selectedAgent, ctx.agents.length);
  }
  function selectNotification(row: number): void {
    const list = entries(group);
    if (!list.length) return;
    selectedAgent = list[clamp(row, list.length)]!;
    ctx.select(selectedAgent);
    ctx.refresh();
  }

  const tabRows = rows(width => [
    fit(
      groups
        .map(which => {
          const text = `${groupLabel[which]} ${entries(which).length}`;
          return which === group
            ? ctx.theme.fg('accent', `\uf105 ${text}`)
            : `  ${text}`;
        })
        .join('  '),
      width,
    ),
  ]);
  const noticeRows = rows(
    width => {
      const list = entries(group);
      if (!list.length) return ['暂无通知 · 按 ←→ 切换分组'];
      return list.map(index => {
        const agent = ctx.agents[index];
        if (!agent) return '';
        const marker =
          index === selectedAgent ? ctx.theme.fg('accent', '\uf105 ') : '  ';
        const readMarker = unread.get(agent.id)
          ? ctx.theme.fg('accent', '\uf111 ')
          : ctx.theme.fg('muted', '\uf10c ');
        return fit(
          `${marker}${readMarker}${status(agent, ctx.theme)}${agent.name} · ${subject(agent)} · ${summary(agent)}  ${metrics(agent)}`,
          width,
        );
      });
    },
    row => selectNotification(row),
  );
  const queueScroll = ctx.scroll(new VStack([tabRows, noticeRows]), 'none');
  const conversations = ctx.agents.map((_agent, index) =>
    ctx.conversation(index),
  );
  function selected(): ObservationAgent {
    const agent = ctx.agents[clamp(selectedAgent, ctx.agents.length)];
    if (!agent) throw new Error('Selected inbox notification is missing');
    return agent;
  }
  function detailScroll(): ViewScroll {
    const viewport = conversations[ctx.agents.indexOf(selected())];
    if (!viewport) throw new Error('Missing inbox conversation viewport');
    return viewport;
  }
  function setGroup(nextGroup: Group): void {
    group = nextGroup;
    ensureSelection();
    ctx.select(selectedAgent);
    ctx.activateScroll(queueScroll);
    ctx.refresh();
  }
  function move(delta: number): void {
    const list = entries(group);
    if (!list.length) return;
    const row = list.indexOf(selectedAgent);
    selectNotification(row < 0 ? 0 : clamp(row + delta, list.length));
  }
  function toggleRead(): void {
    const agent = selected();
    unread.set(agent.id, !unread.get(agent.id));
    group = unread.get(agent.id)
      ? agent.status === 'waiting' || agent.status === 'failed'
        ? 'needs'
        : 'other'
      : 'read';
    ensureSelection();
    ctx.select(selectedAgent);
    ctx.refresh();
  }
  function openConversation(): void {
    ctx.openConversation(selectedAgent);
    ctx.refresh();
  }

  function layout(width: number, _height: number): Component {
    syncUnread();
    ensureSelection();
    ctx.select(selectedAgent);
    const agent = selected();
    const queuePanel = panel(
      () =>
        `收件箱 · ${groupLabel[group]}${focus === 'queue' ? ' · 聚焦' : ''}`,
      queueScroll,
      ctx,
    );
    const detailPanel = panel(
      () =>
        `${agent.name} · ${statusText[agent.status]} · 完整对话${focus === 'detail' ? ' · 聚焦' : ''}`,
      detailScroll(),
      ctx,
    );
    ctx.activateScroll(focus === 'queue' ? queueScroll : detailScroll());
    if (width < 92) return focus === 'queue' ? queuePanel : detailPanel;
    const queueWidth = Math.min(40, Math.max(31, Math.floor(width * 0.35)));
    return new HStack(
      [
        {component: queuePanel, basis: queueWidth, shrink: 0},
        {component: detailPanel, basis: width - queueWidth - 1, shrink: 0},
      ],
      {gap: 1},
    );
  }

  function input(data: string): boolean {
    const vertical =
      matchesKey(data, 'up') || matchesKey(data, 'k')
        ? -1
        : matchesKey(data, 'down') || matchesKey(data, 'j')
          ? 1
          : 0;
    const horizontal = matchesKey(data, 'left')
      ? -1
      : matchesKey(data, 'right')
        ? 1
        : 0;
    if (matchesKey(data, 'tab') || matchesKey(data, 'shift+tab')) {
      focus = focus === 'queue' ? 'detail' : 'queue';
      ctx.activateScroll(focus === 'queue' ? queueScroll : detailScroll());
      ctx.refresh();
      return true;
    }
    if (matchesKey(data, 'i')) {
      ctx.select(selectedAgent);
      ctx.focusEditor();
      return true;
    }
    if (matchesKey(data, 'u')) {
      toggleRead();
      return true;
    }
    if (focus === 'queue') {
      if (horizontal) {
        setGroup(
          groups[
            Math.max(
              0,
              Math.min(groups.length - 1, groups.indexOf(group) + horizontal),
            )
          ]!,
        );
        return true;
      }
      if (vertical) {
        move(vertical);
        return true;
      }
      if (matchesKey(data, 'enter')) {
        openConversation();
        return true;
      }
      return false;
    }
    const viewport = detailScroll();
    if (vertical) {
      viewport.scrollBy(vertical);
      ctx.refresh();
      return true;
    }
    if (matchesKey(data, 'enter')) {
      openConversation();
      return true;
    }
    return false;
  }

  return {
    layout,
    input,
    hint: () =>
      focus === 'queue'
        ? '↑↓/jk 选择 · ←→ 分组 · Tab 对话 · u 已读 · i 回复'
        : '↑↓/jk 滚动 · Tab 收件箱 · u 已读 · i 回复',
  };
}
