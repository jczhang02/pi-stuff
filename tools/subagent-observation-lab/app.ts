// Source-informed, offline TUI exploration; this host is not Pi InteractiveMode.
import {
  Input,
  ProcessTerminal,
  TuiAltScreen,
  VStack,
  Text,
  matchesKey,
  isKeyRelease,
  setKeybindings,
  type Component,
} from '@earendil-works/pi-tui';
import {Schema} from 'effect';
import {KeybindingsManager} from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js';
import {
  initTheme,
  theme,
} from '../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';
import {
  createScenario,
  advance,
  stop,
} from '../subagent-observation-prototype/scenario';
import {createSessions} from '../subagent-observation-prototype/sessions';
import {Transcript} from '../subagent-observation-prototype/transcript';
import {canvas, fleetRows} from '../subagent-observation-prototype/chrome';
import {createComposer} from './composer';
import {createInspector} from './inspector';
import {createMonitor} from './monitor';
import {createInbox} from './inbox';
import {createTrace} from './trace';
import {createStacks} from './stacks';
import {
  ViewScroll,
  rows,
  type LabContext,
  type ObservationMessage,
} from './shared';

const variant = Schema.decodeUnknownSync(
  Schema.Literals(['inspector', 'monitor', 'inbox', 'trace', 'stacks']),
)(process.env.PI_OBSERVATION_VARIANT);
initTheme(process.env.PI_OBSERVATION_THEME ?? 'light', false);
const keys = new KeybindingsManager({'tui.altScreen.search': []});
setKeybindings(keys);
const terminal = new ProcessTerminal();
const rawWrite = terminal.write.bind(terminal);
terminal.write = data => rawWrite(canvas(data, theme));
const tui = new TuiAltScreen(terminal, true, undefined, {mouse: true});
const agents = createScenario();
const sessions = await createSessions(
  agents,
  process.cwd(),
  process.env.PI_CODING_AGENT_DIR ?? process.cwd(),
);
const scrolls: ViewScroll[] = [];
const singles = new Map<ObservationMessage, Transcript>();
let selected = 0;
let conversation = false;
let editing = false;
let searching = false;
let tick = 0;
let matchIndex = -1;
let finish: () => void = () => {};
const done = new Promise<void>(resolve => {
  finish = resolve;
});
function scroll(body: Component, follow: 'none' | 'end' = 'none'): ViewScroll {
  const result = new ViewScroll(body, {
    follow,
    overscroll: 'contain',
    scrollbar: 'auto',
    scrollbarTrackStyle: text => theme.fg('scrollbarTrack', text),
    scrollbarThumbStyle: text => theme.fg('scrollbarThumb', text),
  });
  scrolls.push(result);
  return result;
}
const panes = agents.map((agent, index) => {
  const session = sessions.sessions.get(agent.id);
  if (!session) throw new Error(`Missing session: ${agent.id}`);
  const transcript = new Transcript([agent], tui, theme);
  const composer = createComposer(agent, session, tui, keys, theme, {
    focus() {
      selected = index;
      editing = true;
      mount();
    },
    refresh() {
      tui.requestRender();
    },
    sent() {
      openConversation(index);
      panes[index]?.scroll.scrollToEnd();
    },
    exit: () => finish(),
    back,
  });
  const viewport = scroll(
    new VStack([
      transcript,
      rows(width =>
        composer.notices.flatMap(text =>
          new Text(theme.fg('warning', text), 1, 1).render(width),
        ),
      ),
    ]),
    'end',
  );
  return {...composer, transcript, scroll: viewport};
});
function current() {
  const pane = panes[selected];
  if (!pane) throw new Error('Missing selected conversation');
  return pane;
}
function activateScroll(target: ViewScroll) {
  for (const item of scrolls) item.primary = item === target;
}
function openConversation(index: number) {
  selected = index;
  conversation = true;
  editing = true;
  searching = false;
  mount();
  tui.renderNow();
}
function back() {
  current().transcript.query = '';
  searching = false;
  conversation = false;
  editing = false;
  mount();
  tui.renderNow();
}
const ctx: LabContext = {
  agents,
  theme,
  selected: () => selected,
  select(index) {
    if (agents[index]) selected = index;
  },
  refresh() {
    mount();
    tui.renderNow();
  },
  focusEditor() {
    editing = true;
    mount();
  },
  openConversation,
  conversation(index) {
    const pane = panes[index];
    if (!pane) throw new Error('Missing agent viewport');
    return pane.scroll;
  },
  message(index, message) {
    let transcript = singles.get(message);
    if (!transcript) {
      const agent = agents[index];
      if (!agent) throw new Error('Missing message owner');
      transcript = new Transcript(
        [{...agent, expanded: true, messages: [message]}],
        tui,
        theme,
      );
      singles.set(message, transcript);
    }
    return transcript;
  },
  scroll,
  activateScroll,
  rows: () => terminal.rows,
  clock: () => tick / 5,
};
const factories = {
  inspector: createInspector,
  monitor: createMonitor,
  inbox: createInbox,
  trace: createTrace,
  stacks: createStacks,
};
const view = factories[variant](ctx);
const nav = rows(() => []);
const search = new Input({prompt: '搜索 '});
function findNext(direction: number) {
  current().transcript.query = search.getValue();
  const matches = current().transcript.matches(search.getValue());
  matchIndex = matches.length
    ? (matchIndex + direction + matches.length) % matches.length
    : -1;
  const row = matches[matchIndex];
  if (row !== undefined) current().scroll.scrollTo(row, {disableFollow: true});
  tui.requestRender();
}
search.onSubmit = () => findNext(1);
search.onEscape = () => {
  searching = false;
  current().transcript.query = '';
  mount();
};
const fleet = rows(
  width => fleetRows(agents, width, theme, selected, false),
  row => {
    if (agents[row]) openConversation(row);
  },
);

