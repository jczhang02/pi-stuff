import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {dirname} from 'node:path';
import {Effect, Schema} from 'effect';
import type {RunSnapshot, TaskSnapshot} from './types';

class RunStoreError extends Schema.TaggedError<RunStoreError>()(
  'RunStoreError',
  {message: Schema.String},
) {}

const Usage = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  cost: Schema.Number,
  turns: Schema.Number,
});
const Task = Schema.Struct({
  id: Schema.String,
  runId: Schema.String,
  agent: Schema.String,
  task: Schema.String,
  cwd: Schema.String,
  status: Schema.Literals([
    'queued',
    'starting',
    'running',
    'awaiting_parent',
    'completed',
    'failed',
    'aborted',
  ]),
  needs: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  sessionId: Schema.optional(Schema.String),
  sessionFile: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.Number),
  endedAt: Schema.optional(Schema.Number),
  toolCalls: Schema.Number,
  lastActivity: Schema.optional(Schema.String),
  finalText: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.String),
  tools: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  usage: Usage,
  roster: Schema.optional(Schema.String),
  agentFile: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  isolation: Schema.optional(Schema.Literal('worktree')),
  prompt: Schema.optional(Schema.String),
  maxRuntimeMs: Schema.optional(Schema.Number),
  write: Schema.optional(Schema.Boolean),
  originCwd: Schema.optional(Schema.String),
  elapsedMs: Schema.optional(Schema.Number),
});
const Run = Schema.Struct({
  id: Schema.String,
  mode: Schema.Literals(['single', 'parallel', 'chain']),
  status: Schema.Literals([
    'queued',
    'running',
    'awaiting_parent',
    'completed',
    'failed',
    'aborted',
  ]),
  notifyPerTask: Schema.Boolean,
  createdAt: Schema.Number,
  startedAt: Schema.optional(Schema.Number),
  endedAt: Schema.optional(Schema.Number),
  concurrency: Schema.Number,
  tasks: Schema.mutable(Schema.Array(Task)),
  aggregateUsage: Usage,
});
const Runs = Schema.mutable(Schema.Array(Run));
type StoredRun = Schema.Schema.Type<typeof Run>;

function decodeRuns(text: string): Effect.Effect<StoredRun[], RunStoreError> {
  return Schema.decodeUnknownEffect(Schema.fromJsonString(Runs), {
    onExcessProperty: 'error',
  })(text).pipe(
    Effect.mapError(
      () =>
        new RunStoreError({
          message: 'Subagent sidecar is malformed JSON.',
        }),
    ),
  );
}

function isMissingFile(error: Error): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function validateRuns(runs: readonly StoredRun[]): void {
  if (runs.length > 50)
    throw new RunStoreError({message: 'Subagent sidecar has too many runs.'});
  const ids = new Set<string>();
  for (const run of runs) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(run.id) || ids.has(run.id))
      throw new RunStoreError({
        message: 'Subagent sidecar contains an unsafe or duplicate run id.',
      });
    ids.add(run.id);
    if (
      run.tasks.length === 0 ||
      run.tasks.length > 16 ||
      !Number.isInteger(run.concurrency) ||
      run.concurrency < 1 ||
      run.concurrency > 8
    )
      throw new RunStoreError({
        message:
          'Subagent sidecar contains invalid task or concurrency limits.',
      });
    const runTimings = [run.createdAt, run.startedAt, run.endedAt];
    if (
      runTimings.some(
        value => value !== undefined && (!Number.isFinite(value) || value < 0),
      )
    )
      throw new RunStoreError({
        message: 'Subagent sidecar contains invalid run timing.',
      });
    const taskIds = new Set<string>();
    for (const task of run.tasks) {
      if (
        !/^[A-Za-z0-9_-]{1,64}$/.test(task.id) ||
        taskIds.has(task.id) ||
        task.runId !== run.id
      )
        throw new RunStoreError({
          message: 'Subagent sidecar contains an unsafe task identity.',
        });
      taskIds.add(task.id);
      if (!Number.isFinite(task.toolCalls) || task.toolCalls < 0)
        throw new RunStoreError({
          message: 'Subagent sidecar contains invalid task statistics.',
        });
      const taskTimings = [task.startedAt, task.endedAt, task.elapsedMs];
      if (
        taskTimings.some(
          value =>
            value !== undefined && (!Number.isFinite(value) || value < 0),
        )
      )
        throw new RunStoreError({
          message: 'Subagent sidecar contains invalid task timing.',
        });
      if (
        task.maxRuntimeMs !== undefined &&
        (!Number.isFinite(task.maxRuntimeMs) ||
          task.maxRuntimeMs <= 0 ||
          task.maxRuntimeMs > 21_600_000)
      )
        throw new RunStoreError({
          message: 'Subagent sidecar contains invalid runtime limit.',
        });
      for (const value of Object.values(task.usage))
        if (!Number.isFinite(value) || value < 0)
          throw new RunStoreError({
            message: 'Subagent sidecar contains invalid usage statistics.',
          });
    }
    for (const value of Object.values(run.aggregateUsage))
      if (!Number.isFinite(value) || value < 0)
        throw new RunStoreError({
          message: 'Subagent sidecar contains invalid aggregate statistics.',
        });
  }
}

