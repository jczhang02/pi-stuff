// Throwaway Jaeger-inspired waterfall. Seed timings are sample data, not telemetry.
import {VStack, matchesKey, type Component} from '@earendil-works/pi-tui';
import {
  duration,
  fit,
  metrics,
  panel,
  rows,
  status,
  type LabContext,
  type LabView,
  type ObservationMessage,
} from './shared';

interface Span {
  agent: number;
  title: string;
  start: number;
  end: number;
  live: boolean;
  message?: ObservationMessage;
}

export function createTrace(ctx: LabContext): LabView {
  const roots: Span[] = ctx.agents.map((agent, index) => ({
    agent: index,
    title: agent.name,
    start: -agent.elapsed,
    end: 0,
    live: agent.status === 'running',
  }));
  const toolSpans = new Map<ObservationMessage, Span>();
  for (const [index, agent] of ctx.agents.entries()) {
    const start = roots[index]?.start ?? 0;
    let offset = 4;
    for (const message of agent.messages) {
      if (message.kind !== 'tool') continue;
      toolSpans.set(message, {
        agent: index,
        title: message.name,
        start: start + offset,
        end: start + offset + 7,
        live: false,
        message,
      });
      offset += 10;
    }
  }
  const collapsed = new Set<number>();
  let cursor = 0;
  let zoom = false;
  let detailFocus = false;
  const details = new Map<Span, ReturnType<LabContext['scroll']>>();

  function spans(): Span[] {
    const now = ctx.clock();
    for (const [index, agent] of ctx.agents.entries()) {
      const root = roots[index];
      if (root) {
        // Root measures wall time, including waits between continuation turns.
        if (agent.status === 'running' || root.live) root.end = now;
        root.live = agent.status === 'running';
      }
      for (const message of agent.messages) {
        if (message.kind !== 'tool') continue;
        let span = toolSpans.get(message);
        if (!span) {
          span = {
            agent: index,
            title: message.name,
            start: now,
            end: now,
            live: true,
            message,
          };
          toolSpans.set(message, span);
        }
        if (span.live) span.end = now;
        span.live = message.state === 'running';
      }
    }
    return roots.flatMap(root => [
      root,
      ...(collapsed.has(root.agent)
        ? []
        : [...toolSpans.values()].filter(span => span.agent === root.agent)),
    ]);
  }
  function selected(): Span {
    const list = spans();
    cursor = Math.min(cursor, list.length - 1);
    const span = list[cursor];
    if (!span) throw new Error('Trace requires a span');
    return span;
  }
  function range() {
    const span = selected();
    return zoom
      ? {start: span.start, end: Math.max(span.start + 2, span.end)}
      : {
          start: Math.min(...roots.map(root => root.start)),
          end: Math.max(0, ...roots.map(root => root.end)),
        };
  }
  const tree = ctx.scroll(
    rows(
      width => {
        const list = spans();
        const labelWidth = Math.min(35, Math.floor(width * 0.38));
        const barWidth = Math.max(6, width - labelWidth - 11);
        const extent = range();
        const length = Math.max(1, extent.end - extent.start);
        const axis =
          fit('Agent / tool', labelWidth) +
          fit('0s', Math.floor(barWidth / 2)) +
          fit(duration(length / 2), Math.ceil(barWidth / 2)) +
          ` ${duration(length)}`;
        return [
          ctx.theme.fg('muted', axis),
          ...list.map((span, index) => {
            const agent = ctx.agents[span.agent];
            if (!agent) return '';
            const name = span.message
              ? `  └ ${span.title}`
              : `${collapsed.has(span.agent) ? '\uf105' : '\uf107'} ${status(agent, ctx.theme)}${span.title}`;
            const start = Math.max(
              0,
              Math.floor(((span.start - extent.start) / length) * barWidth),
            );
            const end = Math.min(
              barWidth,
              Math.max(
                start + 1,
                Math.ceil(((span.end - extent.start) / length) * barWidth),
              ),
            );
            const error =
              span.message?.kind === 'tool' && span.message.state === 'error';
            const color =
              error || (!span.message && agent.status === 'failed')
                ? 'error'
                : span.live
                  ? 'accent'
                  : !span.message &&
                      (agent.status === 'waiting' || agent.status === 'stopped')
                    ? 'warning'
                    : 'success';
            const bar =
              start >= barWidth || span.end < extent.start
                ? ' '.repeat(barWidth)
                : ' '.repeat(start) +
                  ctx.theme.fg(color, '━'.repeat(Math.max(0, end - start))) +
                  ' '.repeat(Math.max(0, barWidth - end));
            const line =
              fit(name, labelWidth) +
              bar +
              ` ${duration(span.end - span.start)}`;
            return index === cursor
              ? ctx.theme.bg('selectedBg', fit(line, width))
              : line;
          }),
        ];
      },
      row => {
        if (row > 0 && spans()[row - 1]) {
          cursor = row - 1;
          ctx.select(selected().agent);
          ctx.refresh();
        }
      },
    ),
  );
  function detail(span: Span): Component {
    if (!span.message)
      return rows(width => {
        const agent = ctx.agents[span.agent];
        if (!agent) return [];
        return [
          status(agent, ctx.theme) + agent.name,
          '',
          fit(agent.task, width),
          '',
          fit(agent.activity, width),
          '',
          `执行用量  ${metrics(agent)}`,
          '',
          'Enter 打开完整对话 · i 回复此代理',
        ];
      });
    let viewport = details.get(span);
    if (!viewport) {
      viewport = ctx.scroll(ctx.message(span.agent, span.message));
      details.set(span, viewport);
    }
    if (detailFocus) ctx.activateScroll(viewport);
    return viewport;
  }
  return {
    tick() {
      spans();
    },
    layout(_width, height) {
      const span = selected();
      ctx.select(span.agent);
      ctx.activateScroll(tree);
      return new VStack([
        rows(() => [
          ctx.theme.fg('accent', '执行链路  /  cancellation review'),
          ctx.theme.fg(
            'muted',
            `4 agents · ${toolSpans.size} tools · ${zoom ? '选中区间' : '完整区间'} · 横轴为区间起点后的时间`,
          ),
        ]),
        {
          component: panel(
            () => (detailFocus ? '时间瀑布' : '时间瀑布 · ↑↓ 选择'),
            tree,
            ctx,
          ),
          basis: Math.max(7, Math.floor(height * 0.52)),
          shrink: 0,
        },
        {
          component: panel(
            () =>
              `${span.title} · ${span.message ? '工具完整输出' : '任务详情'}${detailFocus ? ' · 已聚焦' : ''}`,
            detail(span),
            ctx,
          ),
          basis: 0,
          grow: 1,
        },
      ]);
    },
    input(data) {
      if (
        detailFocus &&
        (matchesKey(data, 'down') ||
          data === 'j' ||
          matchesKey(data, 'up') ||
          data === 'k')
      ) {
        details
          .get(selected())
          ?.scrollBy(matchesKey(data, 'down') || data === 'j' ? 1 : -1);
        ctx.refresh();
        return true;
      }
      if (matchesKey(data, 'tab')) detailFocus = !detailFocus;
      else if (matchesKey(data, 'down') || data === 'j')
        cursor = Math.min(spans().length - 1, cursor + 1);
      else if (matchesKey(data, 'up') || data === 'k')
        cursor = Math.max(0, cursor - 1);
      else if (
        matchesKey(data, 'space') ||
        matchesKey(data, 'left') ||
        matchesKey(data, 'right')
      ) {
        const span = selected();
        if (collapsed.has(span.agent)) collapsed.delete(span.agent);
        else collapsed.add(span.agent);
        cursor = spans().findIndex(item => item === roots[span.agent]);
      } else if (data === 'z') zoom = !zoom;
      else if (matchesKey(data, 'enter')) {
        ctx.openConversation(selected().agent);
        return true;
      } else return false;
      ctx.select(selected().agent);
      tree.scrollTo(Math.max(0, cursor - 3));
      ctx.refresh();
      return true;
    },
    hint: () =>
      detailFocus
        ? '↑↓ / PgUp PgDn 滚动输出 · Tab 时间轴 · Enter 对话 · i 回复'
        : '↑↓ 选择 · Space 折叠 · z 缩放区间 · Tab 输出 · Enter 对话 · i 回复 · x 停止',
  };
}
