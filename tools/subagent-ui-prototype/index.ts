// Three fleet layouts inside real Pi; every agent opens the same full conversation view.
// Throwaway UI prototype. All work, messages and counters below are simulated in memory.
import {
  CustomEditor,
  getSelectListTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
  type KeybindingsManager,
} from '@earendil-works/pi-coding-agent';
import {
  Text,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type TUI,
} from '@earendil-works/pi-tui';
import {advance, createAgents, send, stop, type DemoAgent} from './model';
import {Conversation} from './conversation';
import {
  names,
  orderedAgents,
  statusText,
  VariantA,
  VariantB,
  VariantC,
  variants,
  type Variant,
} from './fleet';

function createView(
  tui: TUI,
  theme: Theme,
  close: () => void,
  initial: Variant,
  keys: KeybindingsManager,
  ctx: ExtensionContext,
) {
  let agents = createAgents();
  let selectedId = 'reviewer';
  let viewing: DemoAgent | undefined;
  let variant = initial;
  let controls = false;
  let stopping = false;
  let message = '选中代理后按 Enter，直接进入它的对话。';
  let bodyRows = 12;
  const transcript = new Conversation(tui, ctx.cwd);
  const editor = new CustomEditor(
    tui,
    {
      borderColor: text => theme.fg('border', text),
      selectList: getSelectListTheme(),
    },
    keys,
    {paddingX: 1},
  );
  editor.onSubmit = value => {
    if (!viewing || !value.trim()) return;
    if (value.trim().startsWith('/')) {
      message = '原型暂不执行斜杠命令；可以直接发送一段文字。';
      return;
    }
    send(viewing, value);
    editor.setText('');
    message = viewing.pending
      ? `已交给 ${viewing.name}；当前工具结束后处理。`
      : `已发送给 ${viewing.name}`;
    tui.requestRender();
  };
  const timer = setInterval(() => {
    advance(agents, viewing?.id);
    transcript.settleTools(agents);
    tui.requestRender();
  }, 200);

  function enter(agent: DemoAgent) {
    if (viewing) viewing.draft = editor.getText();
    viewing = agent;
    selectedId = agent.id;
    agent.unread = 0;
    editor.setText(agent.draft);
    message =
      agent.status === '已完成'
        ? '本轮已完成。输入新要求即可在原对话中继续。'
        : '这里的输入只发送给当前代理。';
  }

  function paint(line: string, width: number): string {
    // Pi 0.85.1's bundled light/dark export.pageBg values. Explicit canvas
    // colors prevent Tuistory attach from mixing dark text defaults with a light terminal.
    const bg =
      theme.name === 'light' ? '\x1b[48;2;248;248;248m' : '\x1b[48;2;24;24;30m';
    const fg = theme.getFgAnsi('text');
    const fitted = truncateToWidth(line, width, '…');
    const padded =
      fitted + ' '.repeat(Math.max(0, width - visibleWidth(fitted)));
    return (
      fg +
      bg +
      padded
        .replaceAll('\x1b[0m', `\x1b[0m${fg}${bg}`)
        .replaceAll('\x1b[39m', fg)
        .replaceAll('\x1b[49m', bg) +
      '\x1b[0m'
    );
  }

  return {
    focused: true,
    invalidate() {
      editor.invalidate();
    },
    dispose() {
      clearInterval(timer);
      transcript.clear();
    },
    render(width: number): string[] {
      const height = tui.terminal.rows;
      if (width < 44 || height < 18) {
        return new Text(
          '终端至少需要 44 列 × 18 行。请放大窗口；Esc 返回，Ctrl+Q 退出原型。',
          0,
          0,
        )
          .render(Math.max(1, width))
          .map(line => paint(line, width));
      }
      const inner = width - 4;
      editor.focused = Boolean(viewing) && !controls && !stopping;
      const title = viewing
        ? `主代理${viewing.id === 'main' ? '' : ` › ${viewing.name}`}`
        : 'Subagents  /  代理列表';
      const heading = `${theme.bold(title)}${viewing ? `  ${statusText(viewing.status, theme)} · ${viewing.elapsed}s` : ''}`;
      const subtitle = viewing
        ? `任务：${viewing.task}`
        : '进入现场，查看过程，直接交流。';
      const header = [
        heading,
        theme.fg('muted', subtitle),
        theme.fg(
          'muted',
          `UI PROTOTYPE · 模拟数据 · Pi 原生组件 · ${theme.name} 主题`,
        ),
        theme.fg('border', '─'.repeat(inner)),
      ];
      const others = agents.filter(agent => agent.id !== viewing?.id);
      const counts = `${others.filter(agent => agent.status === '运行中').length} 运行 · ${others.filter(agent => agent.status === '等待输入').length} 待输入 · ${others.reduce((sum, agent) => sum + agent.unread, 0)} 新消息`;
      const background = others
        .map(
          agent =>
            `${agent.name} ${agent.status}${agent.unread ? ` +${agent.unread}` : ''} · ${agent.elapsed}s`,
        )
        .join('  /  ');
      const keyHelp = viewing
        ? 'Esc 列表  Ctrl+O 工具详情  PgUp/PgDn 记录  Ctrl+X 停止'
        : '↑↓ 选择  Enter 进入  m 主代理  Esc 返回 Pi';
      const switcher = controls
        ? `Ctrl+Q 退出 · F2 返回 · ← ${variant} ${names[variant]} → · t 主题 · r 重播`
        : `Ctrl+Q 退出原型 · F2 布局/主题/重播 · ${variant} ${names[variant]}`;
      const editorLines = viewing
        ? [
            theme.fg(
              'accent',
              `发送给 ${viewing.name}${viewing.status === '已完成' ? ' · 继续原对话' : ''}`,
            ),
            ...editor.render(inner),
          ]
        : [];
      const footer = [
        ...editorLines,
        theme.fg(
          stopping ? 'warning' : 'muted',
          stopping
            ? `停止 ${viewing?.name}？y 确认 / n 返回；已有内容保留。`
            : viewing?.scroll
              ? `较早记录 · 距最新 ${viewing.scroll} 行 · Ctrl+End 回到最新`
              : viewing?.status === '运行中'
                ? `${['⠋', '⠙', '⠹', '⠸'][Math.abs(viewing.step) % 4]} ${viewing.activity}${viewing.pending ? ' · 已收到补充消息' : ''}`
                : message,
        ),
        theme.fg('muted', `后台 ${counts} │ ${background}`),
        theme.fg('dim', keyHelp),
        controls ? theme.bg('selectedBg', switcher) : theme.fg('dim', switcher),
      ];
      bodyRows = Math.max(1, height - header.length - footer.length - 2);
      let body: string[];
      if (viewing) {
        const all = transcript.render(viewing, inner);
        viewing.scroll = Math.min(
          viewing.scroll,
          Math.max(0, all.length - bodyRows),
        );
        const end = all.length - viewing.scroll;
        body = all.slice(Math.max(0, end - bodyRows), end);
      } else {
        const ordered = orderedAgents(agents, variant);
        const selected = ordered.findIndex(agent => agent.id === selectedId);
        const renderFleet =
          variant === 'A' ? VariantA : variant === 'B' ? VariantB : VariantC;
        const all = renderFleet(ordered, selected, inner, theme);
        const selectedLine = all.findIndex(line => line.includes('›'));
        const start = Math.max(0, selectedLine - bodyRows + 3);
        body = all.slice(start, start + bodyRows);
      }
      while (body.length < bodyRows) body.push('');
      const lines = ['', ...header, ...body, ...footer, ''];
      return lines.map(line => {
        const fitted = truncateToWidth(line, inner, '…');
        return paint(
          `  ${fitted}${' '.repeat(Math.max(0, inner - visibleWidth(fitted)))}  `,
          width,
        );
      });
    },
    handleInput(data: string) {
      if (matchesKey(data, 'ctrl+q')) {
        close();
        return;
      }
      if (matchesKey(data, 'f2')) {
        controls = !controls;
        tui.requestRender();
        return;
      }
      if (controls) {
        if (matchesKey(data, 'left') || matchesKey(data, 'right')) {
          const direction = matchesKey(data, 'left') ? -1 : 1;
          variant =
            variants[
              (variants.indexOf(variant) + direction + variants.length) %
                variants.length
            ] ?? 'A';
          message = `重开此布局：bun tools/subagent-ui-prototype/run.ts --variant=${variant}`;
        } else if (data === 't') {
          ctx.ui.setTheme(theme.name === 'light' ? 'dark' : 'light');
          transcript.clear();
          editor.invalidate();
        } else if (data === 'r') {
          transcript.clear();
          stopping = false;
          agents = createAgents();
          viewing = undefined;
          selectedId = 'reviewer';
          editor.setText('');
          message = '模拟状态已重置。';
        } else if (matchesKey(data, 'escape')) controls = false;
        tui.requestRender();
        return;
      }
      if (stopping) {
        if (data === 'y' && viewing) {
          stop(viewing);
          transcript.settleTools(agents);
          message = `已停止 ${viewing.name}；其他代理继续运行。`;
        }
        stopping = false;
        tui.requestRender();
        return;
      }
      if (matchesKey(data, 'escape')) {
        if (viewing) {
          viewing.draft = editor.getText();
          viewing = undefined;
          message = '已返回列表；未发送的草稿已保留。';
        } else close();
      } else if (viewing) {
        if (keys.matches(data, 'app.tools.expand'))
          viewing.expanded = !viewing.expanded;
        else if (matchesKey(data, 'pageUp'))
          viewing.scroll += Math.max(1, bodyRows - 2);
        else if (matchesKey(data, 'pageDown'))
          viewing.scroll = Math.max(
            0,
            viewing.scroll - Math.max(1, bodyRows - 2),
          );
        else if (matchesKey(data, 'ctrl+end')) viewing.scroll = 0;
        else if (matchesKey(data, 'ctrl+x') && viewing.status === '运行中')
          stopping = true;
        else editor.handleInput(data);
      } else {
        const ordered = orderedAgents(agents, variant);
        const selected = ordered.findIndex(agent => agent.id === selectedId);
        if (matchesKey(data, 'up') || matchesKey(data, 'down')) {
          const direction = matchesKey(data, 'up') ? -1 : 1;
          selectedId =
            ordered[(selected + direction + ordered.length) % ordered.length]
              ?.id ?? 'main';
        } else if (matchesKey(data, 'enter')) {
          const agent = ordered[selected];
          if (agent) enter(agent);
        } else if (data === 'm') {
          const main = agents[0];
          if (main) enter(main);
        }
      }
      tui.requestRender();
    },
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerFlag('fleet-variant', {
    description: 'Throwaway fleet layout: A, B or C',
    type: 'string',
    default: 'A',
  });
  const open = async (ctx: ExtensionContext) => {
    if (ctx.mode !== 'tui') return;
    const requested = pi.getFlag('fleet-variant');
    const initial = requested === 'B' || requested === 'C' ? requested : 'A';
    await ctx.ui.custom<void>(
      (tui, theme, keys, done) =>
        createView(tui, theme, () => done(), initial, keys, ctx),
      {
        overlay: true,
        overlayOptions: {
          width: '100%',
          maxHeight: '100%',
          anchor: 'top-left',
          margin: 0,
        },
      },
    );
  };
  pi.registerCommand('fleet-prototype', {
    description: 'Open the simulated subagent UI prototype',
    handler: async (_args, ctx) => open(ctx),
  });
  pi.on('session_start', (_event, ctx) => {
    void open(ctx);
  });
}
