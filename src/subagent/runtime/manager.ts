import type {
  AgentSession,
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {resolve} from 'node:path';
import {createMailbox} from './mailbox';
import {applyUpstream, resolveNeeds} from './graph';
import {formatRun, taskSummary, truncateText} from './format';
import {RunStore} from './storage';
import {TaskSession, SubagentError, resolveChildModel} from './session';
import {
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
  type SubagentInput,
  type TaskInput,
} from './schemas';
import {
  TERMINAL,
  MAX_TASKS,
  type RunSnapshot,
  type TaskSnapshot,
  type UsageStats,
} from './types';

// Forked from Arhen 1.3.54. A task owns each execution; no batch finalizer can
// abort a resumed sibling. Dependency outputs are captured after real completion.
export interface ParkedMsg {
  kind: 'ask' | 'notify' | 'done';
  taskId: string;
  agent: string;
  text: string;
}
export type RuntimeListener = () => void;
export interface SubagentRuntimeOptions {
  notify?: (text: string, urgent: boolean) => void;
  onSession?: (task: TaskSnapshot, session: AgentSession) => void;
  report?: (message: string) => void;
}
interface RunState {
  run: RunSnapshot;
  ctx: ExtensionContext;
  outputs: Map<string, string>;
  prompts: Map<string, string>;
  intercom: ParkedMsg[];
  waiters: Set<() => void>;
  terminalNotified: boolean;
}
interface Execution {
  kind: 'prompt' | 'compaction';
  startedAt: number;
  controller: AbortController;
  done: Promise<void>;
}
const emptyUsage = (): UsageStats => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  turns: 0,
});

