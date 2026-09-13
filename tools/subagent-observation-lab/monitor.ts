// Throwaway btop-inspired telemetry view. Every chart point is a fixture delta.
import {HStack, VStack, matchesKey, visibleWidth} from '@earendil-works/pi-tui';
import {
  amount,
  duration,
  fit,
  metrics,
  panel,
  rows as rowComponent,
  status,
  statusText,
  type LabContext,
  type LabView,
  type ObservationAgent,
  type ViewScroll,
} from './shared';

type SortKey = 'name' | 'time' | 'input' | 'output';
interface TokenHistory {
  input: number[];
  output: number[];
}

const HISTORY = 72;
const SPARKS = '▁▂▃▄▅▆▇█';

function right(text: string, width: number): string {
  const value = fit(text, width).trimEnd();
  return ' '.repeat(Math.max(0, width - visibleWidth(value))) + value;
}

function delta(current: number, previous: number): number {
  return current >= previous ? current - previous : 0;
}

function series(values: readonly number[], width: number): number[] {
  const recent = values.slice(-Math.max(1, width));
  return [...Array(Math.max(0, width - recent.length)).fill(0), ...recent];
}

function sparkline(values: readonly number[], width: number): string {
  const points = series(values, width);
  const max = Math.max(0, ...points);
  if (!max) return '·'.repeat(width);
  return points
    .map(value => {
      if (!value) return '·';
      const level = Math.min(
        SPARKS.length - 1,
        Math.max(0, Math.ceil((value / max) * (SPARKS.length - 1))),
      );
      return SPARKS[level] ?? SPARKS[0];
    })
    .join('');
}

function chart(
  values: readonly number[],
  width: number,
  height: number,
): string[] {
  const points = series(values, width);
  const max = Math.max(0, ...points);
  if (!max) return Array.from({length: height}, () => '·'.repeat(width));
  return Array.from({length: height}, (_, row) => {
    const threshold = (height - row) / height;
    return points.map(value => (value / max >= threshold ? '█' : ' ')).join('');
  });
}

function sortAgents(
  agents: readonly ObservationAgent[],
  sort: SortKey,
): Array<{agent: ObservationAgent; index: number}> {
  return agents
    .map((agent, index) => ({agent, index}))
    .sort((a, b) => {
      if (sort === 'name')
        return a.agent.name.localeCompare(b.agent.name) || a.index - b.index;
      const value =
        sort === 'time'
          ? b.agent.elapsed - a.agent.elapsed
          : sort === 'input'
            ? b.agent.inputTokens - a.agent.inputTokens
            : b.agent.outputTokens - a.agent.outputTokens;
      return value || a.index - b.index;
    });
}

const sortLabels: Record<SortKey, string> = {
  name: '名称',
  time: '时间',
  input: '输入',
  output: '输出',
};
const sortLabel = (sort: SortKey) => sortLabels[sort];

