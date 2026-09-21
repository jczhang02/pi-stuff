import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Effect, Schema} from 'effect';

const SETTINGS_FILE = 'subagents-config.json';
const SettingsJson = Schema.fromJsonString(Schema.JsonObject, {space: 2});
const AutoLimit = Schema.optional(Schema.Boolean);

export class SettingsError extends Schema.TaggedError<SettingsError>()(
  'SettingsError',
  {
    kind: Schema.Literals(['io', 'parse']),
    message: Schema.String,
  },
) {}

type JsonSettings = typeof SettingsJson.Type;

function loadSettings(
  agentDir: string,
): Effect.Effect<JsonSettings, SettingsError> {
  const path = join(agentDir, SETTINGS_FILE);
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
        new SettingsError({
          kind: 'io',
          message: `Could not read subagent settings ${path}: ${error instanceof Error ? error.message : String(error)}`,
        }),
    });
    if (text === undefined) return {};
    return yield* Schema.decodeUnknownEffect(SettingsJson)(text).pipe(
      Effect.mapError(
        error =>
          new SettingsError({
            kind: 'parse',
            message: `Could not parse subagent settings ${path}: ${String(error)}`,
          }),
      ),
    );
  });
}

function decodeAutoLimit(
  path: string,
  settings: JsonSettings,
): Effect.Effect<boolean, SettingsError> {
  return Schema.decodeUnknownEffect(AutoLimit)(settings.autoLimit).pipe(
    Effect.mapError(
      error =>
        new SettingsError({
          kind: 'parse',
          message: `Could not parse autoLimit in subagent settings ${path}: ${String(error)}`,
        }),
    ),
    Effect.map(value => value ?? false),
  );
}

export function readAutoLimit(
  agentDir: string,
): Effect.Effect<boolean, SettingsError> {
  const path = join(agentDir, SETTINGS_FILE);
  return Effect.gen(function* () {
    const settings = yield* loadSettings(agentDir);
    return yield* decodeAutoLimit(path, settings);
  });
}

export function setAutoLimit(
  agentDir: string,
  on: boolean,
): Effect.Effect<boolean, SettingsError> {
  const path = join(agentDir, SETTINGS_FILE);
  return Effect.gen(function* () {
    const settings = yield* loadSettings(agentDir);
    yield* decodeAutoLimit(path, settings);
    const next = {...settings, autoLimit: on};
    const text = yield* Schema.encodeUnknownEffect(SettingsJson)(next).pipe(
      Effect.mapError(
        error =>
          new SettingsError({
            kind: 'parse',
            message: `Could not encode subagent settings ${path}: ${String(error)}`,
          }),
      ),
    );
    yield* Effect.tryPromise({
      try: () => writeFile(path, text, 'utf8'),
      catch: error =>
        new SettingsError({
          kind: 'io',
          message: `Could not write subagent settings ${path}: ${error instanceof Error ? error.message : String(error)}`,
        }),
    });
    return on;
  });
}
