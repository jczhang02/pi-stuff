import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect, Schema} from 'effect';

const argument = process.argv.find(value => value.startsWith('--variant='));
const variant = Schema.decodeUnknownSync(Schema.Literals(['A', 'B', 'C']))(
  argument?.slice(10) ?? 'A',
);
const directory = await Effect.runPromise(
  Effect.promise(() => mkdtemp(join(tmpdir(), 'pi-subagent-ui-prototype-'))),
);
try {
  const child = Bun.spawn(
    [
      process.env.PI_PROTOTYPE_HOST ?? '/opt/bin/pi',
      '--offline',
      '--no-session',
      '--no-tools',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-themes',
      '--no-context-files',
      '--no-approve',
      '--tui-mode',
      'fullscreen',
      '-e',
      join(import.meta.dir, 'index.ts'),
      '--fleet-variant',
      variant,
    ],
    {
      cwd: directory,
      env: {
        PATH: process.env.PATH,
        TERM: process.env.TERM ?? 'xterm-256color',
        LANG: process.env.LANG ?? 'C.UTF-8',
        PI_CODING_AGENT_DIR: directory,
        PI_OFFLINE: '1',
        PI_TELEMETRY: '0',
      },
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
  process.exitCode = await child.exited;
} finally {
  await Effect.runPromise(
    Effect.promise(() => rm(directory, {recursive: true, force: true})),
  );
}
