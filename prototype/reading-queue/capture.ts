// Throwaway capture helper: exercise the real Pi UI in a private TC session.
import {getAgentDir} from '@earendil-works/pi-coding-agent';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Effect, Schema} from 'effect';

const Settings = Schema.Struct({theme: Schema.optional(Schema.String)});

const palettes = {
  light: {foreground: '#4c4f69', background: '#eff1f5', cursor: '#dc8a78'},
  dark: {foreground: '#cdd6f4', background: '#1e1e2e', cursor: '#f5e0dc'},
} as const;

const fontFamily = 'JetBrainsMono Nerd Font Mono, LXGW WenKai Mono, monospace';
const viewport = {cols: 122, rows: 36};
const projectRoot = resolve('.');
const termctrl = resolve('node_modules/.bin/termctrl');

async function runTermctrl(args: readonly string[]): Promise<void> {
  const child = Bun.spawn([termctrl, ...args], {
    cwd: projectRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    const detail = stderr.trim() || stdout.trim();
    throw new Error(
      `termctrl ${args[0] ?? 'command'} failed with exit code ${exitCode}${
        detail ? `: ${detail}` : ''
      }`,
    );
  }
}

async function capture(): Promise<string> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: async () => {
        const settingsFile = Bun.file(join(getAgentDir(), 'settings.json'));
        const settings = (await settingsFile.exists())
          ? Schema.decodeUnknownSync(Settings)(await settingsFile.json())
          : {};
        const configuredTheme = settings.theme ?? 'dark';
        if (configuredTheme !== 'light' && configuredTheme !== 'dark') {
          throw new Error(
            `capture supports built-in light or dark themes only, got "${configuredTheme}"`,
          );
        }

        const palette = palettes[configuredTheme];
        const session = `reading-capture-${crypto.randomUUID()}`;
        const artifactDirectory = await mkdtemp(
          join(tmpdir(), 'pi-reading-capture-'),
        );
        const artifactPath = join(artifactDirectory, 'reading.png');
        let operationError: unknown;
        let cleanupError: unknown;

        try {
          const oscSetup = String.raw`printf '\033]10;${palette.foreground}\007\033]11;${palette.background}\007\033]12;${palette.cursor}\007'; exec "$@"`;
          await runTermctrl([
            'start',
            session,
            '--cols',
            String(viewport.cols),
            '--rows',
            String(viewport.rows),
            '--cwd',
            projectRoot,
            '--',
            'sh',
            '-c',
            oscSetup,
            'reading-capture-shell',
            process.execPath,
            resolve('prototype/reading-queue/run.ts'),
          ]);
          await runTermctrl([
            'wait',
            session,
            'Reading queue ready',
            '--timeout',
            '10000',
          ]);
          // Pi clears the missing-model warning through its new-session flow.
          await runTermctrl(['send', session, 'text:/new', 'enter']);
          await runTermctrl([
            'wait',
            session,
            'New session started',
            '--timeout',
            '10000',
          ]);
          await runTermctrl(['send', session, 'text:/reading', 'enter']);
          await runTermctrl([
            'wait',
            session,
            'Unread -',
            '--timeout',
            '10000',
          ]);
          await runTermctrl([
            'resize',
            session,
            '--cols',
            String(viewport.cols),
            '--rows',
            '24',
          ]);
          await runTermctrl(['wait', session, 'Unread -', '--timeout', '5000']);
          await runTermctrl([
            'save',
            session,
            '--format',
            'png',
            '--out',
            artifactPath,
            '--font-family',
            fontFamily,
            '--settle-ms',
            '250',
            '--deadline-ms',
            '5000',
          ]);
        } catch (cause) {
          operationError = cause;
        } finally {
          try {
            await runTermctrl(['stop', session]);
          } catch (cause) {
            cleanupError = cause;
          }
        }
        if (operationError !== undefined && cleanupError !== undefined) {
          throw new AggregateError(
            [operationError, cleanupError],
            'Capture failed and its Terminal Control session could not be stopped',
          );
        }
        if (operationError !== undefined) throw operationError;
        if (cleanupError !== undefined) throw cleanupError;
        return artifactPath;
      },
      catch: cause => {
        const message = cause instanceof Error ? cause.message : String(cause);
        return new Error(message, {cause});
      },
    }),
  );
}

try {
  process.stdout.write(`${await capture()}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
