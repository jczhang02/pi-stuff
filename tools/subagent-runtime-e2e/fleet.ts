import type {
  AgentSession,
  ExtensionContext,
  Theme,
} from '@earendil-works/pi-coding-agent';
import type {SubagentManager} from '@arhen/pi-core-subagent/src/manager.ts';
import type {TaskSnapshot} from '@arhen/pi-core-subagent/src/types.ts';
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui';
import {Transcript} from './transcript';

export class AgentView {
  draft = '';
  scroll = 0;
  expanded = false;
  notice = '';
  transcript: Transcript;

  constructor(
    public task: TaskSnapshot,
    public session: AgentSession,
    changed: () => void,
  ) {
    this.transcript = new Transcript(session, changed);
  }
}

const token = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);

export class RuntimeFleet {
  readonly agents = new Map<string, AgentView>();
  focused = false;
  selected = 0;
  viewing: AgentView | undefined;
  changed = () => {};
  manager: SubagentManager | undefined;
  context: ExtensionContext | undefined;
  mainStarted = 0;
  mainEnded = 0;
  mainTools = 0;

  views(): AgentView[] {
    return (this.manager?.listRuns() ?? [])
      .flatMap(run =>
        run.tasks.map(task => this.agents.get(`${task.runId}:${task.id}`)),
      )
      .filter((view): view is AgentView => view !== undefined);
  }

  observe(task: TaskSnapshot, session: AgentSession): () => void {
    const key = `${task.runId}:${task.id}`;
    const previous = this.agents.get(key);
    previous?.transcript.dispose();
    const view = new AgentView(task, session, () => this.changed());
    if (previous) {
      view.draft = previous.draft;
      view.scroll = previous.scroll;
      view.expanded = previous.expanded;
      // Keep an already open viewer bound to the resumed real session.
      Object.assign(previous, view);
    } else this.agents.set(key, view);
    this.changed();
    return () => this.changed();
  }

  send(view: AgentView, value: string): boolean {
    const text = value.trim();
    if (!text || !this.manager || !this.context) return false;
    const task = view.task;
    if (task.status === 'awaiting_parent') {
      if (!this.manager.deliverReply(task.runId, task.id, text)) {
        view.notice = '问题已结束，请重新检查当前状态。';
        return false;
      }
    } else if (view.session.isStreaming) {
      if (!this.manager.steerTask(task.runId, task.id, text)) return false;
    } else {
      const result = this.manager.resumeTask(
        task.runId,
        task.id,
        this.context,
        {message: text},
      );
      if (!result.ok) {
        view.notice = result.reason;
        return false;
      }
    }
    view.notice = '';
    view.draft = '';
    view.scroll = 0;
    return true;
  }

  stop(view: AgentView): void {
    if (this.context)
      this.manager?.cancelTask(view.task.runId, view.task.id, this.context);
    this.changed();
  }

  select(data: string, empty: boolean): AgentView | 'main' | true | undefined {
    if (!this.focused) {
      if (empty && (matchesKey(data, 'down') || matchesKey(data, 'left'))) {
        this.focused = true;
        this.selected = 0;
        return true;
      }
      return undefined;
    }
    if (matchesKey(data, 'up')) {
      if (this.selected === 0) this.focused = false;
      else this.selected--;
    } else if (matchesKey(data, 'down'))
      this.selected = Math.min(this.agents.size, this.selected + 1);
    else if (matchesKey(data, 'escape')) this.focused = false;
    else if (matchesKey(data, 'enter')) {
      this.focused = false;
      return this.views()[this.selected - 1] ?? 'main';
    } else if (data === 'x' && this.selected > 0) {
      const view = this.views()[this.selected - 1];
      if (view) this.stop(view);
    } else {
      this.focused = false;
      return undefined;
    }
    return true;
  }

  render(width: number, theme: Theme): string[] {
    if (width < 50) return ['Fleet 需要至少 50 列；请放宽终端。'];
    const ctx = this.context;
    const entries = ctx?.sessionManager.getEntries() ?? [];
    const mainUsage = {input: 0, output: 0, cost: 0, turns: 0};
    let lastStop = '';
    for (const entry of entries)
      if (entry.type === 'message' && entry.message.role === 'assistant') {
        mainUsage.input += entry.message.usage.input;
        mainUsage.output += entry.message.usage.output;
        mainUsage.cost += entry.message.usage.cost.total;
        mainUsage.turns++;
        lastStop = entry.message.stopReason;
      }
    const mainStatus = !ctx?.isIdle()
      ? 'running'
      : lastStop === 'aborted'
        ? 'aborted'
        : lastStop === 'error'
          ? 'failed'
          : 'completed';
    const main = {
      name: 'main',
      status: mainStatus,
      activity:
        mainStatus === 'running'
          ? '正在处理任务'
          : mainStatus === 'aborted'
            ? '已停止，可继续交流'
            : mainStatus === 'failed'
              ? '执行失败，可继续交流'
              : '可继续交流',
      usage: mainUsage,
      tools: this.mainTools,
      seconds: this.mainStarted
        ? Math.floor(((this.mainEnded || Date.now()) - this.mainStarted) / 1000)
        : 0,
      current: !this.viewing,
    };
    const rows = [
      main,
      ...this.views().map(view => ({
        name: view.task.agent,
        status: view.task.status,
        activity: view.task.error ?? view.task.lastActivity ?? view.task.task,
        usage: view.task.usage,
        tools: view.task.toolCalls,
        seconds: Math.max(
          0,
          Math.floor(
            ((view.task.endedAt ?? Date.now()) -
              (view.task.startedAt ?? Date.now())) /
              1000,
          ),
        ),
        current: this.viewing === view,
      })),
    ];
    return rows.map((row, index) => {
      const icon =
        row.status === 'completed'
          ? '✓'
          : row.status === 'failed'
            ? '!'
            : row.status === 'aborted'
              ? '■'
              : row.status === 'awaiting_parent'
                ? '?'
                : ['⠋', '⠙', '⠹', '⠸'][Math.floor(Date.now() / 200) % 4];
      const color =
        row.status === 'failed'
          ? 'error'
          : row.status === 'completed'
            ? 'success'
            : row.status === 'running'
              ? 'accent'
              : 'warning';
      const essential = `↑ ${token(row.usage.input)} · ↓ ${token(row.usage.output)} · ${row.seconds}s`;
      const stats =
        width >= 125
          ? `${row.tools} tools · ${row.usage.turns} turns · ${essential} · $${row.usage.cost.toFixed(4)}`
          : essential;
      const selected = this.focused && index === this.selected;
      const left = truncateToWidth(
        `${selected ? '›' : ' '} ${theme.fg(color, icon ?? '·')} ${theme.bold(row.name)}${row.current ? ' *' : ''} · ${row.activity.replaceAll('\n', ' ')}`,
        Math.max(0, width - visibleWidth(stats) - 2),
        '…',
      );
      const line =
        left +
        ' '.repeat(
          Math.max(1, width - visibleWidth(left) - visibleWidth(stats)),
        ) +
        theme.fg('muted', stats);
      return selected ? theme.bg('selectedBg', line) : line;
    });
  }

  dispose(): void {
    for (const view of this.agents.values()) view.transcript.dispose();
    this.agents.clear();
  }
}
