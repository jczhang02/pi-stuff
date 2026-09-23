import {
  readFile,
  open,
  rename,
  unlink,
  realpath,
  lstat,
} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Effect, Schema} from 'effect';
import {ConfigurationError, readConfiguration} from './configuration';
import type {RtkSettings} from '../rtk/settings';
import type {UiSettings} from '../ui/settings';
import type {NamingSettings} from '../naming/settings';
import type {EditorSettings} from '../editor/settings';

type Configuration = Effect.Success<ReturnType<typeof readConfiguration>>;
const missing = Schema.is(Schema.Struct({code: Schema.Literal('ENOENT')}));

function readText(path: string) {
  return Effect.tryPromise({
    try: () => readFile(path, 'utf8'),
    catch: error =>
      missing(error)
        ? ('missing' as const)
        : new ConfigurationError({message: 'Cannot read pi-stuff.json.'}),
  }).pipe(
    Effect.catch(error =>
      error === 'missing' ? Effect.succeed(undefined) : Effect.fail(error),
    ),
  );
}

function writeTarget(path: string) {
  return Effect.tryPromise({
    try: async () => {
      try {
        return await realpath(path);
      } catch (error) {
        if (!missing(error)) throw error;
        const entry = await lstat(path).catch(error => {
          if (missing(error)) return undefined;
          throw error;
        });
        if (entry?.isSymbolicLink())
          throw new Error('Broken configuration symlink.');
        return path;
      }
    },
    catch: () =>
      new ConfigurationError({
        message:
          'Cannot resolve pi-stuff.json. Check its path and symlink target, then /reload.',
      }),
  });
}

// The file owner retains the exact loaded revision to reject stale panel saves.
export class ConfigurationFile {
  private constructor(
    private readonly path: string,
    private readonly target: string,
    private text: string | undefined,
    private current: Configuration,
  ) {}

  get value() {
    return this.current;
  }

  static load(path: string) {
    return Effect.gen(function* () {
      const target = yield* writeTarget(path);
      const text = yield* readText(path);
      const value = yield* readConfiguration(Effect.succeed(text));
      return new ConfigurationFile(path, target, text, value);
    });
  }

  saveRtk(settings: RtkSettings) {
    return this.save('rtk', settings);
  }

  saveNaming(settings: NamingSettings) {
    return this.save('naming', settings);
  }

  saveEditor(settings: EditorSettings) {
    return this.save('editor', settings);
  }

  saveUi(settings: UiSettings) {
    return this.save('ui', settings);
  }

  private save<K extends 'rtk' | 'naming' | 'editor' | 'ui'>(
    section: K,
    settings: NonNullable<Configuration[K]>,
  ) {
    return Effect.tryPromise({
      try: async () => {
        const lockPath = `${this.target}.lock`;
        const lock = await open(lockPath, 'wx', 0o600);
        const temporary = `${this.target}.${randomUUID()}.tmp`;
        let staged = false;
        try {
          const next = `${JSON.stringify({...this.value, [section]: settings}, null, 2)}\n`;
          const file = await open(temporary, 'wx', 0o600);
          staged = true;
          try {
            await file.writeFile(next);
            await file.sync();
          } finally {
            await file.close();
          }
          // Check after staging so edits during write/fsync are not overwritten.
          // The lock serializes Pi Stuff saves, not non-cooperating editors.
          const current = await Effect.runPromise(readText(this.path));
          const target = await Effect.runPromise(writeTarget(this.path));
          if (current !== this.text || target !== this.target)
            throw new ConfigurationError({
              message:
                'Settings changed on disk. Nothing saved. /reload before retrying.',
            });
          await rename(temporary, this.target);
          staged = false;
          this.text = next;
          this.current = {...this.current, [section]: settings};
        } finally {
          try {
            if (staged) await unlink(temporary);
          } finally {
            await lock.close();
            await unlink(lockPath);
          }
        }
      },
      catch: error =>
        Schema.is(ConfigurationError)(error)
          ? error
          : new ConfigurationError({
              message: `Could not finish saving ${section === 'rtk' || section === 'ui' ? section.toUpperCase() : section} settings. Check permissions or a concurrent save, then /reload to verify.`,
            }),
    });
  }
}