function mount() {
  if (terminal.columns < 60 || terminal.rows < 24) {
    tui.setLayoutRoot(
      new Text('至少需要 60 列 × 24 行。放大终端继续；Ctrl+D 退出。', 0, 0),
    );
    tui.setFocus(nav);
    tui.requestRender(true);
    return;
  }
  for (const item of scrolls) item.primary = false;
  const body = conversation
    ? current().scroll
    : view.layout(terminal.columns, terminal.rows - 11);
  if (conversation) activateScroll(current().scroll);
  tui.setLayoutRoot(
    new VStack([
      ...(conversation
        ? [
            rows(() => [
              theme.fg('accent', `${agents[selected]?.name}  /  完整对话`),
            ]),
          ]
        : []),
      {component: body, basis: 0, grow: 1},
      ...(searching
        ? [
            search,
            rows(() => [
              theme.fg(
                'muted',
                `${Math.max(0, matchIndex + 1)}/${current().transcript.matches(search.getValue()).length} · Enter 下一个 · Esc 关闭`,
              ),
            ]),
          ]
        : []),
      rows(() => [
        theme.fg(
          'muted',
          editing || conversation
            ? 'Alt+Left 返回观察 · Ctrl+Shift+F 搜索 · Ctrl+O 工具详情 · Esc 停止'
            : view.hint(),
        ),
      ]),
      current().editor,
      current().footer,
      fleet,
    ]),
  );
  tui.setFocus(searching ? search : editing ? current().editor : nav);
  tui.requestRender(true);
}
tui.addInputListener(data => {
  if (isKeyRelease(data)) return {consume: true};
  if (matchesKey(data, 'alt+left')) {
    back();
    return {consume: true};
  }
  if (
    matchesKey(data, 'ctrl+d') &&
    (!current().editor.getText() || terminal.columns < 60 || terminal.rows < 24)
  ) {
    finish();
    return {consume: true};
  }
  if (matchesKey(data, 'ctrl+shift+f')) {
    if (!conversation) openConversation(selected);
    searching = !searching;
    matchIndex = -1;
    search.setValue('');
    current().transcript.query = '';
    mount();
    return {consume: true};
  }
  if (searching) {
    if (matchesKey(data, 'shift+enter')) findNext(-1);
    else {
      search.handleInput(data);
      if (searching && !matchesKey(data, 'enter')) {
        matchIndex = -1;
        findNext(1);
      }
    }
    return {consume: true};
  }
  if (!editing) {
    if (data === 'i') {
      ctx.focusEditor();
      return {consume: true};
    }
    if (data === 'x') {
      const agent = agents[selected];
      if (agent?.status === 'running' || agent?.status === 'waiting')
        stop(agent);
      mount();
      return {consume: true};
    }
    if (view.input(data)) return {consume: true};
  }
  return undefined;
});
const timer = setInterval(() => {
  tick += 1;
  advance(agents);
  view.tick?.();
  sessions.syncUsage();
  tui.requestRender();
}, 200);
const resize = () => mount();
const shutdown = () => finish();
process.on('SIGWINCH', resize);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
try {
  mount();
  tui.start();
  await done;
} finally {
  clearInterval(timer);
  process.off('SIGWINCH', resize);
  process.off('SIGTERM', shutdown);
  process.off('SIGINT', shutdown);
  for (const pane of panes) {
    pane.transcript.dispose();
    pane.footer.dispose();
  }
  for (const transcript of singles.values()) transcript.dispose();
  sessions.dispose();
  tui.stop();
  rawWrite('\x1b[0m');
}
