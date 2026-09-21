import type {ExtensionContext} from '@earendil-works/pi-coding-agent';
import {randomUUID} from 'node:crypto';
import {Effect} from 'effect';
import {applyUpstream, runWaveScheduler, SchedulerTaskFailure} from './graph';
import {investigate, SubagentError} from './session';
import type {Dispatch, TaskInput} from './protocol';

export interface TaskSnapshot extends TaskInput {
  status:
    | 'queued'
    | 'starting'
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
  tools?: string[];
}

export interface RunSnapshot {
  id: string;
  mode: Dispatch['mode'];
  status: 'running' | 'completed' | 'failed' | 'stopped';
  tasks: TaskSnapshot[];
}

interface Run {
  snapshot: RunSnapshot;
  controllers: Map<string, AbortController>;
  completion: Promise<void>;
}

export class Runs {
  private readonly runs = new Map<string, Run>();

  constructor(
    private readonly notify: (run: RunSnapshot, task: TaskSnapshot) => void,
  ) {}

  dispatch(input: Dispatch, ctx: ExtensionContext): RunSnapshot {
    const snapshot: RunSnapshot = {
      id: randomUUID(),
      mode: input.mode,
      status: 'running',
      tasks: input.tasks.map(task => ({
        ...task,
        status: 'queued',
        finalText: '',
      })),
    };
    const run: Run = {
      snapshot,
      controllers: new Map(
        input.tasks.map(task => [task.id, new AbortController()]),
      ),
      completion: Promise.resolve(),
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
        try {
          controller?.signal.throwIfAborted();
          task.status = 'starting';
          task.startedAt = Date.now();
          const result = await Effect.runPromise(
            investigate(
              {...task, task: applyUpstream(task.task, task.needs, outputs)},
              ctx,
              controller?.signal,
            ),
          );
          task.status = result.status;
          task.finalText = result.finalText;
          task.startedAt = result.startedAt;
          task.sessionId = result.sessionId;
          if (result.sessionFile !== undefined)
            task.sessionFile = result.sessionFile;
          task.tools = result.tools;
          return {status: 'completed' as const, output: result.finalText};
        } catch (error) {
          task.status = controller?.signal.aborted ? 'stopped' : 'failed';
          task.error = error instanceof Error ? error.message : String(error);
          return {
            status: task.status,
            output: task.finalText,
            failure: new SchedulerTaskFailure({
              taskId: task.id,
              message: task.error,
            }),
          };
        } finally {
          task.endedAt = Date.now();
          if (input.notifyPerTask) this.notify(run.snapshot, task);
        }
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
    if (timeoutMs === undefined) await run.completion;
    else {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          run.completion,
          new Promise<void>(resolve => {
            timer = setTimeout(resolve, timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    return run.snapshot;
  }

  cancel(runId: string, taskId?: string): RunSnapshot {
    const run = this.get(runId);
    this.result(runId, taskId);
    for (const [id, controller] of run.controllers) {
      if (taskId === undefined || id === taskId) controller.abort();
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