export class SubagentManager {
  private readonly runs = new Map<string, RunState>();
  private readonly sessions = new Map<string, TaskSession>();
  private readonly active = new Map<string, Execution>();
  private readonly replies = new Map<string, (answer: string) => void>();
  private readonly mailboxes = createMailbox();
  private readonly listeners = new Set<RuntimeListener>();
  private store: RunStore | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly options: SubagentRuntimeOptions = {},
  ) {}

  listRuns(): RunSnapshot[] {
    return [...this.runs.values()].map(state => structuredClone(state.run));
  }
  getRun(id: string | undefined): RunSnapshot | undefined {
    const run = id ? this.runs.get(id)?.run : undefined;
    return run ? structuredClone(run) : undefined;
  }
  getTask(runId: string, taskId: string): TaskSnapshot | undefined {
    return this.getRun(runId)?.tasks.find(task => task.id === taskId);
  }
  getSession(runId: string, taskId: string): AgentSession | undefined {
    return this.sessions.get(`${runId}:${taskId}`)?.session;
  }
  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
    for (const state of this.runs.values())
      if (TERMINAL.includes(state.run.status))
        for (const wake of state.waiters) wake();
    if (!this.closed && !this.saveTimer)
      this.saveTimer = setTimeout(() => {
        this.saveTimer = undefined;
        this.store?.save(this.listRuns());
      }, 250);
  }

  async restoreFromSidecar(ctx: ExtensionContext): Promise<void> {
    this.store = new RunStore(ctx.sessionManager.getSessionFile(), message =>
      this.options.report?.(message),
    );
    for (const run of await this.store.load()) {
      const state: RunState = {
        run,
        ctx,
        outputs: new Map(),
        prompts: new Map(),
        intercom: [],
        waiters: new Set(),
        terminalNotified: true,
      };
      for (const task of run.tasks) {
        if (task.status === 'completed')
          state.outputs.set(task.id, task.finalText ?? '');
        this.mailboxes.open(`${run.id}:${task.id}`);
      }
      this.runs.set(run.id, state);
    }
    this.changed();
  }

  startInBackground(params: SubagentInput, ctx: ExtensionContext) {
    this.store?.assertWritable();
    if (this.closed)
      throw new SubagentError({message: 'Parent session is shutting down.'});
    if (this.runs.size >= 50)
      throw new SubagentError({
        message:
          'This parent has 50 retained runs. Start a new parent session before creating more.',
      });
    const modes =
      Number(params.tasks !== undefined) +
      Number(params.chain !== undefined) +
      Number(params.agent !== undefined || params.task !== undefined);
    if (modes !== 1)
      throw new SubagentError({
        message: 'Use exactly one of agent+task, tasks, or chain.',
      });
    let inputs: TaskInput[];
    if (params.tasks || params.chain) {
      if (
        params.model ||
        params.tools ||
        params.prompt ||
        params.thinking ||
        params.write !== undefined
      )
        throw new SubagentError({
          message:
            'Set model, tools, prompt, thinking and write on each task in a batch.',
        });
      inputs = (params.tasks ?? params.chain ?? []).map(input => ({
        ...input,
        cwd: input.cwd ?? params.cwd,
        maxRuntimeMs: input.maxRuntimeMs ?? params.maxRuntimeMs,
      }));
    } else {
      if (!params.agent || !params.task)
        throw new SubagentError({
          message: 'Single mode requires agent and task.',
        });
      inputs = [
        {
          agent: params.agent,
          task: params.task,
          prompt: params.prompt,
          write: params.write,
          model: params.model,
          thinking: params.thinking,
          tools: params.tools,
          cwd: params.cwd,
          maxRuntimeMs: params.maxRuntimeMs,
        },
      ];
    }
    if (!inputs.length || inputs.length > MAX_TASKS)
      throw new SubagentError({message: `A run needs 1–${MAX_TASKS} tasks.`});
    const concurrency = params.concurrency ?? DEFAULT_CONCURRENCY;
    if (
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > MAX_CONCURRENCY
    )
      throw new SubagentError({
        message: `Concurrency must be an integer from 1 to ${MAX_CONCURRENCY}.`,
      });
    const mode = params.chain ? 'chain' : params.tasks ? 'parallel' : 'single';
    const edges = resolveNeeds(inputs, mode);
    for (const input of inputs) {
      if (!input.agent.trim() || !input.task.trim())
        throw new SubagentError({
          message: 'Agent names and tasks must not be blank.',
        });
      if (input.id && !/^[A-Za-z0-9_-]{1,64}$/.test(input.id))
        throw new SubagentError({
          message:
            'Task ids must contain 1–64 letters, digits, underscores or hyphens.',
        });
      if (
        input.maxRuntimeMs !== undefined &&
        (!Number.isInteger(input.maxRuntimeMs) ||
          input.maxRuntimeMs < 10 ||
          input.maxRuntimeMs > 21_600_000)
      )
        throw new SubagentError({
          message: 'maxRuntimeMs must be an integer between 10 and 21600000.',
        });
    }
    const id = `run_${crypto.randomUUID().replaceAll('-', '')}`;
    const run: RunSnapshot = {
      id,
      mode,
      status: 'queued',
      notifyPerTask: params.notifyPerTask ?? true,
      createdAt: Date.now(),
      concurrency,
      aggregateUsage: emptyUsage(),
      tasks: inputs.map((input, index) => ({
        id: input.id ?? `task_${index + 1}`,
        runId: id,
        agent: input.agent,
        task: input.task,
        cwd: resolve(ctx.cwd, input.cwd ?? '.'),
        prompt: input.prompt,
        write: input.write,
        tools: input.tools,
        model: input.model,
        thinking: input.thinking,
        maxRuntimeMs: input.maxRuntimeMs ?? 3_600_000,
        status: 'queued',
        needs: edges[index] ?? [],
        toolCalls: 0,
        usage: emptyUsage(),
        elapsedMs: 0,
      })),
    };
    const roster = run.tasks
      .map(
        task =>
          `${task.id} (${task.agent})${task.needs?.length ? ` waits for ${task.needs.join(', ')}` : ''}`,
      )
      .join('; ');
    for (const task of run.tasks) {
      task.roster = roster;
      this.mailboxes.open(`${run.id}:${task.id}`);
    }
    this.runs.set(id, {
      run,
      ctx,
      outputs: new Map(),
      prompts: new Map(),
      intercom: [],
      waiters: new Set(),
      terminalNotified: false,
    });
    this.store ??= new RunStore(ctx.sessionManager.getSessionFile(), message =>
      this.options.report?.(message),
    );
    this.pump();
    return {run: structuredClone(run)};
  }

  private pump(): void {
    if (this.closed) return;
    for (const state of this.runs.values()) {
      const run = state.run;
      let running = run.tasks.filter(task =>
        this.active.has(`${run.id}:${task.id}`),
      ).length;
      for (const task of run.tasks) {
        if (task.status !== 'queued') continue;
        const needs = state.prompts.has(task.id) ? [] : (task.needs ?? []);
        const broken = needs.filter(
          id =>
            !state.outputs.has(id) &&
            run.tasks.some(
              upstream =>
                upstream.id === id && TERMINAL.includes(upstream.status),
            ),
        );
        if (broken.length) {
          task.status = 'aborted';
          task.error = `Dependency did not complete: ${broken.join(', ')}.`;
          task.endedAt = Date.now();
          continue;
        }
        if (
          !needs.every(id => state.outputs.has(id)) ||
          running >= run.concurrency ||
          this.active.size >= MAX_CONCURRENCY
        )
          continue;
        const message =
          state.prompts.get(task.id) ??
          applyUpstream(task.task, needs, state.outputs);
        state.prompts.delete(task.id);
        this.launch(state, task, message);
        running++;
      }
      this.refresh(state);
    }
    this.changed();
  }

  private launch(state: RunState, task: TaskSnapshot, message: string): void {
    const key = `${task.runId}:${task.id}`;
    const controller = new AbortController();
    task.status = 'starting';
    task.lastActivity = 'Preparing conversation';
    task.startedAt = Date.now();
    task.endedAt = undefined;
    task.error = undefined;
    state.run.startedAt ??= task.startedAt;
    state.run.endedAt = undefined;
    state.terminalNotified = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, task.maxRuntimeMs ?? 3_600_000);
    // Start in a microtask after the execution slot is registered.
    const done = Promise.resolve().then(async () => {
      try {
        await this.taskSession(state, task).execute(message, controller.signal);
        if (!controller.signal.aborted) task.status = 'completed';
      } catch (error) {
        task.status =
          controller.signal.aborted && !timedOut ? 'aborted' : 'failed';
        task.error =
          error instanceof Error ? error.message : 'Child execution failed.';
      } finally {
        clearTimeout(timer);
        if (controller.signal.aborted) {
          task.status = timedOut ? 'failed' : 'aborted';
          task.error = timedOut
            ? `Task exceeded ${task.maxRuntimeMs ?? 3_600_000}ms.`
            : 'Canceled by parent or user.';
        }
        task.endedAt = Date.now();
        task.elapsedMs =
          (task.elapsedMs ?? 0) +
          task.endedAt -
          (task.startedAt ?? task.endedAt);
        this.active.delete(key);
        this.replies.get(key)?.('Task ended. Stop work.');
        if (task.status === 'completed')
          state.outputs.set(task.id, task.finalText ?? '');
        task.lastActivity =
          task.error ??
          task.finalText?.replace(/\s+/g, ' ').slice(0, 160) ??
          task.status;
        this.refresh(state);
        if (!this.closed && state.run.notifyPerTask)
          this.notice(
            state,
            task,
            'done',
            truncateText(taskSummary(task), 4000),
            task.status === 'failed',
          );
        this.pump();
      }
    });
    this.active.set(key, {
      kind: 'prompt',
      startedAt: task.startedAt,
      controller,
      done,
    });
  }

  compactionStartedAt(runId: string, taskId: string): number | undefined {
    const execution = this.active.get(`${runId}:${taskId}`);
    return execution?.kind === 'compaction' ? execution.startedAt : undefined;
  }

  compactTask(runId: string, taskId: string): Promise<void> {
    const state = this.runs.get(runId);
    const task = state?.run.tasks.find(task => task.id === taskId);
    const key = `${runId}:${taskId}`;
    if (
      !state ||
      !task ||
      !task.sessionFile ||
      this.closed ||
      !TERMINAL.includes(task.status) ||
      this.active.has(key)
    )
      return Promise.reject(
        new SubagentError({
          message:
            'Wait for a saved child conversation to finish before compacting.',
        }),
      );
    const running = state.run.tasks.filter(candidate =>
      this.active.has(`${runId}:${candidate.id}`),
    ).length;
    if (running >= state.run.concurrency || this.active.size >= MAX_CONCURRENCY)
      return Promise.reject(
        new SubagentError({
          message:
            'All execution slots are occupied. Retry compaction after a child finishes.',
        }),
      );
    const controller = new AbortController();
    const startedAt = Date.now();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, task.maxRuntimeMs ?? 3_600_000);
    const done = Promise.resolve().then(async () => {
      try {
        await this.taskSession(state, task).compact(controller.signal);
      } catch (error) {
        if (timedOut)
          throw new SubagentError({
            message: 'Child compaction exceeded its runtime limit.',
          });
        throw error;
      } finally {
        clearTimeout(timer);
        this.active.delete(key);
        task.elapsedMs = (task.elapsedMs ?? 0) + Date.now() - startedAt;
        this.refresh(state);
        this.pump();
      }
    });
    this.active.set(key, {kind: 'compaction', startedAt, controller, done});
    this.refresh(state);
    this.changed();
    return done;
  }

  private refresh(state: RunState): void {
    const run = state.run;
    run.aggregateUsage = emptyUsage();
    for (const task of run.tasks) {
      for (const key of [
        'input',
        'output',
        'cacheRead',
        'cacheWrite',
        'cost',
        'turns',
      ] as const)
        run.aggregateUsage[key] += task.usage[key];
    }
    const active = run.tasks.some(
      task =>
        !TERMINAL.includes(task.status) ||
        this.active.has(`${run.id}:${task.id}`),
    );
    if (active) {
      run.endedAt = undefined;
      run.status = run.tasks.some(
        task => task.status === 'running' || task.status === 'starting',
      )
        ? 'running'
        : run.tasks.some(task => task.status === 'awaiting_parent')
          ? 'awaiting_parent'
          : 'running';
      return;
    }
    run.status = run.tasks.some(task => task.status === 'failed')
      ? 'failed'
      : run.tasks.some(task => task.status === 'aborted')
        ? 'aborted'
        : 'completed';
    run.endedAt ??= Date.now();
    if (!state.terminalNotified) {
      state.terminalNotified = true;
      if (!this.closed && !run.notifyPerTask) {
        if (state.waiters.size)
          state.intercom.push({
            kind: 'done',
            taskId: '',
            agent: 'all',
            text: formatRun(run),
          });
        else this.options.notify?.(formatRun(run), run.status === 'failed');
      }
    }
  }

  private taskSession(state: RunState, task: TaskSnapshot): TaskSession {
    const key = `${task.runId}:${task.id}`;
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const session = new TaskSession(
      task,
      state.ctx,
      {
        onAskParent: (_id, question, signal) =>
          this.ask(state, task, question, signal),
        onNotifyParent: (_id, message, level) =>
          this.notice(state, task, 'notify', message, level === 'error'),
        onSendMessage: (_id, to, message) => {
          if (to === 'leader') {
            this.notice(state, task, 'notify', message, false);
            return true;
          }
          return this.mailboxes.send(key, `${task.runId}:${to}`, message);
        },
        onPollMailbox: () => this.mailboxes.poll(key),
      },
      {
        changed: () => {
          this.refresh(state);
          this.changed();
        },
        opened: (snapshot, session) =>
          this.options.onSession?.(snapshot, session),
      },
    );
    this.sessions.set(key, session);
    return session;
  }

  private ask(
    state: RunState,
    task: TaskSnapshot,
    question: string,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const key = `${task.runId}:${task.id}`;
    if (signal?.aborted || this.closed)
      return Promise.resolve('Task canceled. Stop work.');
    if (this.replies.has(key))
      return Promise.resolve(
        'A question is already pending. Wait for its answer before asking another.',
      );
    task.status = 'awaiting_parent';
    task.lastActivity = question;
    return new Promise(resolveAnswer => {
      const finish = (answer: string) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        this.replies.delete(key);
        if (task.status === 'awaiting_parent') task.status = 'running';
        this.refresh(state);
        this.changed();
        resolveAnswer(answer);
      };
      const aborted = () => finish('Task canceled. Stop work.');
      const timer = setTimeout(
        () =>
          finish(
            'The parent did not answer within 10 minutes. State what remains blocked; do not invent an answer.',
          ),
        600_000,
      );
      this.replies.set(key, finish);
      signal?.addEventListener('abort', aborted, {once: true});
      this.notice(state, task, 'ask', question, false);
      this.refresh(state);
      this.changed();
    });
  }

  private notice(
    state: RunState,
    task: TaskSnapshot,
    kind: ParkedMsg['kind'],
    text: string,
    urgent: boolean,
  ): void {
    if (this.closed) return;
    const message: ParkedMsg = {kind, taskId: task.id, agent: task.agent, text};
    if (state.waiters.size) {
      state.intercom.push(message);
      for (const wake of state.waiters) wake();
    } else
      this.options.notify?.(
        `[Subagent ${task.agent}; run ${state.run.id}; task ${task.id}; ${kind}]\n${text}${kind === 'ask' ? '\nAnswer with reply_subagent(runId, taskId, message).' : ''}`,
        urgent,
      );
    this.pi.events.emit('pi-stuff:subagent', {
      runId: state.run.id,
      taskId: task.id,
      kind,
    });
  }

  deliverReply(runId: string, taskId: string, message: string): boolean {
    const reply = this.replies.get(`${runId}:${taskId}`);
    if (!reply || !message.trim()) return false;
    reply(message);
    return true;
  }

  steerTask(
    runId: string,
    taskId: string | undefined,
    message: string,
  ): boolean {
    const state = this.runs.get(runId);
    if (!state || !message.trim()) return false;
    const targets = state.run.tasks.filter(
      task =>
        (!taskId || task.id === taskId) &&
        task.status === 'running' &&
        this.getSession(runId, task.id)?.isStreaming,
    );
    for (const task of targets) {
      const session = this.getSession(runId, task.id);
      if (session)
        void session.steer(message).catch(error => {
          task.error =
            error instanceof Error ? error.message : 'Cannot steer child.';
          this.changed();
        });
    }
    return targets.length > 0;
  }

  async resumeTask(
    runId: string,
    taskId: string,
    ctx: ExtensionContext,
    options: {message?: string | undefined; model?: string | undefined} = {},
  ): Promise<{ok: true; task: TaskSnapshot} | {ok: false; reason: string}> {
    const state = this.runs.get(runId);
    const task = state?.run.tasks.find(task => task.id === taskId);
    if (!state || !task || this.closed)
      return {ok: false, reason: 'Task is unavailable in this parent session.'};
    if (!TERMINAL.includes(task.status))
      return {
        ok: false,
        reason: `Task is ${task.status}; use steer or answer its pending question.`,
      };
    if (
      this.compactionStartedAt(runId, taskId) !== undefined ||
      this.getSession(runId, taskId)?.isCompacting
    )
      return {
        ok: false,
        reason:
          'This child is compacting. Wait or cancel its compaction before continuing.',
      };
    const key = `${runId}:${taskId}`;
    await this.active.get(key)?.done;
    if (
      this.closed ||
      !TERMINAL.includes(task.status) ||
      this.compactionStartedAt(runId, taskId) !== undefined
    )
      return {ok: false, reason: 'Task state changed before continuation.'};
    if (options.model) {
      try {
        const model = resolveChildModel(ctx, options.model);
        task.model = `${model.provider}/${model.id}`;
      } catch (error) {
        return {
          ok: false,
          reason:
            error instanceof Error
              ? error.message
              : 'Cannot change child model.',
        };
      }
    }
    task.status = 'queued';
    task.error = undefined;
    task.endedAt = undefined;
    // Direct continuations bypass the dependency gate while retaining its graph.
    if (!this.getSession(runId, taskId)) this.sessions.delete(key);
    state.ctx = ctx;
    state.terminalNotified = false;
    state.prompts.set(
      taskId,
      options.message?.trim() ||
        'Continue the assigned task from the saved conversation. Explain any remaining blocker.',
    );
    this.pump();
    return {ok: true, task: structuredClone(task)};
  }

  async sessionFor(
    runId: string,
    taskId: string,
    _ctx?: ExtensionContext,
  ): Promise<AgentSession | undefined> {
    const state = this.runs.get(runId);
    const task = state?.run.tasks.find(task => task.id === taskId);
    if (!state || !task || this.closed) return undefined;
    const existing = this.getSession(runId, taskId);
    if (existing) return existing;
    if (!task.sessionFile) return undefined;
    return this.taskSession(state, task).open();
  }

  cancelTask(runId: string, taskId: string, _ctx?: ExtensionContext): boolean {
    const state = this.runs.get(runId);
    const task = state?.run.tasks.find(task => task.id === taskId);
    if (!state || !task) return false;
    const canceled = this.cancel(task);
    this.pump();
    return canceled;
  }
  cancelRun(runId: string) {
    const state = this.runs.get(runId);
    let aborted = 0;
    for (const task of state?.run.tasks ?? []) if (this.cancel(task)) aborted++;
    this.pump();
    return {aborted};
  }

  private cancel(task: TaskSnapshot): boolean {
    const key = `${task.runId}:${task.id}`;
    const execution = this.active.get(key);
    if (execution?.kind === 'compaction') {
      execution.controller.abort();
      return true;
    }
    if (TERMINAL.includes(task.status)) return false;
    task.status = 'aborted';
    task.error = 'Cancellation requested.';
    if (execution) execution.controller.abort();
    else task.endedAt = Date.now();
    this.replies.get(key)?.('Task canceled. Stop work.');
    return true;
  }

  awaitRun(
    runId: string,
    timeoutMs = 60_000,
    signal?: AbortSignal,
  ): Promise<{run: RunSnapshot; intercom: ParkedMsg[]} | undefined> {
    const state = this.runs.get(runId);
    if (!state) return Promise.resolve(undefined);
    if (!state.intercom.length)
      for (const task of state.run.tasks)
        if (task.status === 'awaiting_parent')
          state.intercom.push({
            kind: 'ask',
            taskId: task.id,
            agent: task.agent,
            text: task.lastActivity ?? 'A child is waiting for your answer.',
          });
    if (
      TERMINAL.includes(state.run.status) ||
      state.run.tasks.some(task => task.status === 'awaiting_parent') ||
      state.intercom.length ||
      signal?.aborted
    )
      return Promise.resolve({
        run: structuredClone(state.run),
        intercom: state.intercom.splice(0),
      });
    return new Promise(resolveResult => {
      const wake = () => {
        clearTimeout(timer);
        state.waiters.delete(wake);
        signal?.removeEventListener('abort', wake);
        resolveResult({
          run: structuredClone(state.run),
          intercom: state.intercom.splice(0),
        });
      };
      const timer = setTimeout(wake, Math.max(1, Math.min(timeoutMs, 60_000)));
      state.waiters.add(wake);
      signal?.addEventListener('abort', wake, {once: true});
    });
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    for (const state of this.runs.values()) this.cancelRun(state.run.id);
    await Promise.all(
      [...this.active.values()].map(execution =>
        execution.done.catch(() => undefined),
      ),
    );
    await Promise.all(
      [...this.sessions.values()].map(session => session.dispose()),
    );
    for (const state of this.runs.values()) {
      this.refresh(state);
      for (const wake of state.waiters) wake();
    }
    this.store?.save(this.listRuns());
    await this.store?.flush();
    this.listeners.clear();
    this.sessions.clear();
    this.replies.clear();
  }
}
