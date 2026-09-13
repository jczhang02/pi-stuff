// Offline prototype launcher. Candidate selection belongs outside the evaluated UI.
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect, Schema} from 'effect';

const variant = Schema.decodeUnknownSync(
  Schema.Literals(['inspector', 'monitor', 'inbox', 'trace', 'stacks']),
)(process.argv.find(v => v.startsWith('--variant='))?.slice(10) ?? 'inspector');
const theme = Schema.decodeUnknownSync(Schema.Literals(['light', 'dark']))(
  process.argv.find(v => v.startsWith('--theme='))?.slice(8) ?? 'light',
);
const directory = await Effect.runPromise(
  Effect.promise(() => mkdtemp(join(tmpdir(), 'pi-observation-lab-'))),
);
try {
  const project = join(directory, 'pi-stuff');
  await Effect.runPromise(Effect.promise(() => mkdir(project)));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'app.ts')], {
    cwd: project,
    env: {
      PATH: process.env.PATH,
      HOME: directory,
      TERM: process.env.TERM ?? 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG ?? 'C.UTF-8',
      PI_CODING_AGENT_DIR: directory,
      PI_OFFLINE: '1',
      PI_TELEMETRY: '0',
      PI_OBSERVATION_VARIANT: variant,
      PI_OBSERVATION_THEME: theme,
    },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const stop = () => child.kill('SIGTERM');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    process.exitCode = await child.exited;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
} finally {
  await Effect.runPromise(
    Effect.promise(() => rm(directory, {recursive: true, force: true})),
  );
}