function normalize(runs: readonly StoredRun[]): RunSnapshot[] {
  const now = Date.now();
  return runs.map(run => {
    const interrupted = run.tasks.some(
      task => !['completed', 'failed', 'aborted'].includes(task.status),
    );
    const tasks: TaskSnapshot[] = run.tasks.map(task =>
      ['completed', 'failed', 'aborted'].includes(task.status)
        ? task
        : {
            ...task,
            status: 'aborted',
            endedAt: now,
            error: task.error ?? 'Interrupted by session reload.',
          },
    );
    const allTerminal = tasks.every(task =>
      ['completed', 'failed', 'aborted'].includes(task.status),
    );
    const status = interrupted
      ? 'aborted'
      : allTerminal
        ? tasks.some(task => task.status === 'failed')
          ? 'failed'
          : tasks.some(task => task.status === 'aborted')
            ? 'aborted'
            : 'completed'
        : run.status;
    return {
      ...run,
      tasks,
      status,
      endedAt: interrupted ? now : (run.endedAt ?? now),
    };
  });
}

export class RunStore {
  private readonly path: string | undefined;
  private readonly tempPath: string | undefined;
  private pending: Promise<void> = Promise.resolve();
  private writable = true;

  constructor(
    parentFile: string | undefined,
    private readonly report: (message: string) => void,
  ) {
    this.path = parentFile
      ? `${parentFile}.pi-stuff-subagents.json`
      : undefined;
    this.tempPath = this.path
      ? `${this.path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
      : undefined;
  }

  async load(): Promise<RunSnapshot[]> {
    if (!this.path) return [];
    const path = this.path;
    const result = await Effect.runPromise(
      Effect.tryPromise({
        try: async () => {
          return await readFile(path, 'utf8');
        },
        catch: error =>
          new RunStoreError({
            message: isMissingFile(error instanceof Error ? error : new Error())
              ? 'ENOENT'
              : 'Could not read subagent sidecar.',
          }),
      }).pipe(
        Effect.flatMap(decodeRuns),
        Effect.flatMap(runs =>
          Effect.try({
            try: () => {
              validateRuns(runs);
              return runs;
            },
            catch: error =>
              error instanceof RunStoreError
                ? error
                : new RunStoreError({
                    message: 'Subagent sidecar validation failed.',
                  }),
          }),
        ),
        Effect.map(normalize),
      ),
    ).catch(error => {
      if (!(error instanceof RunStoreError && error.message === 'ENOENT')) {
        this.writable = false;
        this.report(
          error instanceof RunStoreError
            ? error.message
            : 'Could not read subagent sidecar.',
        );
      }
      return [];
    });
    return result;
  }

  save(runs: readonly RunSnapshot[]): void {
    if (!this.path || !this.tempPath) return;
    // A damaged sidecar is recovery data, not an empty store to overwrite.
    if (!this.writable) return;
    const path = this.path;
    const tempPath = this.tempPath;
    const snapshot = structuredClone(runs);
    const payload = JSON.stringify(snapshot, null, 2);
    this.pending = this.pending
      .catch(() => undefined)
      .then(async () => {
        await Effect.runPromise(
          Effect.tryPromise({
            try: async () => {
              await mkdir(dirname(path), {recursive: true});
              await writeFile(tempPath, payload, {mode: 0o600});
              await chmod(tempPath, 0o600);
              await rename(tempPath, path);
            },
            catch: () =>
              new RunStoreError({message: 'Could not save subagent sidecar.'}),
          }),
        );
      })
      .catch(async error => {
        this.report(
          error instanceof RunStoreError
            ? error.message
            : 'Could not save subagent sidecar.',
        );
        await unlink(tempPath)
          .catch(() => undefined)
          .then(() => undefined);
        throw error;
      });
    void this.pending.catch(() => undefined);
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  assertWritable(): void {
    if (!this.writable)
      throw new RunStoreError({
        message:
          'Subagent history could not be loaded. Repair or move the reported sidecar, then reload before starting new tasks. Its contents have been preserved.',
      });
  }
}
