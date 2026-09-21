import {Effect, Schema} from 'effect';

export type RunMode = 'single' | 'parallel' | 'chain';

export interface GraphTaskInput {
  readonly id?: string;
  readonly needs?: readonly string[];
}

export class GraphValidationError extends Schema.TaggedError<GraphValidationError>()(
  'GraphValidationError',
  {
    kind: Schema.Literals([
      'duplicate-id',
      'unknown-dependency',
      'self-dependency',
      'cycle',
    ]),
    taskId: Schema.String,
    dependencyId: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

interface GraphNode {
  readonly id: string;
  readonly needs: string[];
}

function graphError(
  kind: GraphValidationError['kind'],
  taskId: string,
  message: string,
  dependencyId?: string,
): GraphValidationError {
  if (dependencyId === undefined) {
    return new GraphValidationError({kind, taskId, message});
  }
  return new GraphValidationError({kind, taskId, dependencyId, message});
}

function uniqueDependencies(
  taskId: string,
  requested: readonly string[],
  known: ReadonlySet<string>,
): string[] {
  const dependencies: string[] = [];
  for (const dependency of requested) {
    if (!known.has(dependency)) {
      throw graphError(
        'unknown-dependency',
        taskId,
        `Task ${taskId} needs unknown task id: ${dependency}`,
        dependency,
      );
    }
    if (dependency === taskId) {
      throw graphError(
        'self-dependency',
        taskId,
        `Task ${taskId} cannot need itself.`,
        dependency,
      );
    }
    if (!dependencies.includes(dependency)) dependencies.push(dependency);
  }
  return dependencies;
}

function validateAcyclic(nodes: readonly GraphNode[]): void {
  const pending = new Set(nodes.map(node => node.id));
  let previousSize = -1;
  while (pending.size !== previousSize) {
    previousSize = pending.size;
    for (const node of nodes) {
      if (
        pending.has(node.id) &&
        node.needs.every(dependency => !pending.has(dependency))
      ) {
        pending.delete(node.id);
      }
    }
  }
  if (pending.size > 0) {
    const cycle = [...pending];
    throw graphError(
      'cycle',
      cycle.join(', '),
      `Cycle in subagent needs: ${cycle.join(', ')}`,
    );
  }
}

function buildGraph(
  inputs: readonly GraphTaskInput[],
  mode: RunMode,
  external: ReadonlySet<string> = new Set(),
): GraphNode[] {
  const pending = inputs.map((input, index) => ({
    id: input.id ?? `task_${index + 1}`,
    input,
  }));
  const seen = new Map<string, number>();
  for (const [index, node] of pending.entries()) {
    if (seen.has(node.id)) {
      throw graphError(
        'duplicate-id',
        node.id,
        `Duplicate task id: ${node.id}`,
      );
    }
    seen.set(node.id, index);
  }

  const known = new Set(pending.map(node => node.id));
  for (const id of external) known.add(id);
  const nodes = pending.map(({id, input}) => ({
    id,
    needs: uniqueDependencies(
      id,
      mode === 'chain' ? [] : (input.needs ?? []),
      known,
    ),
  }));
  if (mode === 'chain') {
    for (const [index, node] of nodes.entries()) {
      node.needs.length = 0;
      if (index > 0) {
        const previous = nodes[index - 1];
        if (previous) node.needs.push(previous.id);
      }
    }
  }
  validateAcyclic(nodes);
  return nodes;
}

export function resolveNeeds(
  inputs: readonly GraphTaskInput[],
  mode: RunMode,
): string[][] {
  return buildGraph(inputs, mode).map(node => [...node.needs]);
}

export function applyUpstream(
  task: string,
  needs: readonly string[],
  outputs: ReadonlyMap<string, string>,
): string {
  if (needs.length === 0) {
    return task.includes('{previous}')
      ? `${task.replace(/\{previous\}/g, () => '')}\n\n(Note: {previous} was empty — no prior step output existed yet.)`
      : task;
  }
  const first = outputs.get(needs[0] ?? '') ?? '';
  const body = task.replace(/\{previous\}/g, () => first);
  const blocks = needs.map(
    need => `## Output of ${need}\n${outputs.get(need) ?? '(no output)'}`,
  );
  return `${blocks.join('\n\n')}\n\n---\n\n${body}`;
}

export interface SchedulerTask {
  readonly id: string;
  readonly needs?: readonly string[];
}

export class SchedulerTaskFailure extends Schema.TaggedError<SchedulerTaskFailure>()(
  'SchedulerTaskFailure',
  {
    taskId: Schema.String,
    message: Schema.String,
  },
) {}

export type SchedulerTaskOutcome =
  | {
      readonly status: 'completed';
      readonly output: string;
    }
  | {
      readonly status: 'failed' | 'stopped';
      readonly output?: string;
      readonly failure: SchedulerTaskFailure;
    };

export type SchedulerTaskResult = SchedulerTaskOutcome & {readonly id: string};

export interface SkippedTask {
  readonly id: string;
  readonly needs: readonly string[];
}

export interface SchedulerResult {
  readonly outcomes: readonly SchedulerTaskResult[];
  readonly skipped: readonly SkippedTask[];
}

interface IndexedTask<T extends SchedulerTask> {
  readonly task: T;
  readonly index: number;
}

interface IndexedOutcome {
  readonly index: number;
  readonly outcome: SchedulerTaskOutcome;
}

function concurrencyLimit(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.max(1, Math.floor(value));
}

function runWave<T extends SchedulerTask>(
  wave: readonly IndexedTask<T>[],
  limit: number,
  run: (task: T, index: number) => Promise<SchedulerTaskOutcome>,
): Effect.Effect<readonly IndexedOutcome[]> {
  return Effect.forEach(
    wave,
    item =>
      Effect.tryPromise({
        try: () => run(item.task, item.index),
        catch: error =>
          error instanceof SchedulerTaskFailure
            ? error
            : new SchedulerTaskFailure({
                taskId: item.task.id,
                message:
                  error instanceof Error
                    ? error.message
                    : 'Task runner failed.',
              }),
      }).pipe(
        Effect.match({
          onFailure: failure => ({
            index: item.index,
            outcome: {
              status: 'failed' as const,
              failure,
            },
          }),
          onSuccess: outcome => ({index: item.index, outcome}),
        }),
      ),
    {concurrency: limit},
  );
}

function schedule<T extends SchedulerTask>(
  tasks: readonly T[],
  needsById: ReadonlyMap<string, readonly string[]>,
  limit: number,
  outputs: Map<string, string>,
  settled: Set<string>,
  run: (task: T, index: number) => Promise<SchedulerTaskOutcome>,
): Effect.Effect<SchedulerResult> {
  return Effect.gen(function* () {
    const outcomes: SchedulerTaskResult[] = [];
    const skipped: SkippedTask[] = [];
    const pending = new Set<number>();
    for (const [index, task] of tasks.entries()) {
      if (!settled.has(task.id)) pending.add(index);
    }

    while (pending.size > 0) {
      const ready: IndexedTask<T>[] = [];
      for (const index of pending) {
        const task = tasks[index];
        if (!task) continue;
        const dependencies = needsById.get(task.id) ?? [];
        if (dependencies.every(dependency => settled.has(dependency))) {
          ready.push({task, index});
        }
      }

      if (ready.length === 0) {
        const unresolved = [...pending]
          .map(index => tasks[index]?.id)
          .filter((id): id is string => id !== undefined)
          .join(', ');
        throw graphError(
          'cycle',
          unresolved,
          `No runnable wave remains for tasks: ${unresolved}`,
        );
      }

      const runnable: IndexedTask<T>[] = [];
      for (const item of ready) {
        const dependencies = needsById.get(item.task.id) ?? [];
        const broken = dependencies.filter(
          dependency => !outputs.has(dependency),
        );
        if (broken.length > 0) {
          skipped.push({id: item.task.id, needs: broken});
          pending.delete(item.index);
          settled.add(item.task.id);
          continue;
        }
        runnable.push(item);
      }

      const waveOutcomes = yield* runWave(runnable, limit, run);
      for (const item of waveOutcomes) {
        const task = tasks[item.index];
        if (!task) continue;
        outcomes.push({id: task.id, ...item.outcome});
        if (item.outcome.status === 'completed') {
          outputs.set(task.id, item.outcome.output);
        }
        pending.delete(item.index);
        settled.add(task.id);
      }
    }

    return {
      outcomes,
      skipped,
    };
  });
}

export async function runWaveScheduler<T extends SchedulerTask>(
  tasks: readonly T[],
  concurrency: number,
  outputs: Map<string, string>,
  settled: Set<string>,
  run: (task: T, index: number) => Promise<SchedulerTaskOutcome>,
): Promise<SchedulerResult> {
  const external = new Set([...settled, ...outputs.keys()]);
  const nodes = buildGraph(tasks, 'parallel', external);
  const needsById = new Map(nodes.map(node => [node.id, node.needs] as const));
  return Effect.runPromise(
    schedule(
      tasks,
      needsById,
      concurrencyLimit(concurrency),
      outputs,
      settled,
      run,
    ),
  );
}
