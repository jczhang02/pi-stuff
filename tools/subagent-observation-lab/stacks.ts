// Throwaway Zellij-inspired evidence workbench. Every surface is fixture-backed.
import {VStack, matchesKey, type Component} from '@earendil-works/pi-tui';
import {
  fit,
  panel,
  rows,
  status,
  type LabContext,
  type LabView,
  type ObservationMessage,
  type ViewScroll,
} from './shared';

type SurfaceKey = 'activity' | 'tests' | 'decisions' | 'sources';

interface SurfaceEntry {
  agent: number;
  message: ObservationMessage;
  title: string;
  detail: string;
}

interface CurrentSelection {
  entries: SurfaceEntry[];
  index: number;
  entry: SurfaceEntry | undefined;
}

const surfaceKeys: SurfaceKey[] = ['activity', 'tests', 'decisions', 'sources'];
const surfaceTitles: Record<SurfaceKey, string> = {
  activity: 'Activity',
  tests: 'Tests',
  decisions: 'Decisions',
  sources: 'Sources',
};
const surfaceUnits: Record<SurfaceKey, string> = {
  activity: 'events',
  tests: 'runs',
  decisions: 'waiting',
  sources: 'reads',
};
const textSurfaces = new Set<SurfaceKey>(['activity', 'decisions']);
const heightLabels = ['紧凑', '标准', '扩展'];

function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function messageDetail(message: ObservationMessage): string {
  if (message.kind === 'tool') {
    const detail = oneLine(message.detail.split('\n')[0] ?? '');
    if (detail) return detail;
    return message.name === 'read'
      ? `read ${message.args.path}`
      : `bash ${message.args.command}`;
  }
  return oneLine(message.text) || '回复生成中';
}

function messageTitle(message: ObservationMessage): string {
  if (message.kind === 'tool') {
    return message.name === 'read'
      ? `read · ${message.args.path}`
      : `bash · ${message.args.command}`;
  }
  return message.kind === 'user' ? '用户请求' : '回复';
}

function activityKind(message: ObservationMessage): string {
  if (message.kind === 'tool') return message.name;
  return message.kind === 'user' ? 'user' : 'assistant';
}