export function createMonitor(ctx: LabContext): LabView {
  const snapshots = ctx.agents.map(agent => ({
    input: agent.inputTokens,
    output: agent.outputTokens,
  }));
  const histories: TokenHistory[] = ctx.agents.map(() => ({
    input: [],
    output: [],
  }));
  const fleet: TokenHistory = {input: [], output: []};
  const conversations: ViewScroll[] = ctx.agents.map((_, index) =>
    ctx.conversation(index),
  );
  const details = ctx.agents.map((_, index) => {
    const conversation = conversations[index];
    if (!conversation)
      throw new Error(`Missing monitor conversation at ${index}`);
    return new VStack([
      rowComponent(width => detailLines(ctx, index, width)),
      {component: conversation, basis: 0, grow: 1},
    ]);
  });
  let sampledAt = -1;
  let sort: SortKey = 'time';
  let detailIndex = ctx.selected();
  let compactGraph = false;

  function updateSamples(): void {
    const now = Math.floor(ctx.clock());
    if (now === sampledAt) return;
    sampledAt = now;
    let input = 0;
    let output = 0;
    for (const [index, agent] of ctx.agents.entries()) {
      const snapshot = snapshots[index];
      const history = histories[index];
      if (!snapshot || !history) continue;
      const inDelta = delta(agent.inputTokens, snapshot.input);
      const outDelta = delta(agent.outputTokens, snapshot.output);
      snapshot.input = agent.inputTokens;
      snapshot.output = agent.outputTokens;
      history.input.push(inDelta);
      history.output.push(outDelta);
      history.input.splice(0, Math.max(0, history.input.length - HISTORY));
      history.output.splice(0, Math.max(0, history.output.length - HISTORY));
      input += inDelta;
      output += outDelta;
    }
    fleet.input.push(input);
    fleet.output.push(output);
    fleet.input.splice(0, Math.max(0, fleet.input.length - HISTORY));
    fleet.output.splice(0, Math.max(0, fleet.output.length - HISTORY));
  }

  function select(index: number): void {
    if (!ctx.agents[index]) return;
    detailIndex = index;
    ctx.select(index);
    const viewport = conversations[index];
    if (viewport) ctx.activateScroll(viewport);
    ctx.refresh();
  }

  function graphLines(width: number): string[] {
    updateSamples();
    const lineWidth = Math.min(HISTORY, Math.max(8, width - 26));
    const line = (label: string, value: string) =>
      fit(`${ctx.theme.fg('muted', `${label.padEnd(10)} `)}${value}`, width);
    const activeTools = ctx.agents.reduce(
      (count, agent) =>
        count +
        agent.messages.filter(
          message => message.kind === 'tool' && message.state === 'running',
        ).length,
      0,
    );
    const states = (status: ObservationAgent['status']) =>
      ctx.agents.filter(agent => agent.status === status).length;
    const state = `${states('running')} running · ${states('waiting')} waiting · ${states('failed')} failed · ${states('completed')} complete`;
    const inputTotal = ctx.agents.reduce(
      (sum, agent) => sum + agent.inputTokens,
      0,
    );
    const outputTotal = ctx.agents.reduce(
      (sum, agent) => sum + agent.outputTokens,
      0,
    );
    if (compactGraph) {
      return [
        line(
          'OUTPUT Δ',
          `${ctx.theme.fg('success', sparkline(fleet.output, lineWidth))} ${amount(fleet.output.at(-1) ?? 0)}/s`,
        ),
        line(
          'INPUT Δ',
          `${ctx.theme.fg('accent', sparkline(fleet.input, lineWidth))} ${amount(fleet.input.at(-1) ?? 0)}/s`,
        ),
        line(
          'FLEET',
          `${amount(inputTotal)} in · ${amount(outputTotal)} out · ${activeTools} tools · ${state}`,
        ),
      ];
    }
    const outputChart = chart(fleet.output, lineWidth, 3);
    const miniWidth = Math.min(20, Math.max(8, Math.floor((width - 28) / 4)));
    const lines = [
      line(
        'OUTPUT Δ',
        `${ctx.theme.fg('success', outputChart[0] ?? '')} max ${amount(Math.max(0, ...fleet.output))}`,
      ),
      ...outputChart
        .slice(1)
        .map(row => fit(`           ${ctx.theme.fg('success', row)}`, width)),
      line(
        'INPUT Δ',
        `${ctx.theme.fg('accent', sparkline(fleet.input, lineWidth))} ${amount(fleet.input.at(-1) ?? 0)}/s`,
      ),
      line(
        'FLEET',
        `${amount(inputTotal)} in · ${amount(outputTotal)} out · ${activeTools} active tools · ${state}`,
      ),
    ];
    for (const [index, agent] of ctx.agents.entries()) {
      const history = histories[index];
      if (!history) continue;
      lines.push(
        fit(
          `${status(agent, ctx.theme)}${fit(agent.name, 10)} ${ctx.theme.fg('accent', sparkline(history.input, miniWidth))} ${ctx.theme.fg('success', sparkline(history.output, miniWidth))}`,
          width,
        ),
      );
    }
    return lines;
  }

  function tableLines(width: number): string[] {
    const items = sortAgents(ctx.agents, sort);
    const nameWidth = Math.min(
      14,
      Math.max(7, ...items.map(item => visibleWidth(item.agent.name))),
    );
    const times = items.map(item => duration(item.agent.elapsed));
    const inputs = items.map(item => amount(item.agent.inputTokens));
    const outputs = items.map(item => amount(item.agent.outputTokens));
    const timeWidth = Math.max(4, ...times.map(visibleWidth));
    const inputWidth = Math.max(3, ...inputs.map(visibleWidth));
    const outputWidth = Math.max(3, ...outputs.map(visibleWidth));
    const activityWidth = Math.max(
      10,
      width - nameWidth - timeWidth - inputWidth - outputWidth - 12,
    );
    const header = `  ${fit('Agent', nameWidth)} ${fit('State / activity', activityWidth)} ${right('Time', timeWidth)} ${right('In', inputWidth)} ${right('Out', outputWidth)}`;
    const result = [ctx.theme.fg('muted', fit(header, width))];
    for (const [position, {agent, index}] of items.entries()) {
      const selected = ctx.selected() === index;
      const marker = selected ? ctx.theme.fg('accent', '\uf105 ') : '  ';
      const activity = fit(
        `${status(agent, ctx.theme)}${ctx.theme.fg('muted', statusText[agent.status])} · ${agent.activity}`,
        activityWidth,
      );
      const row = `${marker}${fit(agent.name, nameWidth)} ${activity} ${right(times[position] ?? '', timeWidth)} ${right(inputs[position] ?? '', inputWidth)} ${right(outputs[position] ?? '', outputWidth)}`;
      const line = fit(row, width);
      result.push(selected ? ctx.theme.bg('selectedBg', line) : line);
    }
    return result;
  }

  const graph = rowComponent(graphLines);
  const table = rowComponent(tableLines, row => {
    const item = sortAgents(ctx.agents, sort)[row - 1];
    if (row > 0 && item) select(item.index);
  });

  return {
    layout(width, height) {
      if (ctx.agents[ctx.selected()]) detailIndex = ctx.selected();
      compactGraph = width < 80 || height < 18;
      const active = conversations[detailIndex];
      if (active && !compactGraph) ctx.activateScroll(active);
      const graphHeight = compactGraph
        ? 5
        : Math.max(9, Math.min(13, Math.floor(height * 0.44)));
      const process = panel(
        () => `进程资源 · 按 ${sortLabel(sort)} 排序`,
        table,
        ctx,
      );
      const detailsPanel = panel(
        () => `${ctx.agents[detailIndex]?.name ?? '代理'} · 最近活动`,
        details[detailIndex] ?? rowComponent(() => []),
        ctx,
      );
      if (compactGraph)
        return new VStack([
          {
            component: panel(() => '令牌流量 · 每秒输入/输出', graph, ctx),
            basis: 5,
            shrink: 0,
          },
          {component: process, basis: 0, grow: 1},
        ]);
      const lower =
        width < 96
          ? new VStack([
              {
                component: process,
                basis: Math.max(7, Math.floor(height * 0.34)),
                shrink: 0,
              },
              {component: detailsPanel, basis: 0, grow: 1},
            ])
          : new HStack(
              [
                {
                  component: process,
                  basis: Math.floor((width - 3) * 0.47),
                  shrink: 0,
                },
                {
                  component: rowComponent(() => [
                    ctx.theme.fg('borderMuted', '│'),
                  ]),
                  basis: 1,
                  shrink: 0,
                },
                {
                  component: detailsPanel,
                  basis: Math.ceil((width - 3) * 0.53),
                  shrink: 0,
                },
              ],
              {gap: 1},
            );
      return new VStack([
        {
          component: panel(() => '令牌流量 · 每秒增量 · 输入/输出', graph, ctx),
          basis: graphHeight,
          shrink: 0,
        },
        {component: lower, basis: 0, grow: 1},
      ]);
    },
    input(data) {
      const items = sortAgents(ctx.agents, sort);
      const position = Math.max(
        0,
        items.findIndex(item => item.index === ctx.selected()),
      );
      if (matchesKey(data, 'down') || data === 'j') {
        const next = items[Math.min(items.length - 1, position + 1)];
        if (next) select(next.index);
      } else if (matchesKey(data, 'up') || data === 'k') {
        const previous = items[Math.max(0, position - 1)];
        if (previous) select(previous.index);
      } else if (data === '0') {
        sort = 'name';
        ctx.refresh();
      } else if (data === '1') {
        sort = 'time';
        ctx.refresh();
      } else if (data === '2') {
        sort = 'input';
        ctx.refresh();
      } else if (data === '3') {
        sort = 'output';
        ctx.refresh();
      } else if (matchesKey(data, 'enter')) {
        ctx.openConversation(ctx.selected());
      } else if (data === 'i') {
        ctx.focusEditor();
      } else return false;
      return true;
    },
    hint: () =>
      '↑↓/jk 选择 · 0 名称 1 时间 2 输入 3 输出排序 · Enter 完整对话 · i 回复',
    tick: updateSamples,
  };
}

function detailLines(ctx: LabContext, index: number, width: number): string[] {
  const agent = ctx.agents[index];
  if (!agent) return [];
  return [
    fit(
      `${status(agent, ctx.theme)}${agent.name} · ${statusText[agent.status]}`,
      width,
    ),
    fit(agent.task, width),
    fit(`${agent.activity} · ${metrics(agent)}`, width),
    ctx.theme.fg('muted', '最近活动记录 · Enter 查看完整对话'),
  ];
}
