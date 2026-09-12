import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect, Schema} from 'effect';

const theme = Schema.decodeUnknownSync(
  Schema.Literals(['auto', 'light', 'dark']),
)(process.argv.find(value => value.startsWith('--theme='))?.slice(8) ?? 'auto');
const scenario = Schema.decodeUnknownSync(
  Schema.Literals(['running', 'completed']),
)(
  process.argv.find(value => value.startsWith('--scenario='))?.slice(11) ??
    'running',
);
const directory = await Effect.runPromise(
  Effect.promise(() => mkdtemp(join(tmpdir(), 'pi-subagent-ui-prototype-'))),
);
try {
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, 'host.ts')],
    {
      cwd: directory,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TERM: process.env.TERM ?? 'xterm-256color',
        COLORTERM: process.env.COLORTERM,
        COLORFGBG: process.env.COLORFGBG,
        TERM_PROGRAM: process.env.TERM_PROGRAM,
        LANG: process.env.LANG ?? 'C.UTF-8',
        PI_CODING_AGENT_DIR: directory,
        PI_PROTOTYPE_PROJECT_CWD: process.cwd(),
        PI_PROTOTYPE_SCENARIO: scenario,
        PI_PROTOTYPE_THEME: theme === 'auto' ? 'light/dark' : theme,
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
