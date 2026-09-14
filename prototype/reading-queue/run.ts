// Throwaway launcher: isolate Pi data while preserving the user's theme.
import {getAgentDir} from '@earendil-works/pi-coding-agent';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Effect, Schema} from 'effect';

const Settings = Schema.Struct({theme: Schema.optional(Schema.String)});
process.exitCode = await Effect.runPromise(
  Effect.tryPromise({
    try: async () => {
      const settingsFile = Bun.file(join(getAgentDir(), 'settings.json'));
      const settings = (await settingsFile.exists())
        ? Schema.decodeUnknownSync(Settings)(await settingsFile.json())
        : {};
      const directory = await mkdtemp(join(tmpdir(), 'pi-reading-'));
      try {
        await writeFile(
          join(directory, 'settings.json'),
          JSON.stringify({...settings, tuiMode: 'fullscreen'}),
        );
        const child = Bun.spawn(
          [
            process.execPath,
            resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
            '--offline',
            '--no-extensions',
            '--no-skills',
            '--no-context-files',
            '--no-prompt-templates',
            '--no-themes',
            '--no-approve',
            '--no-builtin-tools',
            '-e',
            resolve('prototype/reading-queue/extension.ts'),
          ],
          {
            cwd: directory,
            env: {
              PATH: process.env.PATH,
              HOME: directory,
              TERM: process.env.TERM ?? 'xterm-256color',
              LANG: process.env.LANG ?? 'C.UTF-8',
              PI_CODING_AGENT_DIR: directory,
              PI_CODING_AGENT_SESSION_DIR: join(directory, 'sessions'),
              PI_OFFLINE: '1',
              PI_TELEMETRY: '0',
            },
            stdin: 'inherit',
            stdout: 'inherit',
            stderr: 'inherit',
          },
        );
        return await child.exited;
      } finally {
        await rm(directory, {recursive: true, force: true});
      }
    },
    catch: cause => new Error('Reading queue could not run', {cause}),
  }),
);
