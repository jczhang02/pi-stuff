import type {
  AgentSession,
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from '@earendil-works/pi-coding-agent';
import {isKeyRelease, matchesKey} from '@earendil-works/pi-tui';
import {Effect} from 'effect';
import type {SubagentManager, TaskSnapshot} from '../runtime';
import {Transcript} from './transcript';
import {renderFleet, type FleetRow} from './rows';
import {sessionUsage} from '../runtime/usage';

export class AgentView {
  draft = '';
  scroll = 0;
  expanded = false;
  notice = '';
  submitting = false;
  session: AgentSession | undefined;
  transcript: Transcript | undefined;

  constructor(public task: TaskSnapshot) {}

  bind(session: AgentSession, changed: () => void): void {
    if (this.session === session) return;
    this.transcript?.dispose();
    this.session = session;
    this.transcript = new Transcript(session, changed);
  }
}

export class Fleet {
  private readonly agents = new Map<string, AgentView>();
  focused = false;
  selected = 0;
  viewing: AgentView | undefined;
  changed = () => {};
  closeViewer: (() => void) | undefined;
  context: ExtensionContext | undefined;
  mainActivity = '';

  constructor(readonly manager: SubagentManager) {}

  views(): AgentView[] {
    return this.manager.listRuns().flatMap(run =>
      run.tasks.map(task => {
        const key = `${task.runId}:${task.id}`;
        let view = this.agents.get(key);
        if (!view) {
          view = new AgentView(task);
          this.agents.set(key, view);
        }
        view.task = task;
        const session = this.manager.getSession(task.runId, task.id);
        if (session) view.bind(session, () => this.changed());
        return view;
      }),
    );
  }

  observe(task: TaskSnapshot, session: AgentSession): void {
    const key = `${task.runId}:${task.id}`;
    const view = this.agents.get(key) ?? new AgentView(task);
    view.task = task;
    view.bind(session, () => this.changed());
    this.agents.set(key, view);
    this.changed();
  }

  async load(view: AgentView): Promise<void> {
    const ctx = this.context;
    if (view.session || !ctx) return;
    await this.perform(view, async () => {
      const session = await this.manager.sessionFor(
        view.task.runId,
        view.task.id,
        ctx,
      );
      if (session) view.bind(session, () => this.changed());
    });
  }

  async send(view: AgentView, text: string): Promise<boolean> {
    const ctx = this.context;
    if (!ctx || !text.trim() || view.submitting) return false;
    view.submitting = true;
    const accepted = await this.perform(view, async () => {
      const task = this.manager.getTask(view.task.runId, view.task.id);
      if (!task) throw new Error('此代理已不属于当前会话。');
      if (task.status === 'awaiting_parent') {
        if (!this.manager.deliverReply(task.runId, task.id, text))
          throw new Error('问题已经结束，请检查当前状态后重试。');
      } else if (task.status === 'running' || task.status === 'starting') {
        if (!this.manager.steerTask(task.runId, task.id, text))
          throw new Error('代理正在切换状态，请重试；输入已保留。');
      } else {
        const result = await this.manager.resumeTask(task.runId, task.id, ctx, {
          message: text,
        });
        if (!result.ok) throw new Error(result.reason);
      }
    });
    view.submitting = false;
    if (accepted) {
      view.notice = '';
      view.scroll = 0;
    }
    this.changed();
    return accepted;
  }

  stop(view: AgentView): void {
    const ctx = this.context;
    if (ctx)
      void this.perform(view, async () => {
        await this.manager.cancelTask(view.task.runId, view.task.id, ctx);
      });
  }

  private async perform(
    view: AgentView,
    action: () => Promise<void>,
  ): Promise<boolean> {
    return Effect.runPromise(
      Effect.tryPromise({
        try: action,
        catch: error =>
          error instanceof Error ? error.message : '子代理操作失败。',
      }).pipe(
        Effect.as(true),
        Effect.catch(message => {
          view.notice = message;
          this.changed();
          return Effect.succeed(false);
        }),
      ),
    );
  }

  select(
    data: string,
    empty: boolean,
    keys: KeybindingsManager,
  ): AgentView | 'main' | true | undefined {
    if (isKeyRelease(data)) return true;
    const views = this.views();
    if (!views.length) return undefined;
    if (!this.focused) {
      if (empty && (matchesKey(data, 'down') || matchesKey(data, 'left'))) {
        this.focused = true;
        this.selected = this.viewing
          ? Math.max(0, views.indexOf(this.viewing) + 1)
          : 0;
        return true;
      }
      return undefined;
    }
    if (keys.matches(data, 'tui.select.up')) {
      if (this.selected === 0) this.focused = false;
      else this.selected--;
    } else if (keys.matches(data, 'tui.select.down'))
      this.selected = Math.min(views.length, this.selected + 1);
    else if (keys.matches(data, 'tui.select.cancel')) this.focused = false;
    else if (keys.matches(data, 'tui.select.confirm')) {
      this.focused = false;
      return views[this.selected - 1] ?? 'main';
    } else if (data === 'x' && this.selected > 0) {
      const view = views[this.selected - 1];
      if (view) this.stop(view);
    } else {
      this.focused = false;
      return undefined;
    }
    return true;
  }

  render(width: number, theme: Theme, maxRows = 6): string[] {
    const usage = sessionUsage(this.context?.sessionManager.getEntries() ?? []);
    const rows: FleetRow[] = [
      {
        name: 'main',
        status: this.context?.isIdle() ? 'completed' : 'running',
        activity: this.mainActivity,
        input: usage.input,
        output: usage.output,
        seconds: 0,
      },
      ...this.views().map(view => {
        const compacting = this.manager.compactionStartedAt(
          view.task.runId,
          view.task.id,
        );
        const startedAt =
          compacting ??
          (['starting', 'running', 'awaiting_parent'].includes(view.task.status)
            ? view.task.startedAt
            : undefined);
        return {
          name: view.task.agent,
          status:
            compacting !== undefined ? ('running' as const) : view.task.status,
          activity:
            compacting !== undefined
              ? 'Compacting context'
              : (view.task.error ?? view.task.lastActivity ?? view.task.task),
          input:
            view.task.usage.input +
            view.task.usage.cacheRead +
            view.task.usage.cacheWrite,
          output: view.task.usage.output,
          seconds:
            ((view.task.elapsedMs ?? 0) +
              (startedAt === undefined ? 0 : Date.now() - startedAt)) /
            1000,
        };
      }),
    ];
    return renderFleet(
      rows,
      this.focused ? this.selected : undefined,
      width,
      theme,
      maxRows,
    );
  }

  dispose(): void {
    this.closeViewer?.();
    this.context = undefined;
    for (const view of this.agents.values()) view.transcript?.dispose();
    this.agents.clear();
  }
}
