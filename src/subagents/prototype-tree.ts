/**
 * Throwaway FleetView tree for the inline subagent UI prototype.
 *
 * The controller owns task state. This component renders snapshots and keeps
 * operation keys private so a late task update cannot retarget a composer.
 */

import type {Theme} from '@earendil-works/pi-coding-agent';
import {getSelectListTheme} from '@earendil-works/pi-coding-agent';
import {
  Editor,
  CURSOR_MARKER,
  getKeybindings,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type EditorTheme,
  type Focusable,
  type TUI,
} from '@earendil-works/pi-tui';
import {
  alignRight,
  appendTaskSummary,
  appendWrapped,
  oneLine,
  taskStats,
} from './prototype-task-view';
import type {
  Activity,
  FleetAgent,
  FleetController,
  FleetTask,
  TaskAction,
} from './prototype-model';

type Section =
  | 'task'
  | 'activity'
  | 'steering'
  | 'result'
  | 'steer'
  | 'reply'
  | 'followUp'
  | 'cancel';

type ActionSection = Extract<Section, TaskAction>;

type Node =
  | {readonly kind: 'agent'; readonly key: string; readonly agent: FleetAgent}
  | {
      readonly kind: 'task';
      readonly key: string;
      readonly agent: FleetAgent;
      readonly task: FleetTask;
      readonly depth: number;
    }
  | {
      readonly kind: 'section';
      readonly key: string;
      readonly agent: FleetAgent;
      readonly task: FleetTask;
      readonly section: Section;
      readonly depth: number;
    };

interface Operation {
  readonly kind: Exclude<ActionSection, 'cancel'>;
  readonly key: string;
  readonly agentName: string;
  readonly taskId: string;
  readonly questionId: string | undefined;
  readonly questionText: string | undefined;
}

interface Composer {
  readonly operation: Operation;
  readonly editor: Editor;
  readonly returnKey: string;
  draftBeforeInput: string;
}

const ACTION_ORDER: readonly ActionSection[] = [
  'reply',
  'steer',
  'followUp',
  'cancel',
];

function keyForAgent(name: string): string {
  return `agent:${name}`;
}

function taskKey(id: string): string {
  return `task:${id}`;
}

function sectionKey(
  id: string,
  section: Section,
  questionId: string | undefined = undefined,
): string {
  return questionId === undefined
    ? `section:${id}:${section}`
    : `section:${id}:${section}:${questionId}`;
}

function latestTask(agent: FleetAgent): FleetTask | undefined {
  return agent.tasks.at(-1);
}

function isTerminal(task: FleetTask): boolean {
  return ['completed', 'cancelled', 'failed', 'skipped'].includes(task.status);
}

/** Inline FleetView tree and task controls for the UI prototype. */
export class FleetTree implements Component, Focusable {
  focused = false;