export function createStacks(ctx: LabContext): LabView {
  let surfaceIndex = 1; // Tests is the useful first screenshot.
  let collapsed = false;
  let heightMode = 1;
  let layoutHeight = Math.max(13, ctx.rows() - 11);
  const itemCursor: Record<SurfaceKey, number> = {
    activity: 0,
    tests: 0,
    decisions: 0,
    sources: 0,
  };
  const chosen: Record<SurfaceKey, ObservationMessage | undefined> = {
    activity: undefined,
    tests: undefined,
    decisions: undefined,
    sources: undefined,
  };

  const surfacePanels = surfaceKeys.map(() => new VStack());
  const bodyStacks = surfaceKeys.map(() => new VStack());
  const bodyScrolls: Array<ViewScroll | undefined> = surfaceKeys.map(
    (key, index) => {
      const body = bodyStacks[index];
      if (!body) throw new Error(`Missing body stack at ${index}`);
      return textSurfaces.has(key) ? ctx.scroll(body, 'end') : undefined;
    },
  );
  const messageViews = new Map<ObservationMessage, ViewScroll>();
  const stack = new VStack();
  const viewport = ctx.scroll(stack, 'none');

  function entriesFor(key: SurfaceKey): SurfaceEntry[] {
    const entries: SurfaceEntry[] = [];
    if (key === 'decisions') {
      for (const [agentIndex, agent] of ctx.agents.entries()) {
        if (agent.status !== 'waiting') continue;
        const message = agent.messages.findLast(
          item => item.kind === 'assistant' || item.kind === 'user',
        );
        if (!message) continue;
        entries.push({
          agent: agentIndex,
          message,
          title: `等待回复 · ${agent.activity}`,
          detail: messageDetail(message),
        });
      }
      return entries;
    }

    for (const [agentIndex, agent] of ctx.agents.entries()) {
      for (const message of agent.messages) {
        const include =
          key === 'activity' ||
          (key === 'tests' &&
            message.kind === 'tool' &&
            message.name === 'bash') ||
          (key === 'sources' &&
            message.kind === 'tool' &&
            message.name === 'read');
        if (!include) continue;
        entries.push({
          agent: agentIndex,
          message,
          title:
            key === 'activity'
              ? `${activityKind(message)} · ${messageTitle(message)}`
              : messageTitle(message),
          detail: messageDetail(message),
        });
      }
    }
    entries.sort((left, right) => left.message.seq - right.message.seq);
    return entries;
  }

  function currentEntry(key: SurfaceKey): CurrentSelection {
    const entries = entriesFor(key);
    const selected = chosen[key];
    const selectedIndex = selected
      ? entries.findIndex(item => item.message === selected)
      : -1;
    const requested = selectedIndex >= 0 ? selectedIndex : itemCursor[key];
    const index = entries.length
      ? Math.min(Math.max(0, requested), entries.length - 1)
      : 0;
    itemCursor[key] = index;
    chosen[key] = entries[index]?.message;
    return {entries, index, entry: entries[index]};
  }

  // Seed the workbench so Tests opens on the reviewer's release output.
  for (const key of surfaceKeys) {
    const entries = entriesFor(key);
    itemCursor[key] = Math.max(0, entries.length - 1);
  }
  const reviewer = ctx.agents.findIndex(agent => agent.id === 'reviewer');
  const tests = entriesFor('tests');
  const reviewerTest = tests.findIndex(item => item.agent === reviewer);
  if (reviewerTest >= 0) {
    itemCursor.tests = reviewerTest;
    chosen.tests = tests[reviewerTest]?.message;
  }

  function selectedFor(key: SurfaceKey): SurfaceEntry | undefined {
    return currentEntry(key).entry;
  }

  function selectEntry(): void {
    const entry = selectedFor(surfaceKeys[surfaceIndex] ?? 'tests');
    if (entry) ctx.select(entry.agent);
  }

  function nativeView(entry: SurfaceEntry): ViewScroll {
    const existing = messageViews.get(entry.message);
    if (existing) return existing;
    const view = ctx.scroll(ctx.message(entry.agent, entry.message), 'end');
    messageViews.set(entry.message, view);
    return view;
  }

  function moveItem(delta: number): void {
    const key = surfaceKeys[surfaceIndex] ?? 'tests';
    const current = currentEntry(key);
    if (!current.entries.length) return;
    const next =
      (current.index + delta + current.entries.length) % current.entries.length;
    itemCursor[key] = next;
    chosen[key] = current.entries[next]?.message;
    selectEntry();
    syncAll();
    rebuild(layoutHeight);
    activate();
    ctx.refresh();
    revealSelection();
    ctx.refresh();
  }

  function selector(index: number): Component {
    const key = surfaceKeys[index] ?? 'tests';
    return rows(
      width => {
        const current = currentEntry(key);
        const entry = current.entry;
        if (!entry) return [fit('  无可选证据', width)];
        const agent = ctx.agents[entry.agent];
        if (!agent) return [fit('  缺少条目 owner', width)];
        const left = ctx.theme.fg('muted', '\uf104 ');
        const right = ctx.theme.fg('muted', '\uf105 ');
        const line = `${left}${current.index + 1}/${current.entries.length} · ${status(agent, ctx.theme)}${agent.name} · ${entry.title} ${right}`;
        return [fit(line, width)];
      },
      () => moveItem(1),
    );
  }

  const selectors = surfaceKeys.map((_, index) => selector(index));

  function syncSurface(index: number): void {
    const key = surfaceKeys[index];
    const panelBody = surfacePanels[index];
    const selectorRow = selectors[index];
    if (!key || !panelBody || !selectorRow) return;
    panelBody.clear();
    panelBody.addChild(selectorRow, {basis: 1, shrink: 0});

    if (textSurfaces.has(key)) {
      const body = bodyStacks[index];
      const scroll = bodyScrolls[index];
      if (!body || !scroll) return;
      const current = currentEntry(key);
      body.clear();
      if (!current.entries.length) {
        body.addChild(rows(width => [fit('  暂无待处理证据', width)]));
      } else {
        for (const entry of current.entries) {
          body.addChild(
            rows(width => {
              const agent = ctx.agents[entry.agent];
              if (!agent) return [fit('  缺少 owner', width)];
              const marker =
                entry.message === current.entry?.message
                  ? ctx.theme.fg('accent', '\uf105 ')
                  : '  ';
              return [
                fit(
                  `${marker}${status(agent, ctx.theme)}${agent.name} · ${entry.title} · ${entry.detail}`,
                  width,
                ),
              ];
            }),
            {basis: 1, shrink: 0},
          );
        }
      }
      panelBody.addChild(scroll, {basis: 0, grow: 1});
      return;
    }

    const entry = currentEntry(key).entry;
    if (entry) {
      panelBody.addChild(nativeView(entry), {basis: 0, grow: 1});
    } else {
      panelBody.addChild(
        rows(width => [fit('  暂无调用记录', width)]),
        {basis: 0, grow: 1},
      );
    }
  }

  function syncAll(): void {
    for (const [index, key] of surfaceKeys.entries()) {
      if (!textSurfaces.has(key)) {
        for (const entry of entriesFor(key)) nativeView(entry);
      }
      syncSurface(index);
    }
  }

  function paneHeight(height: number): number {
    const ratio = [0.34, 0.5, 0.68][heightMode] ?? 0.5;
    return Math.max(
      5,
      Math.min(Math.max(5, height - 5), Math.floor(height * ratio)),
    );
  }

  const headers = surfaceKeys.map((key, index) =>
    rows(
      width => {
        const count = entriesFor(key).length;
        const active = surfaceIndex === index;
        const open = active && !collapsed;
        const pointer = active ? ctx.theme.fg('accent', '\uf105 ') : '  ';
        const fold = ctx.theme.fg(
          open ? 'accent' : 'muted',
          open ? '\uf107 ' : '\uf105 ',
        );
        return [
          fit(
            `${pointer}${fold}${surfaceTitles[key]} · ${count} ${surfaceUnits[key]} · ${open ? '展开' : '收起'}`,
            width,
          ),
        ];
      },
      () => focusSurface(index),
    ),
  );

  function rebuild(height: number): void {
    stack.clear();
    for (const [index, header] of headers.entries()) {
      stack.addChild(header, {basis: 1, shrink: 0});
      if (index === surfaceIndex && !collapsed) {
        const body = surfacePanels[index];
        if (body) stack.addChild(body, {basis: paneHeight(height), shrink: 0});
      }
    }
  }

  function activate(): void {
    if (collapsed) {
      ctx.activateScroll(viewport);
      return;
    }
    const key = surfaceKeys[surfaceIndex] ?? 'tests';
    if (!textSurfaces.has(key)) {
      const entry = selectedFor(key);
      if (entry) {
        ctx.activateScroll(nativeView(entry));
        return;
      }
    }
    const body = bodyScrolls[surfaceIndex];
    ctx.activateScroll(body ?? viewport);
  }

  function revealSelection(): void {
    const key = surfaceKeys[surfaceIndex] ?? 'tests';
    if (!textSurfaces.has(key)) return;
    const current = currentEntry(key);
    const body = bodyScrolls[surfaceIndex];
    if (body) body.scrollTo(current.index, {disableFollow: true});
  }

  function focusSurface(index: number): void {
    if (!surfaceKeys[index]) return;
    surfaceIndex = index;
    collapsed = false;
    selectEntry();
    syncAll();
    rebuild(layoutHeight);
    viewport.scrollTo(Math.max(0, index - 2), {disableFollow: true});
    activate();
    ctx.refresh();
    revealSelection();
    ctx.refresh();
  }

  function moveSurface(delta: number): void {
    const next =
      (surfaceIndex + delta + surfaceKeys.length) % surfaceKeys.length;
    focusSurface(next);
  }

  syncAll();
  rebuild(layoutHeight);
  selectEntry();
  const frame = panel(
    () => {
      const key = surfaceKeys[surfaceIndex] ?? 'tests';
      return `证据工作区 · ${surfaceTitles[key]} · ${heightLabels[heightMode] ?? '标准'}`;
    },
    viewport,
    ctx,
  );
  const root = new VStack([{component: frame, basis: 0, grow: 1}]);

  return {
    layout(_width, height) {
      layoutHeight = height;
      syncAll();
      rebuild(height);
      activate();
      return root;
    },
    input(data) {
      if (matchesKey(data, 'down') || data === 'j') moveSurface(1);
      else if (matchesKey(data, 'up') || data === 'k') moveSurface(-1);
      else if (matchesKey(data, 'left') || matchesKey(data, 'shift+tab'))
        moveItem(-1);
      else if (matchesKey(data, 'right') || matchesKey(data, 'tab'))
        moveItem(1);
      else if (matchesKey(data, 'space')) {
        collapsed = !collapsed;
        rebuild(layoutHeight);
        activate();
        ctx.refresh();
      } else if (data === 'z') {
        heightMode = (heightMode + 1) % heightLabels.length;
        rebuild(layoutHeight);
        activate();
        ctx.refresh();
      } else if (matchesKey(data, 'enter')) {
        const entry = selectedFor(surfaceKeys[surfaceIndex] ?? 'tests');
        ctx.openConversation(entry?.agent ?? ctx.selected());
      } else if (data === 'i') ctx.focusEditor();
      else return false;
      return true;
    },
    hint: () =>
      '↑↓/jk surface · ←→/Tab 条目 · Space 折叠 · z 高度 · Enter 对话 · i 回复',
    tick() {
      // Scenario messages can grow while a conversation is open. Rebuild only
      // evidence content; keep the user's current editor owner untouched.
      syncAll();
    },
  };
}
