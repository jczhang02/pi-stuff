// Scratch Pi host shared by foreground review and terminal captures.
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Effect, Schema} from 'effect';
import type {Scenario} from './footer';

export const root = resolve(import.meta.dir, '../..');
export const terminalBinary = join(root, 'node_modules/.bin/termctrl');
export const font =
  'JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono';
export type Palette = 'catppuccin-latte' | 'catppuccin-mocha';
const PaletteFile = Schema.Struct({
  vars: Schema.Struct({text: Schema.String, base: Schema.String}),
});

export async function createHost(
  scenario: Scenario,
  theme: Palette,
  capture = false,
) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-statusline-'));
  try {
    const agent = join(directory, 'agent');
    const sessions = join(directory, 'sessions');
    await mkdir(agent);
    await mkdir(sessions);
    await writeFile(
      join(agent, 'settings.json'),
      JSON.stringify({quietStartup: true, theme}),
    );
    const themePath = join(root, 'themes', `${theme}.json`);
    const palette = Schema.decodeUnknownSync(PaletteFile)(
      JSON.parse(await readFile(themePath, 'utf8')),
    );
    if (
      !/^#[\da-f]{6}$/iu.test(palette.vars.text) ||
      !/^#[\da-f]{6}$/iu.test(palette.vars.base)
    ) {
      throw new Error('Invalid theme palette');
    }
    const host: [string, ...string[]] = process.env.PI_TEST_HOST
      ? [process.env.PI_TEST_HOST]
      : [
          process.execPath,
          join(
            root,
            'node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
          ),
        ];
    const args: [string, ...string[]] = [
      ...host,
      '--offline',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-themes',
      '--no-context-files',
      '--no-approve',
      '--no-builtin-tools',
      '--provider',
      'statusline-sample',
      '--model',
      'gpt-6-astra',
      '--thinking',
      'medium',
      '--theme',
      themePath,
      '--use-theme',
      theme,
      '--tui-mode',
      'fullscreen',
      '-e',
      join(import.meta.dir, 'extension.ts'),
    ];
    // Set the headless renderer's palette only; foreground review keeps its terminal palette.
    const command: [string, ...string[]] = capture
      ? [
          '/bin/sh',
          '-c',
          `printf %b "\\033]10;${palette.vars.text}\\a\\033]11;${palette.vars.base}\\a"; exec "$@"`,
          'pi-statusline',
          ...args,
        ]
      : args;
    return {
      directory,
      command,
      env: {
        HOME: directory,
        PATH: '/usr/bin:/bin',
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        PI_CODING_AGENT_DIR: agent,
        PI_CODING_AGENT_SESSION_DIR: sessions,
        PI_STATUSLINE_SCENARIO: scenario,
        PI_OFFLINE: '1',
        PI_TELEMETRY: '0',
        XDG_CONFIG_HOME: directory,
        XDG_DATA_HOME: directory,
      },
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