  private readonly editorTheme: EditorTheme;
  private readonly expanded = new Set<string>();
  private readonly drafts = new Map<string, string>();
  private selectedAgentName: string;
  private selectedKey: string;
  private composer: Composer | undefined;
  private disposed = false;
  private selectedLine = 0;
  private scrollOffset = -1;
  private selectedAgentLine = 0;
  private composerStart = 0;
  private composerEnd = 0;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly controller: FleetController,
    private readonly back: () => void,
    private readonly reportError: (message: string) => void,
  ) {
    this.editorTheme = {
      borderColor: text => theme.fg('borderAccent', text),
      selectList: getSelectListTheme(),
    };
    const agents = this.fleetAgents();
    const preferred = agents.find(agent => agent.name !== 'main') ?? agents[0];
    this.selectedAgentName = preferred?.name ?? 'main';
    this.selectedKey = keyForAgent(this.selectedAgentName);
  }

  /** Focus the tree without replacing the host's default editor. */
  enter(): void {
    if (this.disposed) return;
    this.focused = true;
    // Entry always lands on the selected agent. Expansion stays as the user
    // left it and is opened explicitly with Enter or Right.
    this.selectedKey = keyForAgent(this.selectedAgentName);
    this.scrollOffset = -1;
    this.tui.setFocus(this);
    this.tui.requestRender();
  }

  dispose(): void {
    this.disposed = true;
    this.focused = false;
    if (this.composer) this.composer.editor.focused = false;
    this.composer = undefined;
  }

  handleInput(data: string): void {
    if (this.disposed || !this.focused) return;
    if (this.composer !== undefined) {
      this.handleComposerInput(data);
      return;
    }

    this.reconcileSelection(this.fleetAgents());
    const keybindings = getKeybindings();
    if (
      keybindings.matches(data, 'tui.select.cancel') ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl('c'))
    ) {
      this.focused = false;
      this.back();
    } else if (
      matchesKey(data, Key.ctrl('pageUp')) ||
      matchesKey(data, Key.leftbracket)
    ) {
      this.scroll(-1);
    } else if (
      matchesKey(data, Key.ctrl('pageDown')) ||
      matchesKey(data, Key.rightbracket)
    ) {
      this.scroll(1);
    } else if (
      keybindings.matches(data, 'tui.select.up') ||
      matchesKey(data, Key.up)
    ) {
      this.moveSelection(-1);
    } else if (
      keybindings.matches(data, 'tui.select.down') ||
      matchesKey(data, Key.down)
    ) {
      this.moveSelection(1);
    } else if (matchesKey(data, Key.shift('tab'))) {
      this.jumpAgent(-1);
    } else if (
      keybindings.matches(data, 'tui.input.tab') ||
      matchesKey(data, Key.tab)
    ) {
      this.jumpAgent(1);
    } else if (
      keybindings.matches(data, 'tui.select.confirm') ||
      matchesKey(data, Key.enter)
    ) {
      this.activateSelection();
    } else if (matchesKey(data, Key.left)) {
      this.collapseOrBack();
    } else if (matchesKey(data, Key.right)) {
      this.expandSelection();
    } else if (this.matchesLetter(data, 'r')) {
      this.invokeShortcut('reply');
    } else if (this.matchesLetter(data, 's')) {
      this.invokeShortcut('steer');
    } else if (this.matchesLetter(data, 'f')) {
      this.invokeShortcut('followUp');
    }
  }

  render(width: number): string[] {
    if (this.disposed) return [];
    if (this.composer) this.composer.editor.focused = this.focused;
    const agents = this.fleetAgents();
    this.reconcileSelection(agents);
    this.selectedLine = 0;
    this.selectedAgentLine = 0;
    this.composerStart = 0;
    this.composerEnd = 0;
    if (!this.focused)
      return this.boundCompact(this.renderCompact(agents, width));

    const lines: string[] = [this.theme.fg('dim', this.helpText(agents))];
    for (const node of this.navigationNodes(agents))
      this.renderNode(node, width, lines);
    if (agents.length === 1 && agents[0]?.name === 'main')
      lines.push(this.theme.fg('muted', 'No subagents have been assigned.'));
    return this.boundLines(lines, width).map(line =>
      truncateToWidth(line, width, ''),
    );
  }

  invalidate(): void {
    this.composer?.editor?.invalidate();
  }

  private renderCompact(
    agents: readonly FleetAgent[],
    width: number,
  ): string[] {
    const lines: string[] = [];
    for (const agent of agents) {
      const task = latestTask(agent);
      const icon = this.agentIcon(agent.name === this.selectedAgentName);
      let label = `${icon} ${agent.name}`;
      if (task !== undefined)
        label += `  ${oneLine(task.description || 'No task')}`;
      const right = task === undefined ? '' : taskStats(this.theme, task);
      lines.push(this.theme.fg('text', alignRight(label, right, width)));
    }
    if (lines.length > 0)
      lines.push(this.theme.fg('dim', '↑↓ at editor edge inspect agents'));
    return lines;
  }

  private boundCompact(lines: string[]): string[] {
    const limit = Math.max(4, this.tui.terminal.rows - 10);
    if (lines.length <= limit) return lines;
    return [
      ...lines.slice(0, limit - 1),
      this.theme.fg('dim', '↓ more agents'),
    ];
  }

  private renderNode(node: Node, width: number, lines: string[]): void {
    if (node.kind === 'agent') {
      if (node.key === this.selectedKey) this.selectedLine = lines.length;
      if (node.agent.name === this.selectedAgentName)
        this.selectedAgentLine = lines.length;
      const task = latestTask(node.agent);
      const expanded = this.expanded.has(node.key);
      const icon = this.agentIcon(node.agent.name === this.selectedAgentName);
      let left = `${icon} ${this.theme.fg('text', node.agent.name)}`;
      if (node.agent.name !== 'main' && task !== undefined)
        left += `  ${oneLine(task.description || 'No task')}`;
      if (expanded && node.agent.tasks.length > 0)
        left += ` ${this.theme.fg('muted', '▾')}`;
      else if (node.agent.tasks.length > 0)
        left += ` ${this.theme.fg('muted', '▸')}`;
      const right = task === undefined ? '' : taskStats(this.theme, task);
      lines.push(alignRight(left, right, width));
      return;
    }

    if (node.kind === 'task') {
      if (node.key === this.selectedKey) this.selectedLine = lines.length;
      const prefix = '  '.repeat(node.depth + 1);
      const selected = node.key === this.selectedKey;
      const pointer = selected ? this.theme.fg('accent', '›') : ' ';
      const expanded = this.expanded.has(node.key);
      const toggle = expanded ? '▾' : '▸';
      const age = latestTask(node.agent) === node.task ? 'Current' : 'Previous';
      const text = `${prefix}${pointer}${toggle} ${age} · ${oneLine(node.task.description || 'No task')}`;
      lines.push(alignRight(text, taskStats(this.theme, node.task), width));
      if (expanded)
        appendTaskSummary(
          lines,
          node.task,
          `${'  '.repeat(node.depth + 2)}│  `,
          width,
          this.theme,
        );
      return;
    }

    if (node.key === this.selectedKey) this.selectedLine = lines.length;
    const expanded = this.expanded.has(node.key);
    const prefix = `${'  '.repeat(node.depth + 1)}│ `;
    const glyph = expanded ? '▾' : '▸';
    const visibleGlyph =
      node.key === this.selectedKey ? this.theme.fg('accent', glyph) : glyph;
    const label = `${prefix}${visibleGlyph} ${this.sectionLabel(node)}`;
    lines.push(this.theme.fg('text', label));
    if (expanded) this.renderSection(node, prefix, width, lines);
  }

  private sectionLabel(
    node: Extract<Node, {readonly kind: 'section'}>,
  ): string {
    const {task, section} = node;
    switch (section) {
      case 'task':
        return `Prompt · ${oneLine(task.prompt || task.description)}`;
      case 'activity':
        return `Activity · ${task.activity.at(-1)?.title ?? 'No tool activity'}`;
      case 'steering':
        return `Steering · ${task.steering.length} update${task.steering.length === 1 ? '' : 's'}`;
      case 'result':
        return `Result · ${this.resultState(task)}`;
      case 'steer':
        return 'Steer current task';
      case 'reply':
        return 'Reply to question';
      case 'followUp':
        return 'Follow up';
      case 'cancel':
        return task.status === 'cancelling' ? 'Stopping task' : 'Cancel task';
    }
  }

  private resultState(task: FleetTask): string {
    if (task.result !== undefined) return 'delivered';
    if (
      task.status === 'failed' ||
      task.status === 'cancelled' ||
      task.status === 'skipped'
    )
      return 'unavailable';
    return 'pending';
  }

  private renderSection(
    node: Extract<Node, {readonly kind: 'section'}>,
    prefix: string,
    width: number,
    lines: string[],
  ): void {
    const {task, section} = node;
    const bodyPrefix = `${prefix}  `;
    if (section === 'task') {
      appendWrapped(
        lines,
        `Prompt · ${task.prompt || task.description}`,
        bodyPrefix,
        width,
        this.theme,
      );
    } else if (section === 'activity') {
      for (const activity of task.activity)
        this.renderActivity(activity, bodyPrefix, width, lines);
    } else if (section === 'steering') {
      for (const item of task.steering)
        appendWrapped(
          lines,
          `${item.state[0]?.toUpperCase() ?? ''}${item.state.slice(1)} · ${item.text}`,
          bodyPrefix,
          width,
          this.theme,
        );
    } else if (section === 'result') {
      appendWrapped(
        lines,
        task.result ??
          (isTerminal(task)
            ? 'No result is available for this task.'
            : 'No result has been delivered yet.'),
        bodyPrefix,
        width,
        this.theme,
      );
    } else if (
      section === 'steer' ||
      section === 'reply' ||
      section === 'followUp'
    ) {
      if (
        section === 'reply' &&
        this.composer?.operation?.key !== node.key &&
        task.question !== undefined
      )
        appendWrapped(
          lines,
          `Question · ${task.question.text}`,
          bodyPrefix,
          width,
          this.theme,
        );
      if (this.composer?.operation?.key === node.key) {
        this.renderComposer(node, bodyPrefix, width, lines);
      } else if (section === 'reply') {
        appendWrapped(
          lines,
          'Enter to write the answer.',
          bodyPrefix,
          width,
          this.theme,
        );
      } else if (section === 'steer') {
        appendWrapped(
          lines,
          'Enter to send guidance to the current task.',
          bodyPrefix,
          width,
          this.theme,
        );
      } else {
        appendWrapped(
          lines,
          'Enter to start another task with the previous report retained.',
          bodyPrefix,
          width,
          this.theme,
        );
      }
    } else {
      appendWrapped(
        lines,
        task.status === 'cancelling'
          ? 'Stopping active work. Completed results remain available.'
          : 'Cancel this task and its descendants. Completed results remain available.',
        bodyPrefix,
        width,
        this.theme,
      );
    }
  }

  private renderActivity(
    activity: Activity,
    prefix: string,
    width: number,
    lines: string[],
  ): void {
    appendWrapped(
      lines,
      `${activity.title} · ${activity.text}`,
      prefix,
      width,
      this.theme,
    );
  }

  private renderComposer(
    node: Extract<Node, {readonly kind: 'section'}>,
    prefix: string,
    width: number,
    lines: string[],
  ): void {
    const composer = this.composer;
    if (!composer || composer.operation.key !== node.key) return;
    this.composerStart = lines.length;
    const title =
      node.section === 'reply'
        ? 'Reply'
        : node.section === 'steer'
          ? 'Steer'
          : 'Follow up';
    appendWrapped(
      lines,
      `${title} · ${node.agent.name}`,
      prefix,
      width,
      this.theme,
    );
    if (composer.operation.questionText)
      appendWrapped(
        lines,
        `Question · ${composer.operation.questionText}`,
        prefix,
        width,
        this.theme,
      );
    for (const line of this.editorViewport(
      composer.editor.render(Math.max(1, width - visibleWidth(prefix))),
    ))
      lines.push(`${prefix}${line}`);
    lines.push(`${prefix}${this.theme.fg('dim', this.composerHint())}`);
    this.composerEnd = lines.length;
  }

  private composerHint(): string {
    const bindings = getKeybindings();
    const send = bindings.getKeys('tui.input.submit').join('/');
    const newline = bindings.getKeys('tui.input.newLine');
    return `${send} send · ${newline.includes('ctrl+j') ? 'ctrl+j' : newline.join('/')} newline · esc back`;
  }

  private editorViewport(lines: string[]): string[] {
    const limit = Math.max(3, this.tui.terminal.rows - 16);
    if (lines.length <= limit) return lines;
    const bodyRows = Math.max(1, limit - 2);
    const cursorIndex = lines.findIndex(line => line.includes(CURSOR_MARKER));
    const cursor = Math.max(
      1,
      cursorIndex < 0 ? lines.length - 1 : cursorIndex,
    );
    const start = Math.max(
      1,
      Math.min(cursor - bodyRows + 1, lines.length - bodyRows - 1),
    );
    return [
      lines[0] ?? '',
      ...lines.slice(start, start + bodyRows),
      lines.at(-1) ?? '',
    ];
  }

  private sections(task: FleetTask): readonly Section[] {
    const result: Section[] = [];
    for (const action of ACTION_ORDER)
      if (
        task.actions.includes(action) ||
        (this.composer?.operation?.taskId === task.id &&
          this.composer?.operation.kind === action)
      )
        result.push(action);
    result.push('task', 'activity', 'steering', 'result');
    return result;
  }

  private sectionNodeKey(task: FleetTask, section: Section): string {
    if (section === 'reply') {
      if (
        this.composer?.operation?.taskId === task.id &&
        this.composer?.operation.kind === section
      )
        return this.composer?.operation.key;
      return sectionKey(task.id, section, task.question?.id);
    }
    return sectionKey(task.id, section);
  }

  private navigationNodes(agents: readonly FleetAgent[]): Node[] {
    const nodes: Node[] = [];
    const visit = (node: Node): void => {
      nodes.push(node);
      if (this.expanded.has(node.key))
        for (const child of this.childrenOf(node)) visit(child);
    };
    for (const agent of agents)
      visit({kind: 'agent', key: keyForAgent(agent.name), agent});
    return nodes;
  }

  private moveSelection(direction: -1 | 1): void {
    const nodes = this.navigationNodes(this.fleetAgents());
    const current = Math.max(
      0,
      nodes.findIndex(node => node.key === this.selectedKey),
    );
    if (
      direction === -1 &&
      current === 0 &&
      nodes[0]?.kind === 'agent' &&
      nodes[0].agent.name === 'main'
    ) {
      this.focused = false;
      this.back();
      return;
    }
    const next =
      nodes[Math.min(nodes.length - 1, Math.max(0, current + direction))];
    if (next === undefined || next.key === this.selectedKey) return;
    this.selectNode(next);
    this.tui.requestRender();
  }

  private jumpAgent(direction: -1 | 1): void {
    const agents = this.navigationNodes(this.fleetAgents()).filter(
      (node): node is Extract<Node, {readonly kind: 'agent'}> =>
        node.kind === 'agent',
    );
    if (agents.length === 0) return;
    const current = Math.max(
      0,
      agents.findIndex(node => node.agent.name === this.selectedAgentName),
    );
    const next = agents[(current + direction + agents.length) % agents.length];
    if (next === undefined) return;
    this.selectNode(next);
    this.tui.requestRender();
  }

  private activateSelection(): void {
    const node = this.selectedNode();
    if (!node) return;
    if (node.kind === 'agent' && node.agent.name === 'main') {
      this.focused = false;
      this.back();
    } else if (node.kind === 'section' && node.section === 'cancel') {
      this.cancel(node.task, node.agent.name);
    } else if (
      node.kind === 'section' &&
      (node.section === 'reply' ||
        node.section === 'steer' ||
        node.section === 'followUp')
    ) {
      this.beginComposer(node);
    } else {
      if (!this.expanded.delete(node.key)) this.expanded.add(node.key);
      this.scrollOffset = -1;
      this.tui.requestRender();
    }
  }

  private expandSelection(): void {
    const node = this.selectedNode();
    if (!node) return;
    this.scrollOffset = -1;
    if (
      node.kind === 'section' &&
      node.section !== 'cancel' &&
      (node.section === 'reply' ||
        node.section === 'steer' ||
        node.section === 'followUp')
    ) {
      this.beginComposer(node);
    } else if (!this.expanded.has(node.key)) {
      this.expanded.add(node.key);
    } else {
      const child = this.childrenOf(node)[0];
      if (child) this.selectNode(child);
    }
    this.tui.requestRender();
  }

  private collapseOrBack(): void {
    const node = this.selectedNode();
    if (!node) return;
    if (!this.expanded.delete(node.key) && node.kind !== 'agent') {
      this.selectedKey =
        node.kind === 'task'
          ? keyForAgent(node.agent.name)
          : taskKey(node.task.id);
    }
    this.scrollOffset = -1;
    this.tui.requestRender();
  }

  private selectedNode(): Node | undefined {
    return this.navigationNodes(this.fleetAgents()).find(
      node => node.key === this.selectedKey,
    );
  }

  private childrenOf(node: Node): Node[] {
    if (node.kind === 'agent')
      return node.agent.tasks.toReversed().map(task => ({
        kind: 'task',
        key: taskKey(task.id),
        agent: node.agent,
        task,
        depth: 0,
      }));
    if (node.kind === 'task')
      return this.sections(node.task).map(section => ({
        kind: 'section',
        key: this.sectionNodeKey(node.task, section),
        agent: node.agent,
        task: node.task,
        section,
        depth: 1,
      }));
    return [];
  }

  private beginComposer(node: Extract<Node, {readonly kind: 'section'}>): void {
    if (
      node.section !== 'steer' &&
      node.section !== 'reply' &&
      node.section !== 'followUp'
    )
      return;
    const operation: Operation = {
      kind: node.section,
      key: node.key,
      agentName: node.agent.name,
      taskId: node.task.id,
      questionId: node.section === 'reply' ? node.task.question?.id : undefined,
      questionText:
        node.section === 'reply' ? node.task.question?.text : undefined,
    };
    const editor = new Editor(this.tui, this.editorTheme, {paddingX: 0});
    editor.setText(this.drafts.get(operation.key) ?? '');
    const composer: Composer = {
      operation,
      editor,
      returnKey: this.selectedKey,
      draftBeforeInput: '',
    };
    // Pi handles paste/newline/submit ordering. Preserve the exact draft because
    // native submit clears the editor before calling onSubmit.
    editor.onSubmit = text =>
      this.submit(operation, text, composer.draftBeforeInput);
    editor.onChange = () => this.tui.requestRender();
    this.composer = composer;
    this.expanded.add(keyForAgent(node.agent.name));
    this.expanded.add(taskKey(node.task.id));
    this.expanded.add(node.key);
    this.selectedKey = node.key;
    this.scrollOffset = -1;
    editor.focused = true;
    this.tui.setFocus(this);
    this.tui.requestRender();
  }

  private handleComposerInput(data: string): void {
    const composer = this.composer;
    if (!composer) return;
    if (matchesKey(data, Key.escape)) {
      this.closeComposer(true);
      return;
    }
    composer.draftBeforeInput = composer.editor.getExpandedText();
    if (matchesKey(data, Key.ctrl('enter'))) {
      this.submit(
        composer.operation,
        composer.draftBeforeInput.trim(),
        composer.draftBeforeInput,
      );
    } else {
      composer.editor.handleInput(data);
    }
    this.tui.requestRender();
  }

  private submit(operation: Operation, text: string, draft: string): void {
    if (text.length === 0) {
      this.rejectDraft(
        'Cannot send an empty subagent message. Draft retained.',
        draft,
      );
      return;
    }
    const currentTask = this.fleetAgents()
      .flatMap(agent => agent.tasks)
      .find(task => task.id === operation.taskId);
    if (
      currentTask === undefined ||
      !currentTask.actions.includes(operation.kind)
    ) {
      this.rejectDraft(
        `Could not send ${operation.kind}: the action is no longer available. Draft retained.`,
        draft,
      );
      return;
    }
    try {
      if (operation.kind === 'steer')
        this.controller.steer(operation.taskId, text);
      else if (operation.kind === 'reply') {
        if (operation.questionId === undefined) {
          this.rejectDraft(
            'Could not reply because the question is no longer available. Draft retained.',
            draft,
          );
          return;
        }
        this.controller.reply(operation.taskId, operation.questionId, text);
      } else this.controller.followUp(operation.agentName, text);
    } catch (caughtError) {
      const detail =
        caughtError instanceof Error
          ? caughtError.message
          : 'The controller rejected the operation';
      this.rejectDraft(
        `Could not send ${operation.kind}: ${detail.replace(/\.+$/, '')}. Draft retained.`,
        draft,
      );
      return;
    }
    this.drafts.delete(operation.key);
    this.closeComposer(false);
    if (operation.kind === 'followUp') {
      const agent = this.fleetAgents().find(
        item => item.name === operation.agentName,
      );
      const task = agent && latestTask(agent);
      if (task) {
        this.selectedKey = taskKey(task.id);
        this.expanded.add(this.selectedKey);
        this.scrollOffset = -1;
        this.tui.requestRender();
      }
    }
  }

  private rejectDraft(message: string, draft: string): void {
    const composer = this.composer;
    if (composer) {
      this.drafts.set(composer.operation.key, draft);
      if (composer.editor.getExpandedText() !== draft)
        composer.editor.setText(draft);
    }
    this.reportError(message);
    this.tui.requestRender();
  }

  private closeComposer(saveDraft: boolean): void {
    const composer = this.composer;
    if (!composer) return;
    if (saveDraft)
      this.drafts.set(
        composer.operation.key,
        composer.editor.getExpandedText(),
      );
    composer.editor.focused = false;
    this.composer = undefined;
    this.selectedKey = composer.returnKey;
    this.reconcileSelection(this.fleetAgents());
    this.scrollOffset = -1;
    this.tui.setFocus(this);
    this.tui.requestRender();
  }

  private cancel(task: FleetTask, agentName: string): void {
    try {
      this.controller.cancel(task.id);
    } catch (caughtError) {
      const detail =
        caughtError instanceof Error
          ? caughtError.message
          : 'The controller rejected the operation';
      this.reportError(`Could not cancel ${agentName}'s task: ${detail}.`);
      return;
    }
    this.tui.requestRender();
  }

  private invokeShortcut(kind: Exclude<ActionSection, 'cancel'>): void {
    const node = this.navigationNodes(this.fleetAgents()).find(
      candidate => candidate.key === this.selectedKey,
    );
    if (node === undefined || node.kind === 'section') return;
    const task = node.kind === 'agent' ? latestTask(node.agent) : node.task;
    if (task === undefined || !task.actions.includes(kind)) return;
    this.beginComposer({
      kind: 'section',
      key: this.sectionNodeKey(task, kind),
      agent: node.agent,
      task,
      section: kind,
      depth: 1,
    });
  }

  private matchesLetter(data: string, letter: 'r' | 's' | 'f'): boolean {
    return matchesKey(data, letter) || matchesKey(data, Key.shift(letter));
  }

  private selectNode(node: Node): void {
    this.selectedKey = node.key;
    this.selectedAgentName = node.agent.name;
    this.scrollOffset = -1;
  }

  private reconcileSelection(agents: readonly FleetAgent[]): void {
    const nodes = this.navigationNodes(agents);
    if (nodes.some(node => node.key === this.selectedKey)) return;

    for (const agent of agents) {
      const task = agent.tasks.find(
        candidate =>
          this.selectedKey === taskKey(candidate.id) ||
          this.selectedKey.startsWith(`section:${candidate.id}:`),
      );
      if (task !== undefined) {
        this.selectedAgentName = agent.name;
        const taskNode = nodes.find(
          node => node.kind === 'task' && node.task.id === task.id,
        );
        this.selectedKey = taskNode?.key ?? keyForAgent(agent.name);
        return;
      }
    }

    const agent =
      agents.find(candidate => candidate.name === this.selectedAgentName) ??
      agents[0];
    this.selectedAgentName = agent?.name ?? 'main';
    this.selectedKey = keyForAgent(this.selectedAgentName);
  }

  private helpText(agents: readonly FleetAgent[]): string {
    if (this.composer) return this.composerHint();
    const selected = this.navigationNodes(agents).find(
      node => node.key === this.selectedKey,
    );
    const task =
      selected?.kind === 'agent' ? latestTask(selected.agent) : selected?.task;
    const hints: string[] = [];
    if (selected?.kind !== 'section') {
      if (task?.actions.includes('reply')) hints.push('r reply');
      if (task?.actions.includes('steer')) hints.push('s steer');
      if (task?.actions.includes('followUp')) hints.push('f follow up');
    }
    hints.push('↑↓ select', 'tab agents', '←→/enter open', 'esc main');
    return hints.join(' · ');
  }

  private agentIcon(selected: boolean): string {
    return selected
      ? this.theme.fg('accent', '●')
      : this.theme.fg('muted', '○');
  }

  private fleetAgents(): FleetAgent[] {
    const agents = this.controller.agents();
    const main = agents.find(agent => agent.name === 'main');
    const children = agents.filter(agent => agent.name !== 'main');
    return main === undefined
      ? [{name: 'main', tasks: []}, ...children]
      : [main, ...children];
  }

  private boundLines(lines: string[], width: number): string[] {
    const limit = Math.max(7, this.tui.terminal.rows - 10);
    if (lines.length <= limit) return lines;
    if (this.composer !== undefined) {
      const fixed: string[] = [];
      const add = (index: number): void => {
        const line = lines[index];
        if (line !== undefined && !fixed.includes(line)) fixed.push(line);
      };
      add(0);
      add(this.selectedAgentLine);
      add(this.selectedLine);
      const composer = lines.slice(this.composerStart, this.composerEnd);
      const available = Math.max(1, limit - fixed.length);
      const tail = composer.slice(Math.max(0, composer.length - available));
      return [...fixed, ...tail].slice(0, limit);
    }
    const bodyRows = Math.max(3, limit - 3);
    const maxStart = Math.max(1, lines.length - bodyRows);
    const suggested = Math.max(1, this.selectedLine - Math.floor(bodyRows / 2));
    const start = Math.min(
      maxStart,
      this.scrollOffset < 0 ? suggested : this.scrollOffset,
    );
    const end = Math.min(lines.length, start + bodyRows);
    this.scrollOffset = start;
    const result = [lines[0] ?? ''];
    if (start > 1)
      result.push(this.theme.fg('dim', '↑ more above · [ scroll up'));
    result.push(...lines.slice(start, end));
    if (end < lines.length)
      result.push(this.theme.fg('dim', '↓ more below · ] scroll down'));
    return result.slice(0, limit).map(line => truncateToWidth(line, width, ''));
  }

  private scroll(direction: -1 | 1): void {
    const step = Math.max(3, Math.floor((this.tui.terminal.rows - 10) / 2));
    const current = this.scrollOffset < 0 ? 1 : this.scrollOffset;
    this.scrollOffset = Math.max(1, current + direction * step);
    this.tui.requestRender();
  }
}
