import type {
  AgentSession,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {randomUUID} from 'node:crypto';
import {Effect} from 'effect';
import {applyUpstream, runWaveScheduler, SchedulerTaskFailure} from './graph';
import {investigate, SubagentError} from './session';
import type {Dispatch, TaskInput} from './protocol';
import {Communication, type Question} from './communication';
import {
  prepareWorkspace,
  saveWorkspace,
  releaseWorkspace,
  type Workspace,
  type WorkspaceSaveResult,
} from './workspace';

export interface TaskSnapshot extends TaskInput {
  status:
    | 'queued'
    | 'starting'
    | 'running'
    | 'awaiting_parent'
    | 'stopping'
    | 'completed'
    | 'failed'
    | 'stopped'
    | 'skipped';
  finalText: string;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  sessionId?: string;
  sessionFile?: string;
  question?: Question;
  pendingInstructions: string[];
  workspace?: Workspace;
  git?: WorkspaceSaveResult;
  preservationError?: string;
  cleanupError?: string;
  finalizing?: boolean;
}

export interface RunSnapshot {
  id: string;
  mode: Dispatch['mode'];
  status: 'running' | 'completed' | 'failed' | 'stopped';
  tasks: TaskSnapshot[];
  intercom: {
    taskId: string;
    text: string;
    level: 'info' | 'warning' | 'error';
  }[];
}

interface Run {
  snapshot: RunSnapshot;
  controllers: Map<string, AbortController>;
  completion: Promise<void>;
  communication: Communication;
  children: Map<string, AgentSession>;
  waiters: Set<() => void>;
}

export class Runs {
  private readonly runs = new Map<string, Run>();

  constructor(
    private readonly notify: (
      run: RunSnapshot,
      task: TaskSnapshot,
      message?: string,
    ) => void,
  ) {}

  dispatch(input: Dispatch, ctx: ExtensionContext): RunSnapshot {
    const snapshot: RunSnapshot = {
      id: randomUUID(),
      mode: input.mode,
      status: 'running',
      intercom: [],
      tasks: input.tasks.map(task => ({
        ...task,
        status: 'queued',
        finalText: '',
        pendingInstructions: [],
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
          if (waiters.size === 0) this.notify(snapshot, task);
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
          this.notify(snapshot, task, `${level}: ${text}`);
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
        const controller = run.controllers.get(task.id);
        let unsubscribe: (() => void) | undefined;
        let outcome: 'completed' | 'failed' | 'stopped' = 'completed';
        try {
          controller?.signal.throwIfAborted();
          task.status = 'starting';
          task.startedAt = Date.now();
          if (task.write) {
            const base = task.needs
              .map(id => run.snapshot.tasks.find(task => task.id === id))
              .findLast(task => task?.status === 'completed' && task.workspace);
            task.workspace = await Effect.runPromise(
              prepareWorkspace(
                task.cwd,
                run.snapshot.id,
                task.id,
                base?.workspace?.branch,
              ),
            );
          }
          const result = await Effect.runPromise(
            investigate(
              {
                ...task,
                cwd: task.workspace?.cwd ?? task.cwd,
                task: applyUpstream(task.task, task.needs, outputs),
              },
              ctx,
              controller?.signal,
              run.communication.tools(task.id),
              session => {
                run.children.set(task.id, session);
                task.status = 'running';
                task.sessionId = session.sessionId;
                if (session.sessionFile) task.sessionFile = session.sessionFile;
                task.tools = session.getActiveToolNames();
                unsubscribe = session.subscribe(event => {
                  if (
                    (event.type === 'message_update' ||
                      event.type === 'message_end') &&
                    event.message.role === 'assistant'
                  ) {
                    const text = event.message.content
                      .filter(part => part.type === 'text')
                      .map(part => part.text)
                      .join('\n');
                    if (text) task.finalText = text;
                  }
                  if (
                    event.type === 'message_start' &&
                    event.message.role === 'user'
                  ) {
                    const content = event.message.content;
                    const text = Array.isArray(content)
                      ? content
                          .filter(part => part.type === 'text')
                          .map(part => part.text)
                          .join('\n')
                      : content;
                    const index = task.pendingInstructions.indexOf(text);
                    if (index !== -1) task.pendingInstructions.splice(index, 1);
                  }
                });
              },
            ),
          );
          task.finalText = result.finalText;
          task.startedAt = result.startedAt;
          task.sessionId = result.sessionId;
          if (result.sessionFile !== undefined)
            task.sessionFile = result.sessionFile;
          task.tools = result.tools;
        } catch (error) {
          outcome = controller?.signal.aborted ? 'stopped' : 'failed';
          task.error = error instanceof Error ? error.message : String(error);
        } finally {
          unsubscribe?.();
          run.children.delete(task.id);
          if (task.workspace) {
            task.finalizing = true;
            if (controller?.signal.aborted) task.status = 'stopping';
            try {
              task.git = await Effect.runPromise(
                saveWorkspace(task.workspace, `subagent: ${task.agent}`),
              );
              try {
                await Effect.runPromise(releaseWorkspace(task.workspace));
              } catch (error) {
                task.cleanupError =
                  error instanceof Error ? error.message : String(error);
              }
            } catch (error) {
              task.preservationError =
                error instanceof Error ? error.message : String(error);
            } finally {
              task.finalizing = false;
            }
          }
          if (controller?.signal.aborted) outcome = 'stopped';
          task.status = outcome;
          task.endedAt = Date.now();
          if (input.notifyPerTask) this.notify(run.snapshot, task);
        }
        return outcome === 'completed'
          ? {status: outcome, output: task.finalText}
          : {
              status: outcome,
              output: task.finalText,
              failure: new SchedulerTaskFailure({
                taskId: task.id,
                message: task.error ?? 'The task was stopped.',
              }),
            };
      },
    );
    for (const skipped of result.skipped) {
      const task = run.snapshot.tasks.find(task => task.id === skipped.id);
      if (!task) continue;
      task.status = 'skipped';
      task.error = `Prerequisite did not complete: ${skipped.needs.join(', ')}`;
      if (input.notifyPerTask) this.notify(run.snapshot, task);
    }
    run.snapshot.status = run.snapshot.tasks.some(
      task => task.status === 'failed',
    )
      ? 'failed'
      : run.snapshot.tasks.some(task => task.status === 'stopped')
        ? 'stopped'
        : 'completed';
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
        run.children.has(task.id) &&
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
    for (const run of this.runs.values()) {
      for (const controller of run.controllers.values()) controller.abort();
    }
    await Promise.all([...this.runs.values()].map(run => run.completion));
    this.runs.clear();
  }
}
