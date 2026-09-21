import type {
  AgentSession,
  ExtensionContext,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import {randomUUID} from 'node:crypto';
import {Effect} from 'effect';
import {applyUpstream, runWaveScheduler} from './graph';
import {openSavedSession, SubagentError} from './session';
import {executeRequest} from './request';
import type {RunSnapshot, TaskSnapshot} from './records';
import type {ContinuationInput, Dispatch} from './protocol';
import {Communication} from './communication';
import {
  resolveConfiguration,
  selectModel,
  validateThinking,
  type ResolvedConfiguration,
} from './configuration';
import {attachWorkspace} from './workspace';

interface Run {
  snapshot: RunSnapshot;
  controllers: Map<string, AbortController>;
  completion: Promise<void>;
  communication: Communication;
  children: Map<string, AgentSession>;
  waiters: Set<() => void>;
  configurations: Map<string, ResolvedConfiguration>;
  notifyPerTask: boolean;
  continuing: boolean;
}

export class Runs {
  private readonly runs = new Map<string, Run>();
  private generation = 0;

  constructor(
    private readonly notify: (
      run: RunSnapshot,
      task: TaskSnapshot,
      message?: string,
    ) => void,
  ) {}

  private notifyParent(
    run: RunSnapshot,
    task: TaskSnapshot,
    message?: string,
  ): void {
    try {
      this.notify(run, task, message);
    } catch (error) {
      task.notificationError =
        error instanceof Error ? error.message : String(error);
    }
  }

  async dispatch(
    input: Dispatch,
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ): Promise<RunSnapshot> {
    const generation = this.generation;
    const configurations = new Map(
      await Promise.all(
        input.tasks.map(
          async task =>
            [
              task.id,
              await Effect.runPromise(resolveConfiguration(task, ctx, signal)),
            ] as const,
        ),
      ),
    );
    signal?.throwIfAborted();
    if (generation !== this.generation)
      throw new SubagentError({
        message: 'The parent session changed during dispatch.',
      });
    const snapshot: RunSnapshot = {
      id: randomUUID(),
      mode: input.mode,
      status: 'running',
      intercom: [],
      tasks: input.tasks.map(task => ({
        ...task,
        requestId: randomUUID(),
        history: [],
        status: 'queued',
        finalText: '',
        pendingInstructions: [],
        configurationNotes: [],
      })),
    };
    const waiters = new Set<() => void>();
    const communication = new Communication(
      input.tasks.map(task => task.id),
      (taskId, question) => {
        const task = snapshot.tasks.find(task => task.id === taskId);
        if (!task) return;
        if (question) {
          task.question = question;
          task.status = 'awaiting_parent';
          if (waiters.size === 0) this.notifyParent(snapshot, task);
          for (const wake of waiters) wake();
        } else {
          delete task.question;
          if (task.status === 'awaiting_parent') task.status = 'running';
        }
      },
      (taskId, text, level) => {
        snapshot.intercom.push({taskId, text, level});
        if (snapshot.intercom.length > 24) snapshot.intercom.shift();
        const task = snapshot.tasks.find(task => task.id === taskId);
        if (task && waiters.size === 0)
          this.notifyParent(snapshot, task, `${level}: ${text}`);
        for (const wake of waiters) wake();
      },
    );
    const run: Run = {
      snapshot,
      controllers: new Map(
        input.tasks.map(task => [task.id, new AbortController()]),
      ),
      completion: Promise.resolve(),
      communication,
      children: new Map(),
      waiters,
      configurations,
      notifyPerTask: input.notifyPerTask,
      continuing: false,
    };
    this.runs.set(snapshot.id, run);
    run.completion = this.execute(run, input, ctx);
    return snapshot;
  }

  private async execute(run: Run, input: Dispatch, ctx: ExtensionContext) {
    const outputs = new Map<string, string>();
    const result = await runWaveScheduler(
      run.snapshot.tasks,
      input.concurrency,
      outputs,
      new Set(),
      async task => {
        const base = task.needs
          .map(id => run.snapshot.tasks.find(task => task.id === id))
          .findLast(task => task?.status === 'completed' && task.workspace);
        return this.executeTask(
          run,
          task,
          ctx,
          applyUpstream(task.task, task.needs, outputs),
          base?.workspace?.branch,
        );
      },
    );
    for (const skipped of result.skipped) {
      const task = run.snapshot.tasks.find(task => task.id === skipped.id);
      if (!task) continue;
      task.status = 'skipped';
      task.endedAt = Date.now();
      task.error = `Prerequisite did not complete: ${skipped.needs.join(', ')}`;
      if (input.notifyPerTask) this.notifyParent(run.snapshot, task);
    }
    this.settle(run);
  }

  private settle(run: Run): void {
    run.snapshot.status = run.snapshot.tasks.some(
      task => task.status === 'failed',
    )
      ? 'failed'
      : run.snapshot.tasks.some(task => task.status === 'stopped')
        ? 'stopped'
        : 'completed';
  }

  private async executeTask(
    run: Run,
    task: TaskSnapshot,
    ctx: ExtensionContext,
    message: string,
    baseBranch?: string,
    sessionManager?: SessionManager,
  ) {
    const configuration = run.configurations.get(task.id);
    const controller = run.controllers.get(task.id);
    if (!configuration || !controller)
      throw new SubagentError({
        message: `Missing execution configuration: ${task.id}`,
      });
    try {
      return await executeRequest({
        task,
        configuration,
        parent: ctx,
        signal: controller.signal,
        runId: run.snapshot.id,
        message,
        baseBranch,
        sessionManager,
        tools: run.communication.tools(task.id),
        ready: session => {
          run.children.set(task.id, session);
        },
      });
    } finally {
      run.children.delete(task.id);
      if (run.notifyPerTask) this.notifyParent(run.snapshot, task);
    }
  }

  private savedSession(task: TaskSnapshot) {
    if (!task.sessionFile || !task.sessionId)
      throw new SubagentError({
        message: 'This child has no saved session to continue.',
      });
    return Effect.runPromise(
      openSavedSession(
        task.sessionFile,
        task.workspace?.cwd ?? task.cwd,
        task.sessionId,
      ),
    );
  }

  async continueTask(
    input: ContinuationInput,
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ): Promise<RunSnapshot> {
    const run = this.get(input.runId);
    const task = run.snapshot.tasks.find(task => task.id === input.taskId);
    if (!task)
      throw new SubagentError({message: `Unknown task: ${input.taskId}`});
    if (
      run.snapshot.status === 'running' ||
      run.continuing ||
      run.children.size
    )
      throw new SubagentError({
        message: 'Wait for the run to settle before continuing a child.',
      });
    const eligible =
      input.command === 'follow-up'
        ? task.status === 'completed'
        : task.status === 'failed' || task.status === 'stopped';
    if (!eligible)
      throw new SubagentError({
        message: `${input.command} is not available for a ${task.status} child.`,
      });
    if (input.command === 'follow-up' && !input.message)
      throw new SubagentError({message: 'Follow-up needs a message.'});
    const message =
      input.message ??
      `Your previous request ended with ${task.status}: ${task.error ?? 'execution interrupted'}. Briefly recap your progress, then continue where you left off and finish the remaining work.`;
    const prepared = run.configurations.get(task.id);
    if (!prepared)
      throw new SubagentError({
        message: 'The saved child configuration is unavailable.',
      });
    const generation = this.generation;
    run.continuing = true;
    try {
      signal?.throwIfAborted();
      const sessionManager = await this.savedSession(task);
      const model = selectModel(
        ctx,
        input.model ??
          (task.provider && task.model
            ? `${task.provider}/${task.model}`
            : undefined),
      );
      const thinking = input.thinking ?? task.thinking;
      validateThinking(model, thinking);
      let workspace = task.workspace;
      if (task.write) {
        if (!workspace)
          throw new SubagentError({
            message: 'The writer has no saved workspace to continue.',
          });
        workspace = await Effect.runPromise(attachWorkspace(workspace));
      }
      signal?.throwIfAborted();
      if (generation !== this.generation)
        throw new SubagentError({
          message: 'The parent session changed during continuation.',
        });
      const {history, cumulativeUsage, ...previous} = task;
      const next: TaskSnapshot = {
        ...previous,
        requestId: randomUUID(),
        task: message,
        status: 'queued',
        finalText: '',
        pendingInstructions: [],
        configurationNotes: [],
        history: [...history, structuredClone(previous)],
        maxRuntimeMs: input.maxRuntimeMs ?? task.maxRuntimeMs,
      };
      for (const key of [
        'error',
        'startedAt',
        'endedAt',
        'question',
        'git',
        'preservationError',
        'cleanupError',
        'notificationError',
        'finalizing',
        'usage',
        'startEntryId',
        'endEntryId',
      ] as const)
        delete next[key];
      if (workspace) next.workspace = workspace;
      if (cumulativeUsage) next.cumulativeUsage = cumulativeUsage;
      run.snapshot.tasks[run.snapshot.tasks.indexOf(task)] = next;
      run.controllers.set(task.id, new AbortController());
      run.configurations.set(task.id, {
        ...prepared,
        model,
        thinking,
        notes: [],
      });
      run.snapshot.status = 'running';
      run.completion = this.executeTask(
        run,
        next,
        ctx,
        message,
        undefined,
        sessionManager,
      )
        .then(() => undefined)
        .finally(() => this.settle(run));
      return run.snapshot;
    } finally {
      run.continuing = false;
    }
  }

  private get(runId: string): Run {
    const run = this.runs.get(runId);
    if (!run) throw new SubagentError({message: `Unknown run: ${runId}`});
    return run;
  }

  result(runId: string, taskId?: string): RunSnapshot | TaskSnapshot {
    const run = this.get(runId).snapshot;
    if (taskId === undefined) return run;
    const task = run.tasks.find(task => task.id === taskId);
    if (!task) throw new SubagentError({message: `Unknown task: ${taskId}`});
    return task;
  }

  async wait(runId: string, timeoutMs?: number): Promise<RunSnapshot> {
    const run = this.get(runId);
    if (run.snapshot.tasks.some(task => task.question !== undefined))
      return run.snapshot;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = Promise.withResolvers<void>();
    run.waiters.add(wake.resolve);
    try {
      if (timeoutMs !== undefined) timer = setTimeout(wake.resolve, timeoutMs);
      await Promise.race([run.completion, wake.promise]);
    } finally {
      clearTimeout(timer);
      run.waiters.delete(wake.resolve);
    }
    return run.snapshot;
  }

  reply(
    runId: string,
    taskId: string,
    questionId: string,
    message: string,
  ): RunSnapshot {
    const run = this.get(runId);
    if (run.controllers.get(taskId)?.signal.aborted)
      throw new SubagentError({message: 'This child is stopping.'});
    run.communication.reply(taskId, questionId, message);
    return run.snapshot;
  }

  async steer(
    runId: string,
    taskId: string | undefined,
    message: string,
  ): Promise<RunSnapshot> {
    const run = this.get(runId);
    const targets = run.snapshot.tasks.filter(
      task => taskId === undefined || task.id === taskId,
    );
    const live = targets.filter(
      task =>
        run.children.get(task.id)?.isStreaming &&
        !run.controllers.get(task.id)?.signal.aborted,
    );
    if (live.length === 0)
      throw new SubagentError({
        message: 'No live child can accept this instruction.',
      });
    for (const task of live) {
      const child = run.children.get(task.id);
      if (!child || !child.isStreaming)
        throw new SubagentError({
          message: `${task.agent} is no longer executing.`,
        });
      task.pendingInstructions.push(message);
      try {
        await child.prompt(message, {
          source: 'extension',
          expandPromptTemplates: false,
          streamingBehavior: 'steer',
        });
      } catch (error) {
        const index = task.pendingInstructions.lastIndexOf(message);
        if (index !== -1) task.pendingInstructions.splice(index, 1);
        throw error;
      }
    }
    return run.snapshot;
  }

  cancel(runId: string, taskId?: string): RunSnapshot {
    const run = this.get(runId);
    this.result(runId, taskId);
    for (const [id, controller] of run.controllers) {
      if (taskId === undefined || id === taskId) {
        const task = run.snapshot.tasks.find(task => task.id === id);
        if (
          task &&
          ['queued', 'starting', 'running', 'awaiting_parent'].includes(
            task.status,
          )
        ) {
          task.status = 'stopping';
          controller.abort();
        }
      }
    }
    return run.snapshot;
  }

  async close(): Promise<void> {
    this.generation++;
    for (const run of this.runs.values()) {
      for (const controller of run.controllers.values()) controller.abort();
    }
    await Promise.all([...this.runs.values()].map(run => run.completion));
    this.runs.clear();
  }
}
