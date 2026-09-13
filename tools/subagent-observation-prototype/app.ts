// Isolated composition host for three UI candidates. This is not InteractiveMode.
import {
  CustomEditor,
  FooterComponent,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';
import {
  CombinedAutocompleteProvider,
  HStack,
  Input,
  ProcessTerminal,
  ScrollView,
  TuiAltScreen,
  VStack,
  Text,
  matchesKey,
  isKeyRelease,
  setKeybindings,
  type Component,
} from '@earendil-works/pi-tui';
import {KeybindingsManager} from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js';
import {
  getEditorTheme,
  initTheme,
  theme,
} from '../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';
import {Schema} from 'effect';
import {
  createScenario,
  advance,
  send,
  stop,
  type ObservationAgent,
} from './scenario';
import {createSessions} from './sessions';
import {canvas, decorateEditor, dynamic, fleetRows} from './chrome';
import {Transcript} from './transcript';

const variant = Schema.decodeUnknownSync(
  Schema.Literals(['workspace', 'split', 'timeline']),
)(process.env.PI_OBSERVATION_VARIANT);
initTheme(process.env.PI_OBSERVATION_THEME ?? 'light', false);
// Search occupies layout space. Disable Pi's floating search dialog completely.
const keys = new KeybindingsManager({'tui.altScreen.search': []});
setKeybindings(keys);
const terminal = new ProcessTerminal();
const write = terminal.write.bind(terminal);
terminal.write = data => write(canvas(data, theme));
const tui = new TuiAltScreen(terminal, true, undefined, {mouse: true});
const agents = createScenario();
const sessions = await createSessions(
  agents,
  process.cwd(),
  process.env.PI_CODING_AGENT_DIR ?? process.cwd(),
);

// Pi 0.85.1's layout reads this runtime-writable field to choose keyboard-scroll
// ownership. This prototype seam is version-bound; Pi has no setPrimary API.
class FocusScrollView extends ScrollView {
  override primary = false;
}
interface Pane {
  agent: ObservationAgent;
  transcript: Transcript;
  scroll: FocusScrollView;
  editor: CustomEditor;
  footer: FooterComponent;
  body: Component;
  notices: string[];
}
const footerData = {
  getGitBranch: () => null,
  getExtensionStatuses: () => new Map<string, string>(),
  getAvailableProviderCount: () => 1,
  onBranchChange: () => () => {},
};
let active = 0;
let selected = 0;
let childIndex = 1;
let fleetFocused = false;
let searching = false;
let matchIndex = -1;
let exiting = false;
let finish: () => void = () => {};
const done = new Promise<void>(resolve => {
  finish = resolve;
});

function sessionFor(agent: ObservationAgent): AgentSession {
  const session = sessions.sessions.get(agent.id);
  if (!session) throw new Error(`Missing session: ${agent.id}`);
  return session;
}
const panes: Pane[] = agents.map(agent => {
  const transcript = new Transcript([agent], tui, theme);
  const notices: string[] = [];
  const body = new VStack([
    transcript,
    dynamic(width =>
      notices.flatMap(text =>
        new Text(theme.fg('warning', text), 1, 1).render(width),
      ),
    ),
  ]);
  const scroll = new FocusScrollView(body, {
    follow: 'end',
    overscroll: 'contain',
    scrollbar: 'auto',
    scrollbarTrackStyle: text => theme.fg('scrollbarTrack', text),
    scrollbarThumbStyle: text => theme.fg('scrollbarThumb', text),
  });
  const editor = new CustomEditor(tui, getEditorTheme(), keys, {paddingX: 0});
  const handleMouse = editor.handleMouse.bind(editor);
  editor.handleMouse = event => {
    if (event.type === 'press' && current().agent !== agent)
      activate(agents.indexOf(agent));
    return handleMouse(event);
  };
  editor.borderColor = theme.getThinkingBorderColor('medium');
  decorateEditor(editor, agent, theme);
  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(
      [
        {name: 'help', description: '查看快捷键'},
        {name: 'stats', description: '查看当前任务与用量'},
        {name: 'stop', description: '停止当前代理'},
      ],
      process.cwd(),
    ),
  );
  editor.onSubmit = text => {
    if (!text.trim()) return;
    if (text.startsWith('/')) {
      if (text.trim() === '/stop') stop(agent);
      else if (text.trim() === '/help')
        notices.push(
          'Down 选择代理；Enter 进入；Alt+Left 返回 main；Ctrl+Shift+F 搜索；Ctrl+O 工具详情；Esc 停止；Ctrl+D 退出。',
        );
      else if (text.trim() === '/stats')
        notices.push(
          `${agent.name} · ${agent.task}\n${agent.activity}\n${agent.inputTokens} input · ${agent.outputTokens} output · ${agent.elapsed}s`,
        );
      else {
        notices.push(`无法执行 ${text.trim()}。使用 /help 查看当前会话命令。`);
        tui.requestRender();
        return;
      }
    } else send(agent, text);
    editor.addToHistory(text);
    editor.setText('');
    scroll.scrollToEnd();
    timelineScroll.scrollToEnd();
    tui.requestRender();
  };
  editor.onAction('app.tools.expand', () => {
    agent.expanded = !agent.expanded;
    tui.requestRender();
  });
  editor.onAction('app.clear', () => {
    editor.setText('');
    tui.requestRender();
  });
  editor.onCtrlD = () => {
    exiting = true;
    finish();
  };
  editor.onEscape = () => {
    if (agent.status === 'running') stop(agent);
    else activate(0);
    tui.requestRender();
  };
  const footer = new FooterComponent(sessionFor(agent), footerData);
  footer.setAutoCompactEnabled(false);
  return {agent, transcript, scroll, editor, footer, body, notices};
});
const timeline = new Transcript(agents, tui, theme, true);
const timelineScroll = new FocusScrollView(
  new VStack([
    timeline,
    dynamic(width =>
      current().notices.flatMap(text =>
        new Text(theme.fg('warning', text), 1, 0).render(width),
      ),
    ),
  ]),
  {
    follow: 'end',
    overscroll: 'contain',
    scrollbar: 'auto',
    scrollbarThumbStyle: text => theme.fg('scrollbarThumb', text),
  },
);
const searchInput = new Input({prompt: '搜索 '});
searchInput.onSubmit = () => findNext(1);
searchInput.onEscape = () => {
  searching = false;
  currentTranscript().query = '';
  mount();
};

