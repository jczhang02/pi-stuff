/**
 * Throwaway FleetView tree for the inline subagent UI prototype.
 *
 * The controller owns task state. This component renders snapshots and routes
 * operations to the immutable task id captured when a composer opens.
 */

import type {Theme} from '@earendil-works/pi-coding-agent';
import {getSelectListTheme} from '@earendil-works/pi-coding-agent';
import {
  Editor,
  CURSOR_MARKER,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type EditorTheme,
  type Focusable,
  type TUI,
} from '@earendil-works/pi-tui';
import type {
  Activity,
  FleetAgent,
  FleetController,
  FleetTask,
  TaskStatus,
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
  readonly kind: 'steer' | 'reply' | 'followUp';
  readonly key: string;
  readonly agentName: string;
  readonly taskId: string;
  readonly questionId: string | undefined;
}

const ACTIVE: readonly TaskStatus[] = [
  'queued',
  'running',
  'waiting',
  'cancelling',
];

function keyForAgent(name: string): string {
  return `agent:${name}`;
}

function taskKey(id: string): string {
  return `task:${id}`;
}

function sectionKey(id: string, section: Section): string {
  return `section:${id}:${section}`;
}

function oneLine(text: string): string {
  return text
    .replace(/[\r\n\t]/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

function latestTask(agent: FleetAgent): FleetTask | undefined {
  return agent.tasks[agent.tasks.length - 1];
}

function isActive(task: FleetTask): boolean {
  return ACTIVE.includes(task.status);
}

function formatTokens(value: number): string {
  if (value < 1000) return `${value}`;
  if (value < 10000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1000000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1000000).toFixed(1)}M`;
}

function formatElapsed(value: number): string {
  if (value < 60) return `${Math.max(0, Math.round(value))}s`;
  return `${Math.floor(value / 60)}m ${Math.max(0, Math.round(value % 60))}s`;
}

function statusText(theme: Theme, task: FleetTask): string {
  let label = '';
  let color: 'error' | 'warning' | 'muted' | 'success' | undefined;
  switch (task.status) {
    case 'queued':
      label = 'Queued';
      color = 'warning';
      break;
    case 'waiting':
      label = 'Waiting';
      color = 'warning';
      break;
    case 'cancelling':
      label = 'Cancelling';
      color = 'warning';
      break;
    case 'cancelled':
      label = 'Cancelled';
      color = 'muted';
      break;
    case 'failed':
      label = 'Failed';
      color = 'error';
      break;
    case 'skipped':
      label = 'Skipped';
      color = 'muted';
      break;
    case 'running':
    case 'completed':
      break;
  }
  return color === undefined ? '' : theme.fg(color, label);
}

function alignRight(left: string, right: string, width: number): string {
  if (right.length === 0 || width < 60)
    return truncateToWidth(left, width, '...');
  const rightWidth = visibleWidth(right);
  if (rightWidth >= width) return truncateToWidth(right, width, '...');
  const clipped = truncateToWidth(
    left,
    Math.max(1, width - rightWidth - 1),
    '...',
  );
  return `${clipped}${' '.repeat(Math.max(1, width - visibleWidth(clipped) - rightWidth))}${right}`;
}

function rowBackground(
  text: string,
  width: number,
  theme: Theme,
  selected: boolean,
): string {
  const clipped = truncateToWidth(text, width, '...');
  const padded = `${clipped}${' '.repeat(Math.max(0, width - visibleWidth(clipped)))}`;
  return selected ? theme.bg('selectedBg', padded) : padded;
}

function appendWrapped(
  lines: string[],
  text: string,
  prefix: string,
  width: number,
  theme: Theme,
): void {
  const available = Math.max(8, width - visibleWidth(prefix));
  for (const paragraph of text.replaceAll('\r', '').split('\n')) {
    for (const line of wrapTextWithAnsi(
      paragraph.replaceAll('\t', '  '),
      available,
    ))
      lines.push(theme.fg('text', `${prefix}${line}`));
  }
}

/** Inline FleetView tree and task controls for the UI prototype. */
export class FleetTree implements Component, Focusable {
  focused = false;

  private readonly editorTheme: EditorTheme;
  private readonly expandedAgents = new Set<string>();
  private readonly expandedTasks = new Set<string>();
  private readonly expandedSections = new Set<string>();
  private readonly drafts = new Map<string, string>();
  private selectedAgentName: string;
  private selectedKey: string;
  private previousSelectionKey: string | undefined;
  private operation: Operation | undefined;
  private editor: Editor | undefined;
  private composerActive = false;
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
    this.scrollOffset = -1;
    this.expandSelectedAgent();
    this.tui.setFocus(this);
    this.tui.requestRender();
  }

  dispose(): void {
    this.disposed = true;
    this.focused = false;
    if (this.editor !== undefined) this.editor.focused = false;
    this.editor?.invalidate();
    this.editor = undefined;
    this.operation = undefined;
    this.composerActive = false;
  }

  handleInput(data: string): void {
    if (this.disposed || !this.focused) return;
    if (this.composerActive) {
      this.handleComposerInput(data);
      return;
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.focused = false;
      this.back();
    } else if (matchesKey(data, Key.pageUp)) {
      this.scroll(-1);
    } else if (matchesKey(data, Key.pageDown)) {
      this.scroll(1);
    } else if (matchesKey(data, Key.up)) {
      this.moveSelection(-1);
    } else if (matchesKey(data, Key.down)) {
      this.moveSelection(1);
    } else if (matchesKey(data, Key.left)) {
      this.collapseOrBack();
    } else if (matchesKey(data, Key.right)) {
      this.expandSelection();
    } else if (matchesKey(data, Key.enter)) {
      this.activateSelection();
    }
  }

  render(width: number): string[] {
    if (this.disposed) return [];
    if (this.editor !== undefined)
      this.editor.focused = this.composerActive && this.focused;
    const agents = this.fleetAgents();
    this.reconcileSelection(agents);
    if (!this.focused)
      return this.boundCompact(this.renderCompact(agents, width));
    const lines: string[] = [
      this.theme.fg('dim', '↑↓ select · → expand · ← back · esc close'),
    ];
    for (const node of this.navigationNodes(agents))
      this.renderNode(node, width, lines);
    if (agents.length === 1 && agents[0]?.name === 'main')
      lines.push(this.theme.fg('muted', 'No subagents have been assigned.'));
    return this.boundLines(lines).map(line => truncateToWidth(line, width));
  }

  invalidate(): void {
    this.editor?.invalidate();
  }

  private renderCompact(
    agents: readonly FleetAgent[],
    width: number,
  ): string[] {
    const lines: string[] = [];
    for (const agent of agents) {
      const task = latestTask(agent);
      const icon = agent.name === 'main' ? '●' : '○';
      const text =
        agent.name === 'main'
          ? `${icon} ${agent.name}`
          : `${icon} ${agent.name}  ${task?.id ?? '-'} · ${oneLine(task?.description ?? 'No task')}`;
      const right = task === undefined ? '' : this.taskStats(task);
      lines.push(this.theme.fg('text', alignRight(text, right, width)));
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
      const task = latestTask(node.agent);
      const selected = node.agent.name === this.selectedAgentName;
      if (selected) this.selectedAgentLine = lines.length;
      const name = selected
        ? this.theme.bold(node.agent.name)
        : node.agent.name;
      let left = `${selected ? '●' : '○'} ${name}`;
      const right =
        node.agent.name === 'main' || task === undefined
          ? ''
          : this.taskStats(task);
      if (node.agent.name !== 'main' && task !== undefined) {
        left += `    ${task.id} · ${oneLine(task.description)}`;
      }
      lines.push(
        rowBackground(
          alignRight(this.theme.fg('text', left), right, width),
          width,
          this.theme,
          selected,
        ),
      );
      return;
    }
    if (node.kind === 'task') {
      if (node.key === this.selectedKey) this.selectedLine = lines.length;
      const prefix = `${'  '.repeat(node.depth + 1)}└─ `;
      const text = `${prefix}${node.task.id} · ${oneLine(node.task.description)}`;
      const line = alignRight(
        this.theme.fg('text', text),
        this.taskStats(node.task),
        width,
      );
      lines.push(node.key === this.selectedKey ? this.theme.bold(line) : line);
      return;
    }
    if (node.key === this.selectedKey) this.selectedLine = lines.length;
    const expanded = this.expandedSections.has(node.key);
    const prefix = `${'  '.repeat(node.depth + 1)}│ `;
    const glyph = expanded ? '▾' : '▸';
    const visibleGlyph =
      node.key === this.selectedKey ? this.theme.fg('accent', glyph) : glyph;
    const label = `${prefix}${visibleGlyph} ${this.sectionLabel(node)}`;
    lines.push(
      node.key === this.selectedKey
        ? this.theme.bold(this.theme.fg('text', label))
        : this.theme.fg('text', label),
    );
    if (expanded) this.renderSection(node, prefix, width, lines);
  }

  private taskStats(task: FleetTask): string {
    const stats = this.theme.fg(
      'accent',
      `${formatElapsed(task.elapsedSeconds)} · ↓ ${formatTokens(task.outputTokens)} tokens`,
    );
    const status = statusText(this.theme, task);
    return status.length === 0 ? stats : `${status}  ${stats}`;
  }

  private sectionLabel(
    node: Extract<Node, {readonly kind: 'section'}>,
  ): string {
    const {task, section} = node;
    switch (section) {
      case 'task':
        return `Task · ${oneLine(task.prompt || task.description)}`;
      case 'activity':
        return `Activity · ${task.activity[0]?.title ?? 'No tool activity'}`;
      case 'steering':
        return `Steering · ${task.steering.length} record${task.steering.length === 1 ? '' : 's'}`;
      case 'result':
        return `Result · ${task.result === undefined ? 'pending' : 'delivered'}`;
      case 'steer':
        return 'Steer current task';
      case 'reply':
        return 'Reply to question';
      case 'followUp':
        return 'New task';
      case 'cancel':
        return task.status === 'cancelling'
          ? 'Cancellation in progress'
          : 'Cancel branch';
    }
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
      appendWrapped(lines, task.prompt, bodyPrefix, width, this.theme);
      appendWrapped(lines, task.detail, bodyPrefix, width, this.theme);
    } else if (section === 'activity') {
      for (const activity of task.activity)
        this.renderActivity(activity, bodyPrefix, width, lines);
    } else if (section === 'steering') {
      for (const item of task.steering)
        appendWrapped(
          lines,
          `${item.state} · ${item.text}`,
          bodyPrefix,
          width,
          this.theme,
        );
    } else if (section === 'result') {
      appendWrapped(
        lines,
        task.result ?? 'No result has been delivered.',
        bodyPrefix,
        width,
        this.theme,
      );
    } else if (
      section === 'steer' ||
      section === 'reply' ||
      section === 'followUp'
    ) {
      if (section === 'reply' && task.question !== undefined) {
        appendWrapped(
          lines,
          `Question · ${task.question.text}`,
          bodyPrefix,
          width,
          this.theme,
        );
      }
      if (section === 'followUp') {
        appendWrapped(
          lines,
          `New task for ${node.agent.name}. Previous report remains available.`,
          bodyPrefix,
          width,
          this.theme,
        );
      }
      this.renderComposer(node, bodyPrefix, width, lines);
    } else {
      appendWrapped(
        lines,
        task.status === 'cancelling'
          ? 'Cancellation requested. Waiting for running work to stop.'
          : 'Cancel this task and every descendant it owns. Completed results remain available.',
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
    if (this.operation?.key === node.key) this.composerStart = lines.length;
    appendWrapped(
      lines,
      `To: ${node.agent.name} · ${node.section === 'followUp' ? 'new task' : node.task.id}`,
      prefix,
      width,
      this.theme,
    );
    if (this.operation?.key !== node.key || this.editor === undefined) return;
    const editorWidth = Math.max(12, width - visibleWidth(prefix));
    for (const line of this.editorViewport(this.editor.render(editorWidth)))
      lines.push(`${prefix}${line}`);
    const hint =
      this.operation.kind === 'reply'
        ? 'ctrl+enter reply · esc back'
        : 'ctrl+enter send · esc back';
    lines.push(`${prefix}${this.theme.fg('dim', hint)}`);
    this.composerEnd = lines.length;
  }

  private editorViewport(lines: string[]): string[] {
    const limit = Math.max(3, this.tui.terminal.rows - 16);
    if (lines.length <= limit) return lines;
    const bodyRows = limit - 2;
    const cursor = Math.max(
      1,
      lines.findIndex(line => line.includes(CURSOR_MARKER)),
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
    const result: Section[] = ['task', 'activity', 'steering', 'result'];
    if (
      task.status === 'running' ||
      (task.status === 'waiting' && task.question !== undefined)
    )
      result.push('steer');
    if (isActive(task)) result.push('cancel');
    if (task.question !== undefined && task.question.answer === undefined)
      result.push('reply');
    if (task.status === 'completed') result.push('followUp');
    if (this.operation?.taskId === task.id) {
      const section = this.operation.kind;
      if (!result.includes(section)) result.push(section);
    }
    return result;
  }

  private navigationNodes(agents: readonly FleetAgent[]): Node[] {
    const nodes: Node[] = [];
    for (const agent of agents) {
      nodes.push({kind: 'agent', key: keyForAgent(agent.name), agent});
      if (this.expandedAgents.has(agent.name))
        this.addAgentChildren(agent, nodes);
    }
    return nodes;
  }

  private addTasks(agent: FleetAgent, nodes: Node[]): void {
    for (const task of agent.tasks) {
      nodes.push({kind: 'task', key: taskKey(task.id), agent, task, depth: 0});
      if (!this.expandedTasks.has(task.id)) continue;
      for (const section of this.sections(task)) {
        nodes.push({
          kind: 'section',
          key: sectionKey(task.id, section),
          agent,
          task,
          section,
          depth: 1,
        });
      }
    }
  }

  private addAgentChildren(agent: FleetAgent, nodes: Node[]): void {
    const task = agent.tasks.length === 1 ? agent.tasks[0] : undefined;
    if (task !== undefined) {
      if (this.expandedTasks.has(task.id)) {
        for (const section of this.sections(task)) {
          nodes.push({
            kind: 'section',
            key: sectionKey(task.id, section),
            agent,
            task,
            section,
            depth: 0,
          });
        }
      }
      return;
    }
    this.addTasks(agent, nodes);
  }

  private moveSelection(direction: -1 | 1): void {
    const nodes = this.navigationNodes(this.fleetAgents());
    const current = Math.max(
      0,
      nodes.findIndex(node => node.key === this.selectedKey),
    );
    if (direction === -1 && current === 0) {
      this.focused = false;
      this.back();
      return;
    }
    const next =
      nodes[Math.min(nodes.length - 1, Math.max(0, current + direction))];
    if (next === undefined) return;
    this.selectedKey = next.key;
    this.selectedAgentName = next.agent.name;
    this.scrollOffset = -1;
    this.tui.requestRender();
  }

  private activateSelection(): void {
    this.scrollOffset = -1;
    const node = this.navigationNodes(this.fleetAgents()).find(
      candidate => candidate.key === this.selectedKey,
    );
    if (node === undefined) return;
    if (node.kind === 'agent') {
      if (node.agent.name === 'main') {
        this.focused = false;
        this.back();
        return;
      }
      if (this.expandedAgents.delete(node.agent.name)) {
        this.tui.requestRender();
        return;
      }
      this.expandedAgents.add(node.agent.name);
      this.expandTask(node.agent);
      this.tui.requestRender();
      return;
    }
    if (node.kind === 'task') {
      if (this.expandedTasks.delete(node.task.id)) this.tui.requestRender();
      else {
        this.expandedTasks.add(node.task.id);
        this.tui.requestRender();
      }
      return;
    }
    if (
      node.section === 'steer' ||
      node.section === 'reply' ||
      node.section === 'followUp'
    ) {
      this.beginComposer(node);
    } else if (node.section === 'cancel') {
      this.cancel(node.task.id);
    } else if (this.expandedSections.delete(node.key)) {
      this.tui.requestRender();
    } else {
      this.expandedSections.add(node.key);
      this.tui.requestRender();
    }
  }

  private expandSelection(): void {
    this.scrollOffset = -1;
    const node = this.navigationNodes(this.fleetAgents()).find(
      candidate => candidate.key === this.selectedKey,
    );
    if (node === undefined) return;
    if (node.kind === 'agent') {
      this.expandedAgents.add(node.agent.name);
      this.expandTask(node.agent);
    } else if (node.kind === 'task') {
      this.expandedTasks.add(node.task.id);
    } else if (
      node.section === 'steer' ||
      node.section === 'reply' ||
      node.section === 'followUp'
    ) {
      this.beginComposer(node);
      return;
    } else {
      this.expandedSections.add(node.key);
    }
    this.tui.requestRender();
  }

  private collapseOrBack(): void {
    this.scrollOffset = -1;
    const node = this.navigationNodes(this.fleetAgents()).find(
      candidate => candidate.key === this.selectedKey,
    );
    if (node === undefined) {
      this.back();
      return;
    }
    if (node.kind === 'section') {
      if (this.expandedSections.delete(node.key)) this.tui.requestRender();
      else {
        this.selectedKey =
          node.agent.tasks.length === 1 && node.depth === 0
            ? keyForAgent(node.agent.name)
            : taskKey(node.task.id);
        this.tui.requestRender();
      }
      return;
    }
    if (node.kind === 'task') {
      if (this.expandedTasks.delete(node.task.id)) this.tui.requestRender();
      else {
        this.selectedKey = keyForAgent(node.agent.name);
        this.tui.requestRender();
      }
      return;
    }
    if (this.expandedAgents.delete(node.agent.name)) this.tui.requestRender();
    else {
      this.focused = false;
      this.back();
    }
  }

  private beginComposer(node: Extract<Node, {readonly kind: 'section'}>): void {
    const {agent, task} = node;
    const operation: Operation = {
      kind:
        node.section === 'steer'
          ? 'steer'
          : node.section === 'reply'
            ? 'reply'
            : 'followUp',
      key: node.key,
      agentName: agent.name,
      taskId: task.id,
      questionId: node.section === 'reply' ? task.question?.id : undefined,
    };
    this.previousSelectionKey = this.selectedKey;
    this.selectedKey = operation.key;
    this.scrollOffset = -1;
    this.expandedSections.add(operation.key);
    this.operation = operation;
    this.editor = new Editor(this.tui, this.editorTheme, {paddingX: 0});
    this.editor.disableSubmit = true;
    this.editor.setText(this.drafts.get(operation.key) ?? '');
    this.editor.onChange = text => {
      this.drafts.set(operation.key, text);
      this.tui.requestRender();
    };
    this.editor.focused = true;
    this.composerActive = true;
    this.tui.setFocus(this);
    this.tui.requestRender();
  }

  private handleComposerInput(data: string): void {
    const editor = this.editor;
    const operation = this.operation;
    if (editor === undefined || operation === undefined) return;
    if (matchesKey(data, Key.escape)) {
      this.closeComposer(true);
    } else if (matchesKey(data, Key.ctrl('enter')) || data === '\u001b[13;5u') {
      this.submit(operation, editor.getExpandedText().trim());
    } else if (matchesKey(data, Key.enter)) {
      editor.handleInput('\n');
      this.tui.requestRender();
    } else {
      editor.handleInput(data);
      this.tui.requestRender();
    }
  }

  private submit(operation: Operation, text: string): void {
    if (text.length === 0) {
      this.reportError(
        'Cannot send an empty subagent message. Draft retained.',
      );
      return;
    }
    try {
      if (operation.kind === 'steer')
        this.controller.steer(operation.taskId, text);
      else if (operation.kind === 'reply') {
        if (operation.questionId === undefined) {
          this.reportError(
            'Could not reply: the question no longer exists. Draft retained.',
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
      this.reportError(
        `Could not send ${operation.kind}: ${detail.replace(/\.+$/, '')}. Draft retained.`,
      );
      return;
    }
    this.drafts.delete(operation.key);
    this.closeComposer(false);
  }

  private closeComposer(saveDraft: boolean): void {
    if (
      saveDraft &&
      this.operation !== undefined &&
      this.editor !== undefined
    ) {
      this.drafts.set(this.operation.key, this.editor.getExpandedText());
    }
    if (this.editor !== undefined) {
      this.editor.focused = false;
      this.editor.invalidate();
    }
    this.editor = undefined;
    this.operation = undefined;
    this.composerActive = false;
    this.selectedKey =
      this.previousSelectionKey ?? keyForAgent(this.selectedAgentName);
    this.previousSelectionKey = undefined;
    this.scrollOffset = -1;
    this.tui.setFocus(this);
    this.tui.requestRender();
  }

  private cancel(taskId: string): void {
    try {
      this.controller.cancel(taskId);
    } catch (caughtError) {
      const detail =
        caughtError instanceof Error
          ? caughtError.message
          : 'The controller rejected the operation';
      this.reportError(`Could not cancel task ${taskId}: ${detail}.`);
      return;
    }
    this.tui.requestRender();
  }

  private expandSelectedAgent(): void {
    const agent = this.fleetAgents().find(
      candidate => candidate.name === this.selectedAgentName,
    );
    if (agent === undefined) return;
    this.expandedAgents.add(agent.name);
    this.expandTask(agent);
  }

  private expandTask(agent: FleetAgent): void {
    const task = latestTask(agent);
    if (task === undefined) return;
    this.expandedTasks.add(task.id);
  }

  private reconcileSelection(agents: readonly FleetAgent[]): void {
    if (
      this.navigationNodes(agents).some(node => node.key === this.selectedKey)
    )
      return;
    const agent =
      agents.find(candidate => candidate.name === this.selectedAgentName) ??
      agents[0];
    this.selectedAgentName = agent?.name ?? 'main';
    this.selectedKey = keyForAgent(this.selectedAgentName);
  }

  private fleetAgents(): FleetAgent[] {
    const agents = this.controller.agents();
    const main = agents.find(agent => agent.name === 'main');
    const children = agents.filter(agent => agent.name !== 'main');
    return main === undefined
      ? [{name: 'main', tasks: []}, ...children]
      : [main, ...children];
  }

  private boundLines(lines: string[]): string[] {
    const limit = Math.max(7, this.tui.terminal.rows - 10);
    if (lines.length <= limit) return lines;
    if (this.composerActive) {
      return [
        lines[0] ?? '',
        lines[this.selectedAgentLine] ?? '',
        lines[this.selectedLine] ?? '',
        ...lines.slice(this.composerStart, this.composerEnd),
      ];
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
    if (start > 1) result.push(this.theme.fg('dim', '↑ more above'));
    result.push(...lines.slice(start, end));
    if (end < lines.length) result.push(this.theme.fg('dim', '↓ more below'));
    return result;
  }

  private scroll(direction: -1 | 1): void {
    const step = Math.max(3, Math.floor((this.tui.terminal.rows - 10) / 2));
    const current = this.scrollOffset < 0 ? 1 : this.scrollOffset;
    this.scrollOffset = Math.max(1, current + direction * step);
    this.tui.requestRender();
  }
}
