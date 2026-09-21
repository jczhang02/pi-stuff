// Isolated host environment shared by the capture runner and foreground launcher.
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Effect, Schema} from 'effect';
import {scenes} from './fixtures';
export const root = resolve(import.meta.dir, '../..');
export const terminalBinary = join(root, 'node_modules/.bin/termctrl');
export const font =
  'JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono';
const Theme = Schema.Struct({
  vars: Schema.Struct({text: Schema.String, base: Schema.String}),
});
export type Palette = 'catppuccin-mocha' | 'catppuccin-latte';
export async function sandbox(
  scene: string,
  theme: Palette,
  paletteTarget: 'capture' | 'interactive' = 'interactive',
  hideThinkingBlock = true,
) {
  if (!scenes.some(s => s.name === scene))
    throw new Error(`Unknown scene: ${scene}`);
  const directory = await mkdtemp(join(tmpdir(), 'pi-ui-session-'));
  try {
    const agent = join(directory, 'agent');
    const sessions = join(directory, 'sessions');
    await mkdir(agent);
    await mkdir(sessions);
    await writeFile(
      join(agent, 'settings.json'),
      JSON.stringify({quietStartup: true, theme, hideThinkingBlock}),
    );
    await writeFile(
      join(agent, 'models.json'),
      JSON.stringify({
        providers: {
          preview: {
            baseUrl: 'http://127.0.0.1:9/v1',
            api: 'openai-completions',
            apiKey: 'offline-fixture',
            models: [{id: 'preview'}],
          },
        },
      }),
    );
    const palette = Schema.decodeUnknownSync(Theme)(
      JSON.parse(await readFile(join(root, 'themes', `${theme}.json`), 'utf8')),
    );
    const env = {
      HOME: directory,
      PATH: '/usr/bin:/bin',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      PI_CODING_AGENT_DIR: agent,
      PI_CODING_AGENT_SESSION_DIR: sessions,
      PI_SESSION_SCENE: scene,
      PI_OFFLINE: '1',
      PI_TELEMETRY: '0',
      XDG_CONFIG_HOME: directory,
      XDG_DATA_HOME: directory,
    };
    const args: [string, ...string[]] = [
      process.execPath,
      join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
      '--offline',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-themes',
      '--no-context-files',
      '--no-approve',
      '--no-builtin-tools',
      '--provider',
      'preview',
      '--model',
      'preview',
      '--theme',
      join(root, 'themes', `${theme}.json`),
      '--use-theme',
      theme,
      '--tui-mode',
      'fullscreen',
      '-e',
      join(import.meta.dir, 'extension.ts'),
    ];
    // Only decoded hexadecimal theme colors enter this fixed OSC sequence.
    if (
      !/^#[\da-f]{6}$/iu.test(palette.vars.text) ||
      !/^#[\da-f]{6}$/iu.test(palette.vars.base)
    )
      throw new Error('Invalid palette');
    const command: [string, ...string[]] =
      paletteTarget === 'capture'
        ? [
            '/bin/sh',
            '-c',
            `printf %b "\\033]10;${palette.vars.text}\\a\\033]11;${palette.vars.base}\\a"; exec "$@"`,
            'pi-ui-session',
            ...args,
          ]
        : args;
    return {
      directory,
      env,
      command,
      palette: palette.vars,
      cleanup: () => rm(directory, {recursive: true, force: true}),
    };
  } catch (error) {
    await rm(directory, {recursive: true, force: true});
    throw error;
  }
}
export function runEffect(run: () => Promise<void>): Promise<void> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: run,
      catch: error =>
        error instanceof Error ? error : new Error(String(error)),
    }),
  );
}