function current(): Pane {
  const pane = panes[active];
  if (!pane) throw new Error('Missing active pane');
  return pane;
}
const currentScroll = () =>
  variant === 'timeline' ? timelineScroll : current().scroll;
const currentTranscript = () =>
  variant === 'timeline' ? timeline : current().transcript;

function findNext(direction: number): void {
  const transcript = currentTranscript();
  transcript.query = searchInput.getValue();
  const matches = transcript.matches(transcript.query);
  matchIndex = matches.length
    ? (matchIndex + direction + matches.length) % matches.length
    : -1;
  const row = matches[matchIndex];
  if (row !== undefined) currentScroll().scrollTo(row, {disableFollow: true});
  tui.requestRender();
}

const fleet = dynamic(width => [
  ...fleetRows(agents, width, theme, selected, fleetFocused),
  theme.fg(
    'dim',
    fleetFocused
      ? '↑↓ 选择 · Enter 进入 · x 停止 · Esc 返回输入'
      : `空输入 ↓ 选择代理 · Alt+Left main · Ctrl+Shift+F 搜索${variant === 'split' ? ' · F6 切换输入' : ''}`,
  ),
]);
fleet.handleMouse = event => {
  if (
    event.type === 'press' &&
    event.button === 'left' &&
    event.y < agents.length
  ) {
    activate(event.y);
    return {handled: true};
  }
  return undefined;
};
const searchRow = new HStack([
  {component: searchInput, basis: 0, grow: 1},
  dynamic(() => {
    const count = currentTranscript().matches(searchInput.getValue()).length;
    return [
      theme.fg(
        'muted',
        `${Math.max(0, matchIndex + 1)}/${count} · Enter 下一个 · Esc 关闭`,
      ),
    ];
  }),
]);

function paneLayout(pane: Pane): VStack {
  return new VStack([
    {component: pane.scroll, basis: 0, grow: 1},
    ...(searching && pane === current() ? [searchRow] : []),
    pane.editor,
    pane.footer,
  ]);
}

