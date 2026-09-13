// Throwaway Resource Explorer candidate: inspect an agent, then its tool evidence.
import {HStack, matchesKey, type Component} from '@earendil-works/pi-tui';
import {
  current,
  fit,
  icons,
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

type ToolMessage = Extract<ObservationMessage, {kind: 'tool'}>;
type Focus = 'agents' | 'tools' | 'detail';
const oneLine = (text: string): string => text.replace(/\s+/gu, ' ').trim();
const clamp = (value: number, length: number): number =>
  length <= 0 ? 0 : Math.max(0, Math.min(length - 1, value));
const label = (message: ToolMessage): string =>
  message.name === 'read' ? '读取' : '执行';
const target = (message: ToolMessage): string =>
  message.name === 'read'
    ? `${message.args.path}${message.args.offset === undefined ? '' : `:${message.args.offset}`}`
    : message.args.command;
const toolColors: Record<
  ToolMessage['state'],
  'error' | 'success' | 'warning'
> = {
  running: 'warning',
  success: 'success',
  error: 'error',
};
const toolLabels: Record<ToolMessage['state'], string> = {
  running: '执行中',
  success: '成功',
  error: '错误',
};
const toolGlyphs: Record<ToolMessage['state'], string> = {
  running: icons.running,
  success: icons.completed,
  error: icons.failed,
};

function toolState(message: ToolMessage, ctx: LabContext): string {
  return ctx.theme.fg(
    toolColors[message.state],
    `${toolGlyphs[message.state]} ${toolLabels[message.state]}`,
  );
}
function latest(agent: ObservationAgent): string {
  const message = agent.messages.at(-1);
  if (!message) return agent.activity;
  if (message.kind !== 'tool') return oneLine(message.text) || agent.activity;
  return `${label(message)} ${target(message)} · ${oneLine(message.detail) || '等待结果'}`;
}
function toolMessages(agent: ObservationAgent): ToolMessage[] {
  return agent.messages.filter(
    (message): message is ToolMessage => message.kind === 'tool',
  );
}
function marker(active: boolean, ctx: LabContext): string {
  return active ? ctx.theme.fg('accent', '\uf105 ') : '  ';
}

export function createInspector(ctx: LabContext): LabView {
  let focus: Focus = 'agents';
  let toolIndex = 0;
  const focusOrder: Focus[] = ['agents', 'tools', 'detail'];
  function selectedTool(): ToolMessage | undefined {
    const messages = toolMessages(current(ctx));
    toolIndex = clamp(toolIndex, messages.length);
    return messages[toolIndex];
  }
  const detailBody: Component = {
    render(width) {
      const message = selectedTool();
      return message
        ? ctx.message(ctx.selected(), message).render(width)
        : ['暂无工具调用'];
    },
    invalidate() {},
  };
  const detailScroll = ctx.scroll(detailBody, 'none');

  function scrollFor(nextFocus: Focus): ViewScroll {
    return nextFocus === 'agents'
      ? agentScroll
      : nextFocus === 'tools'
        ? toolScroll
        : detailScroll;
  }
  function selectAgent(index: number): void {
    if (!ctx.agents.length) return;
    ctx.select(clamp(index, ctx.agents.length));
    toolIndex = 0;
    agentScroll.scrollTo(Math.max(0, ctx.selected() * 3 - 3));
    detailScroll.scrollToStart();
    ctx.activateScroll(scrollFor(focus));
    ctx.refresh();
  }
  const agentRows = rows(
    width =>
      ctx.agents.flatMap((agent, index) => [
        fit(
          `${marker(index === ctx.selected(), ctx)}${status(agent, ctx.theme)}${agent.name} · ${statusText[agent.status]}`,
          width,
        ),
        fit(`  ${agent.activity} · ${latest(agent)}`, width),
        fit(`  ${metrics(agent)} · ${agent.task}`, width),
      ]),
    row => selectAgent(Math.floor(row / 3)),
  );
  const agentScroll = ctx.scroll(agentRows, 'none');
  const toolRows = rows(
    width => {
      const messages = toolMessages(current(ctx));
      if (!messages.length) return ['暂无工具调用 · 代理仍在准备'];
      return messages.map((message, index) =>
        fit(
          `${marker(index === toolIndex, ctx)}${toolState(message, ctx)} ${label(message)} ${target(message)} · ${oneLine(message.detail) || '等待结果'}`,
          width,
        ),
      );
    },
    row => {
      const messages = toolMessages(current(ctx));
      if (!messages.length) return;
      toolIndex = clamp(row, messages.length);
      detailScroll.scrollToStart();
      ctx.refresh();
    },
  );
  const toolScroll = ctx.scroll(toolRows, 'none');

  function setFocus(nextFocus: Focus): void {
    focus = nextFocus;
    ctx.activateScroll(scrollFor(focus));
    ctx.refresh();
  }
  function move(delta: number): void {
    if (focus === 'agents') selectAgent(ctx.selected() + delta);
    else if (focus === 'tools') {
      const messages = toolMessages(current(ctx));
      if (!messages.length) return;
      toolIndex = clamp(toolIndex + delta, messages.length);
      toolScroll.scrollTo(Math.max(0, toolIndex - 3));
      detailScroll.scrollToStart();
      ctx.refresh();
    } else {
      detailScroll.scrollBy(delta);
      ctx.refresh();
    }
  }
  function openConversation(): void {
    ctx.openConversation(clamp(ctx.selected(), ctx.agents.length));
    ctx.refresh();
  }
  function cycle(delta: number): Focus {
    const index = focusOrder.indexOf(focus);
    return focusOrder[(index + delta + focusOrder.length) % focusOrder.length]!;
  }

  function layout(width: number, _height: number): Component {
    if (ctx.agents.length)
      toolIndex = clamp(toolIndex, toolMessages(current(ctx)).length);
    ctx.activateScroll(scrollFor(focus));
    const title = (name: string, value: Focus) =>
      `${name}${focus === value ? ' · 聚焦' : ''}`;
    const agentPanel = panel(
      () => title('代理资源', 'agents'),
      agentScroll,
      ctx,
    );
    const toolPanel = panel(() => title('工具调用', 'tools'), toolScroll, ctx);
    const detailPanel = panel(
      () => title('工具输出', 'detail'),
      detailScroll,
      ctx,
    );
    if (width < 96)
      return focus === 'agents'
        ? agentPanel
        : focus === 'tools'
          ? toolPanel
          : detailPanel;
    const agentWidth = Math.min(32, Math.max(27, Math.floor(width * 0.27)));
    const toolWidth = Math.min(38, Math.max(29, Math.floor(width * 0.29)));
    return new HStack(
      [
        {component: agentPanel, basis: agentWidth, shrink: 0},
        {component: toolPanel, basis: toolWidth, shrink: 0},
        {
          component: detailPanel,
          basis: Math.max(1, width - agentWidth - toolWidth - 2),
          shrink: 0,
        },
      ],
      {gap: 1},
    );
  }

  function input(data: string): boolean {
    const direction =
      matchesKey(data, 'up') || matchesKey(data, 'k')
        ? -1
        : matchesKey(data, 'down') || matchesKey(data, 'j')
          ? 1
          : 0;
    if (matchesKey(data, 'tab')) {
      setFocus(cycle(1));
      return true;
    }
    if (matchesKey(data, 'shift+tab')) {
      setFocus(cycle(-1));
      return true;
    }
    if (matchesKey(data, 'left')) {
      setFocus(cycle(-1));
      return true;
    }
    if (matchesKey(data, 'right')) {
      setFocus(cycle(1));
      return true;
    }
    if (matchesKey(data, 'i')) {
      ctx.select(clamp(ctx.selected(), ctx.agents.length));
      ctx.focusEditor();
      return true;
    }
    if (direction) {
      move(direction);
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
      focus === 'agents'
        ? '↑↓/jk 选择代理 · Tab 切换 · Enter 对话 · i 回复'
        : focus === 'tools'
          ? '↑↓/jk 选择调用 · Tab 切换 · Enter 对话 · i 回复'
          : '↑↓/jk 滚动输出 · Tab 切换 · Enter 对话 · i 回复',
  };
}
