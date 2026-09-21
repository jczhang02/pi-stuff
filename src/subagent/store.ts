import {randomUUID} from 'node:crypto';
import {open, readFile, rename, rm} from 'node:fs/promises';
import {Effect, Schema} from 'effect';
import {RunSnapshot} from './records';
import {resolveNeeds} from './graph';

const Archive = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    runs: Schema.Array(RunSnapshot),
  }),
);

export class StoreError extends Schema.TaggedError<StoreError>()('StoreError', {
  message: Schema.String,
}) {}

export function loadRuns(
  parentFile: string,
): Effect.Effect<RunSnapshot[], StoreError> {
  const path = `${parentFile}.pi-stuff-subagents.json`;
  return Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      async try() {
        try {
          return await readFile(path, 'utf8');
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          )
            return undefined;
          throw error;
        }
      },
      catch: error =>
        new StoreError({
          message: `Could not read subagent records ${path}: ${String(error)}`,
        }),
    });
    if (text === undefined) return [];
    const archive = yield* Schema.decodeUnknownEffect(Archive)(text).pipe(
      Effect.mapError(
        error =>
          new StoreError({
            message: `Invalid subagent records ${path}: ${String(error)}`,
          }),
      ),
    );
    yield* Effect.try({
      try() {
        const runIds = new Set<string>();
        const requestIds = new Set<string>();
        for (const run of archive.runs) {
          if (runIds.has(run.id)) throw new Error(`Duplicate run: ${run.id}`);
          runIds.add(run.id);
          resolveNeeds(run.tasks, 'parallel');
          for (const task of run.tasks) {
            for (const request of [...task.history, task]) {
              if (
                !request.write &&
                request.tools.some(tool =>
                  ['bash', 'edit', 'write'].includes(tool),
                )
              )
                throw new Error(
                  `Read-only request has write tools: ${request.requestId}`,
                );
              if (
                request.workspace &&
                (!request.write ||
                  request.workspace.branch !== `subagents/${run.id}/${task.id}`)
              )
                throw new Error(
                  `Request has another task's workspace: ${request.requestId}`,
                );
              if (requestIds.has(request.requestId))
                throw new Error(`Duplicate request: ${request.requestId}`);
              requestIds.add(request.requestId);
            }
          }
        }
      },
      catch: error =>
        new StoreError({
          message: `Invalid subagent records ${path}: ${String(error)}`,
        }),
    });
    return [...archive.runs];
  });
}

// Lifecycle ownership serializes calls. Only this write's temporary file is
// removed on failure; older sidecars and other writers' files are untouched.
export function saveRuns(
  parentFile: string,
  runs: readonly RunSnapshot[],
): Effect.Effect<void, StoreError> {
  const path = `${parentFile}.pi-stuff-subagents.json`;
  return Effect.gen(function* () {
    const text = yield* Schema.encodeEffect(Archive)({version: 1, runs}).pipe(
      Effect.mapError(
        error =>
          new StoreError({
            message: `Could not encode subagent records ${path}: ${String(error)}`,
          }),
      ),
    );
    yield* Effect.tryPromise({
      async try() {
        const temporary = `${path}.${randomUUID()}.tmp`;
        const file = await open(temporary, 'wx', 0o600);
        try {
          try {
            await file.writeFile(text);
          } finally {
            await file.close();
          }
          await rename(temporary, path);
        } catch (error) {
          await rm(temporary, {force: true});
          throw error;
        }
      },
      catch: error =>
        new StoreError({
          message: `Could not save subagent records ${path}: ${String(error)}`,
        }),
    });
  });
}