function mount(): void {
  if (terminal.columns < 50 || terminal.rows < 18) {
    tui.setLayoutRoot(
      new Text('至少需要 50 列 × 18 行。放大终端继续；Ctrl+D 退出。', 0, 0),
    );
    tui.setFocus({
      render: () => [],
      invalidate() {},
      handleInput: data => {
        if (matchesKey(data, 'ctrl+d')) finish();
      },
    });
    tui.requestRender(true);
    return;
  }
  for (const pane of panes) pane.scroll.primary = pane === current();
  timelineScroll.primary = variant === 'timeline';
  let body: Component;
  if (variant === 'split' && terminal.columns >= 110) {
    const main = panes[0];
    const child = panes[childIndex];
    if (!main || !child) throw new Error('Split view requires main and child');
    body = new HStack(
      [
        {
          component: paneLayout(main),
          basis: Math.floor((terminal.columns - 3) / 2),
          shrink: 0,
        },
        {
          component: dynamic(() =>
            Array.from({length: terminal.rows}, () =>
              theme.fg('borderMuted', '│'),
            ),
          ),
          basis: 1,
        },
        {
          component: paneLayout(child),
          basis: Math.ceil((terminal.columns - 3) / 2),
          shrink: 0,
        },
      ],
      {gap: 1},
    );
  } else if (variant === 'timeline') {
    body = new VStack([
      {component: timelineScroll, basis: 0, grow: 1},
      ...(searching ? [searchRow] : []),
      current().editor,
      current().footer,
    ]);
  } else body = paneLayout(current());
  const top =
    variant === 'timeline'
      ? [dynamic(() => [theme.fg('muted', '所有代理 · 完整活动记录')])]
      : [];
  const narrow =
    variant === 'split' && terminal.columns < 110
      ? [
          dynamic(() => [
            theme.fg('muted', '当前为单栏 · 放宽至 110 列恢复并排'),
          ]),
        ]
      : [];
  tui.setLayoutRoot(
    new VStack([
      ...top,
      ...narrow,
      {component: body, basis: 0, grow: 1},
      fleet,
    ]),
  );
  tui.setFocus(
    searching ? searchInput : fleetFocused ? fleet : current().editor,
  );
  tui.requestRender(true);
}

function activate(index: number): void {
  currentTranscript().query = '';
  active = index;
  selected = index;
  if (index > 0) childIndex = index;
  fleetFocused = false;
  searching = false;
  mount();
  tui.renderNow();
}

tui.addInputListener(data => {
  if (isKeyRelease(data)) return {consume: true};
  if (matchesKey(data, 'alt+left')) {
    activate(0);
    return {consume: true};
  }
  if (matchesKey(data, 'ctrl+shift+f')) {
    searching = !searching;
    matchIndex = -1;
    searchInput.setValue('');
    currentTranscript().query = '';
    mount();
    return {consume: true};
  }
  if (searching) {
    if (matchesKey(data, 'shift+enter')) findNext(-1);
    else {
      searchInput.handleInput(data);
      if (searching && !matchesKey(data, 'enter')) {
        matchIndex = -1;
        findNext(1);
      }
    }
    return {consume: true};
  }
  if (matchesKey(data, 'f6') && variant === 'split') {
    activate(active === 0 ? childIndex : 0);
    return {consume: true};
  }
  if (fleetFocused) {
    if (matchesKey(data, 'down'))
      selected = Math.min(agents.length - 1, selected + 1);
    else if (matchesKey(data, 'up')) selected = Math.max(0, selected - 1);
    else if (matchesKey(data, 'enter')) activate(selected);
    else if (matchesKey(data, 'escape')) {
      fleetFocused = false;
      mount();
    } else if (data === 'x') {
      const agent = agents[selected];
      if (agent?.status === 'running') stop(agent);
    }
    tui.requestRender();
    return {consume: true};
  }
  if (
    !current().editor.getText() &&
    !current().editor.isShowingAutocomplete() &&
    matchesKey(data, 'down')
  ) {
    fleetFocused = true;
    selected = active;
    mount();
    return {consume: true};
  }
  return undefined;
});
const timer = setInterval(() => {
  advance(agents);
  sessions.syncUsage();
  tui.requestRender();
}, 200);
const onResize = () => mount();
const shutdown = () => {
  if (!exiting) {
    exiting = true;
    finish();
  }
};
process.on('SIGWINCH', onResize);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
try {
  mount();
  tui.start();
  await done;
} finally {
  clearInterval(timer);
  process.off('SIGWINCH', onResize);
  process.off('SIGTERM', shutdown);
  process.off('SIGINT', shutdown);
  for (const pane of panes) {
    pane.transcript.dispose();
    pane.footer.dispose();
  }
  timeline.dispose();
  sessions.dispose();
  tui.stop();
  write('\x1b[0m');
}
