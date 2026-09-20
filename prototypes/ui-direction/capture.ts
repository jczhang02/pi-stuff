// Throwaway UI research capture runner. It launches the real Pi host in isolation.
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {Effect, Schema} from 'effect';
import {
  TerminalControl,
  type Color,
  type Frame,
  type ScreenSnapshot,
  type Session,
} from '@kitlangton/terminal-control';

const REPOSITORY_ROOT = resolve(import.meta.dir, '../..');
const EXTENSION_PATH = resolve(
  REPOSITORY_ROOT,
  'prototypes/ui-direction/extension.ts',
);
const PI_CLI_PATH = resolve(
  REPOSITORY_ROOT,
  'node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
);
const TERMINAL_CONTROL_PATH = resolve(
  REPOSITORY_ROOT,
  'node_modules/.bin/termctrl',
);
const DEFAULT_OUTPUT_DIRECTORY = resolve(
  REPOSITORY_ROOT,
  'prototypes/ui-direction/captures',
);
const FONT_FAMILY =
  'JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono';
const WAIT_TIMEOUT_MS = 15_000;
const CAPTURE_SETTLE_MS = 250;
const CAPTURE_DEADLINE_MS = 5_000;
const ESCAPE_BYTE = new Uint8Array([0x1b]);
// Pi's legacy terminal encoding for ctrl+alt+u is ESC followed by ctrl+u.
const CTRL_ALT_U_BYTES = new Uint8Array([0x1b, 0x15]);
const PREVIOUS_TOOL_BYTE = new Uint8Array([0x5b]);
const NEXT_TOOL_BYTE = new Uint8Array([0x5d]);

const ThemeFile = Schema.Struct({
  name: Schema.String,
  vars: Schema.Struct({
    base: Schema.String,
    text: Schema.String,
  }),
});
const CliValues = Schema.Struct({
  cols: Schema.optional(Schema.String),
  help: Schema.optional(Schema.Boolean),
  out: Schema.optional(Schema.String),
  rows: Schema.optional(Schema.String),
  theme: Schema.optional(Schema.String),
});

type ThemeName = 'catppuccin-latte' | 'catppuccin-mocha';
type Scenario =
  | 'baseline'
  | 'welcome'
  | 'work'
  | 'diff'
  | 'failure'
  | 'complete';
type ThemeFileValue = Schema.Schema.Type<typeof ThemeFile>;

type RunnerOptions = {
  scenario: Scenario;
  outputLabel: string;
  theme: ThemeName;
  cols: number;
  rows: number;
  outputDirectory: string;
};

type IsolatedPaths = {
  root: string;
  agent: string;
  sessions: string;
  config: string;
  data: string;
};

const USAGE = `Usage: bun prototypes/ui-direction/capture.ts <scenario> [options]

Scenarios: baseline, welcome, work, work-narrow, diff, failure, complete
Options:
  --theme <catppuccin-latte|catppuccin-mocha>
  --cols <number> --rows <number>
  --out <directory>
`;

function isScenario(value: string): value is Scenario {
  return (
    value === 'baseline' ||
    value === 'welcome' ||
    value === 'work' ||
    value === 'diff' ||
    value === 'failure' ||
    value === 'complete'
  );
}

function isThemeName(value: string): value is ThemeName {
  return value === 'catppuccin-latte' || value === 'catppuccin-mocha';
}

function defaultThemeFor(scenario: Scenario): ThemeName {
  return scenario === 'work' ? 'catppuccin-mocha' : 'catppuccin-latte';
}

function parseDimension(value: string, option: string): number {
  const dimension = Number(value);
  if (!Number.isInteger(dimension) || dimension < 1) {
    throw new Error(`${option} must be a positive integer.`);
  }
  return dimension;
}

function parseArguments(args: readonly string[]): RunnerOptions | undefined {
  const parsed = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      cols: {type: 'string'},
      help: {type: 'boolean', short: 'h'},
      out: {type: 'string'},
      rows: {type: 'string'},
      theme: {type: 'string'},
    },
  });
  const values = Schema.decodeUnknownSync(CliValues)(parsed.values);
  if (values.help === true) {
    console.log(USAGE);
    return undefined;
  }

  const scenarioArgument = parsed.positionals[0];
  if (parsed.positionals.length > 1) {
    throw new Error(
      `Unexpected positional argument: ${parsed.positionals.slice(1).join(' ')}`,
    );
  }

  const requestedScenario = scenarioArgument ?? 'welcome';
  const narrow = requestedScenario === 'work-narrow';
  const scenario = narrow ? 'work' : requestedScenario;
  if (!isScenario(scenario)) {
    throw new Error(`Unknown scenario: ${requestedScenario}`);
  }
  const selectedTheme = values.theme ?? defaultThemeFor(scenario);
  if (!isThemeName(selectedTheme)) {
    throw new Error(`Unknown theme: ${selectedTheme}`);
  }

  return {
    scenario,
    outputLabel: narrow ? 'work-narrow' : scenario,
    theme: selectedTheme,
    cols:
      values.cols !== undefined
        ? parseDimension(values.cols, '--cols')
        : narrow
          ? 80
          : 120,
    rows:
      values.rows !== undefined
        ? parseDimension(values.rows, '--rows')
        : narrow
          ? 30
          : 40,
    outputDirectory:
      values.out !== undefined
        ? resolve(process.cwd(), values.out)
        : DEFAULT_OUTPUT_DIRECTORY,
  };
}

function colorFromHex(value: string): Color {
  const match = /^#([0-9a-f]{6})$/iu.exec(value);
  const hex = match?.[1];
  if (hex === undefined) {
    throw new Error(`Theme color is not a six-digit hex value: ${value}`);
  }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function sameColor(left: Color, right: Color): boolean {
  return left.r === right.r && left.g === right.g && left.b === right.b;
}

function themePath(theme: ThemeName): string {
  return resolve(REPOSITORY_ROOT, 'themes', `${theme}.json`);
}

async function loadTheme(theme: ThemeName): Promise<ThemeFileValue> {
  const source = await readFile(themePath(theme), 'utf8');
  const value: unknown = JSON.parse(source);
  return Schema.decodeUnknownSync(ThemeFile)(value);
}

function expectedToken(scenario: Scenario): string {
  switch (scenario) {
    case 'baseline':
      return 'pi v0.85.1';
    case 'welcome':
      return 'Welcome back!';
    case 'work':
      return '3 matches';
    case 'diff':
      return 'deduplicate';
    case 'failure':
      return 'Test failed';
    case 'complete':
      return '8 passed';
  }
}

async function createIsolatedPaths(
  theme: ThemeName,
  quietStartup: boolean,
): Promise<IsolatedPaths> {
  const root = await mkdtemp(join(tmpdir(), 'pi-ui-direction-'));
  const agent = join(root, 'agent');
  const sessions = join(root, 'sessions');
  const config = join(root, 'config');
  const data = join(root, 'data');
  await Promise.all(
    [agent, sessions, config, data].map(directory =>
      mkdir(directory, {recursive: true}),
    ),
  );
  await writeFile(
    join(agent, 'settings.json'),
    JSON.stringify({quietStartup, theme}, null, 2),
  );
  await writeFile(
    join(agent, 'models.json'),
    JSON.stringify(
      {
        providers: {
          preview: {
            baseUrl: 'http://127.0.0.1:9/v1',
            api: 'openai-completions',
            apiKey: 'preview-only-no-network',
            models: [{id: 'preview'}],
          },
        },
      },
      null,
      2,
    ),
  );
  return {root, agent, sessions, config, data};
}

function terminalEnvironment(paths: IsolatedPaths, theme: ThemeFileValue) {
  return {
    HOME: paths.root,
    PATH: '/usr/bin:/bin',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    COLORFGBG: theme.name.endsWith('latte') ? '0;15' : '15;0',
    PI_CODING_AGENT_DIR: paths.agent,
    PI_CODING_AGENT_SESSION_DIR: paths.sessions,
    PI_OFFLINE: '1',
    PI_TELEMETRY: '0',
    PI_UI_SCENE: process.env.PI_UI_SCENE ?? '',
    PI_UI_THEME: process.env.PI_UI_THEME ?? '',
    XDG_CONFIG_HOME: paths.config,
    XDG_DATA_HOME: paths.data,
    NO_PROXY: '127.0.0.1,localhost',
  };
}

function launchEnvironment(
  paths: IsolatedPaths,
  theme: ThemeFileValue,
  scenario: Scenario,
  themeName: ThemeName,
) {
  return {
    ...terminalEnvironment(paths, theme),
    PI_UI_SCENE: scenario,
    PI_UI_THEME: themeName,
  };
}

function oscLauncher(foreground: string, background: string): string {
  return `printf %b "\\033]10;${foreground}\\a\\033]11;${background}\\a"; command=$1; shift; exec "$command" "$@"`;
}

function piArguments(options: RunnerOptions): string[] {
  const argumentsList = [
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
    themePath(options.theme),
    '--use-theme',
    options.theme,
    '--tui-mode',
    'fullscreen',
  ];
  if (options.scenario !== 'baseline') {
    argumentsList.push('-e', EXTENSION_PATH);
  }
  return argumentsList;
}

async function waitForReady(session: Session, token: string): Promise<void> {
  await session.screen.waitForText(token, {timeoutMs: WAIT_TIMEOUT_MS});
  await session.screen.waitForIdle({
    timeoutMs: WAIT_TIMEOUT_MS,
    quietForMs: CAPTURE_SETTLE_MS,
  });
}

function assertFrame(
  frame: Frame,
  options: RunnerOptions,
  expectedForeground: Color,
  expectedBackground: Color,
): void {
  if (frame.cols !== options.cols || frame.rows !== options.rows) {
    throw new Error(
      `Unexpected frame size: ${frame.cols}x${frame.rows}, expected ${options.cols}x${options.rows}.`,
    );
  }
  if (!sameColor(frame.foreground, expectedForeground)) {
    throw new Error(
      `Unexpected default foreground: ${JSON.stringify(frame.foreground)}.`,
    );
  }
  if (!sameColor(frame.background, expectedBackground)) {
    throw new Error(
      `Unexpected default background: ${JSON.stringify(frame.background)}.`,
    );
  }
  for (const cell of frame.cells) {
    if (
      cell.x < 0 ||
      cell.y < 0 ||
      cell.x >= frame.cols ||
      cell.y >= frame.rows ||
      cell.x + cell.width > frame.cols
    ) {
      throw new Error(
        `Clipped cell at (${cell.x}, ${cell.y}) width ${cell.width} in ${frame.cols} columns.`,
      );
    }
  }
}

async function exportPng(
  ansiPath: string,
  pngPath: string,
  cols: number,
  rows: number,
): Promise<void> {
  const child = Bun.spawn(
    [
      TERMINAL_CONTROL_PATH,
      'save',
      '--input',
      ansiPath,
      '--format',
      'png',
      '--out',
      pngPath,
      '--font-family',
      FONT_FAMILY,
      '--cols',
      String(cols),
      '--rows',
      String(rows),
      '--cell-width',
      '9',
      '--cell-height',
      '18',
      '--padding',
      '18',
      '--pixel-ratio',
      '2',
      '--hide-cursor',
    ],
    {cwd: REPOSITORY_ROOT, stdout: 'pipe', stderr: 'pipe'},
  );
  const exitCode = await child.exited;
  const stderr =
    child.stderr === null ? '' : await new Response(child.stderr).text();
  if (exitCode !== 0) {
    throw new Error(`termctrl PNG export failed (${exitCode}): ${stderr}`);
  }
}

async function captureScreen(
  session: Session,
  options: RunnerOptions,
  theme: ThemeFileValue,
  label: string,
  tokens: readonly string[],
): Promise<ScreenSnapshot> {
  const snapshot = await session.screen.capture({
    settleMs: CAPTURE_SETTLE_MS,
    deadlineMs: CAPTURE_DEADLINE_MS,
    includeAnsi: true,
  });
  assertFrame(
    snapshot.frame,
    options,
    colorFromHex(theme.vars.text),
    colorFromHex(theme.vars.base),
  );
  for (const token of tokens) {
    if (!snapshot.text.includes(token)) {
      throw new Error(`Capture ${label} is missing visible token: ${token}`);
    }
  }
  if (snapshot.ansi === undefined) {
    throw new Error(`Capture ${label} did not include ANSI evidence.`);
  }

  const stem = join(
    options.outputDirectory,
    `${options.outputLabel}-${options.theme}-${options.cols}x${options.rows}-${label}`,
  );
  const ansiPath = `${stem}.ansi`;
  await writeFile(`${stem}.txt`, snapshot.text, 'utf8');
  await writeFile(ansiPath, snapshot.ansi);
  await exportPng(ansiPath, `${stem}.png`, options.cols, options.rows);
  console.log(`${label}: ${stem}.png`);
  return snapshot;
}

function tailContains(text: string, value: string): boolean {
  return text
    .split('\n')
    .slice(-8)
    .some(line => line.includes(value));
}

async function submitCommand(
  session: Session,
  command: string,
  clearEditor: boolean,
): Promise<void> {
  if (clearEditor) await session.keyboard.press('Control+U');
  await session.keyboard.type(command);
  await session.keyboard.press('Enter');
}

async function captureSettingsAndRestore(
  session: Session,
  options: RunnerOptions,
  theme: ThemeFileValue,
): Promise<void> {
  await submitCommand(session, '/ui', false);
  await session.screen.waitForText('Display settings', {
    timeoutMs: WAIT_TIMEOUT_MS,
  });
  await session.screen.waitForText('Tool output', {
    timeoutMs: WAIT_TIMEOUT_MS,
  });
  await session.screen.waitForIdle({
    timeoutMs: WAIT_TIMEOUT_MS,
    quietForMs: CAPTURE_SETTLE_MS,
  });
  const initialSettings = await captureScreen(
    session,
    options,
    theme,
    'ui-settings',
    ['Display settings', 'Tool output'],
  );
  const initialToolValue = initialSettings.text.includes('Tool output  full')
    ? 'full'
    : 'preview';
  const toggledToolValue = initialToolValue === 'full' ? 'preview' : 'full';
  await session.keyboard.press('Enter');
  await session.screen.waitForText(`Tool output  ${toggledToolValue}`, {
    timeoutMs: WAIT_TIMEOUT_MS,
  });
  await session.screen.waitForIdle({
    timeoutMs: WAIT_TIMEOUT_MS,
    quietForMs: CAPTURE_SETTLE_MS,
  });
  await captureScreen(session, options, theme, 'ui-settings-toggle', [
    'Display settings',
    `Tool output  ${toggledToolValue}`,
  ]);
  await session.keyboard.write(ESCAPE_BYTE);
  await Bun.sleep(250);
  await session.screen.waitForIdle({
    timeoutMs: WAIT_TIMEOUT_MS,
    quietForMs: CAPTURE_SETTLE_MS,
  });
  await session.keyboard.type('再检查一下游标边界');
  await session.keyboard.write(CTRL_ALT_U_BYTES);
  await session.screen.waitForText('Display settings', {
    timeoutMs: WAIT_TIMEOUT_MS,
  });
  await session.screen.waitForText('Tool output', {
    timeoutMs: WAIT_TIMEOUT_MS,
  });
  await session.screen.waitForIdle({
    timeoutMs: WAIT_TIMEOUT_MS,
    quietForMs: CAPTURE_SETTLE_MS,
  });
  await captureScreen(session, options, theme, 'ui-settings-draft', [
    'Display settings',
    'Tool output',
    `Tool output  ${toggledToolValue}`,
  ]);
  await session.keyboard.write(ESCAPE_BYTE);
  await Bun.sleep(250);
  await session.screen.waitForIdle({
    timeoutMs: WAIT_TIMEOUT_MS,
    quietForMs: CAPTURE_SETTLE_MS,
  });
  await session.screen.waitUntil(
    snapshot => tailContains(snapshot.text, '再检查一下游标边界'),
    {timeoutMs: WAIT_TIMEOUT_MS},
  );
  await captureScreen(session, options, theme, 'ui-restored', [
    '再检查一下游标边界',
  ]);
}

async function captureWorkInteractions(
  session: Session,
  options: RunnerOptions,
  theme: ThemeFileValue,
): Promise<void> {
  await session.keyboard.press('Control+O');
  await session.screen.waitForText('src/search/types.ts:12', {
    timeoutMs: WAIT_TIMEOUT_MS,
  });
  await captureScreen(session, options, theme, 'work-expanded', [
    'src/search/types.ts:12',
  ]);
  await captureSettingsAndRestore(session, options, theme);
  await submitCommand(session, '/tools history', true);
  await session.screen.waitForText('Tools · 2 activities', {
    timeoutMs: WAIT_TIMEOUT_MS,
  });
  if (options.cols < 96) {
    await captureScreen(session, options, theme, 'tools-list', [
      'Tools · 2 activities',
    ]);
    await session.keyboard.press('Enter');
  }
  await waitForReady(session, 'Tools / Search');
  await captureScreen(session, options, theme, 'tools-history', [
    'Tools /',
    '1/2',
  ]);
  await session.keyboard.write(NEXT_TOOL_BYTE);
  await session.screen.waitForText('Tools / Read', {
    timeoutMs: WAIT_TIMEOUT_MS,
  });
  await session.screen.waitForIdle({
    timeoutMs: WAIT_TIMEOUT_MS,
    quietForMs: CAPTURE_SETTLE_MS,
  });
  await captureScreen(session, options, theme, 'tools-history-next', [
    'Tools /',
    '2/2',
    'Read',
  ]);
  await session.keyboard.write(PREVIOUS_TOOL_BYTE);
  await session.screen.waitForText('Tools / Search', {
    timeoutMs: WAIT_TIMEOUT_MS,
  });
  await session.screen.waitForIdle({
    timeoutMs: WAIT_TIMEOUT_MS,
    quietForMs: CAPTURE_SETTLE_MS,
  });
  await captureScreen(session, options, theme, 'tools-history-previous', [
    'Tools /',
    '1/2',
    'Search',
  ]);
  if (options.cols >= 96) await session.keyboard.press('Tab');
  await session.screen.waitForText('Esc Back', {timeoutMs: WAIT_TIMEOUT_MS});
  await session.keyboard.write(ESCAPE_BYTE);
  await Bun.sleep(250);
  await session.screen.waitForText('Esc Close', {timeoutMs: WAIT_TIMEOUT_MS});
  await session.keyboard.write(ESCAPE_BYTE);
  await Bun.sleep(250);
  await session.keyboard.type('继续检查工具输出');
  await session.screen.waitUntil(
    snapshot => tailContains(snapshot.text, '继续检查工具输出'),
    {timeoutMs: WAIT_TIMEOUT_MS},
  );
  await captureScreen(session, options, theme, 'tools-restored', [
    '继续检查工具输出',
  ]);
}

async function runCapture(options: RunnerOptions): Promise<void> {
  await mkdir(options.outputDirectory, {recursive: true});
  const theme = await loadTheme(options.theme);
  const paths = await createIsolatedPaths(
    options.theme,
    options.scenario !== 'baseline',
  );
  let terminal: TerminalControl | undefined;
  let session: Session | undefined;
  try {
    terminal = await TerminalControl.make({
      binaryPath: TERMINAL_CONTROL_PATH,
      env: {
        HTTP_PROXY: undefined,
        HTTPS_PROXY: undefined,
        ALL_PROXY: undefined,
        http_proxy: undefined,
        https_proxy: undefined,
        all_proxy: undefined,
        DISPLAY: undefined,
        WAYLAND_DISPLAY: undefined,
        DBUS_SESSION_BUS_ADDRESS: undefined,
      },
    });
    const pi = [
      process.execPath,
      PI_CLI_PATH,
      ...piArguments(options),
    ] as const;
    session = await terminal.launch({
      command: [
        '/bin/sh',
        '-c',
        oscLauncher(theme.vars.text, theme.vars.base),
        'pi-ui-direction',
        ...pi,
      ],
      cwd: paths.root,
      viewport: {cols: options.cols, rows: options.rows},
      host: 'opentui',
      color: 'always',
      inheritEnv: false,
      env: launchEnvironment(paths, theme, options.scenario, options.theme),
    });

    await waitForReady(session, expectedToken(options.scenario));
    await captureScreen(session, options, theme, 'main', [
      expectedToken(options.scenario),
    ]);
    if (options.scenario === 'welcome') {
      await captureSettingsAndRestore(session, options, theme);
    } else if (options.scenario === 'work') {
      await captureWorkInteractions(session, options, theme);
    }
  } catch (error) {
    try {
      if (session !== undefined) {
        await writeFile(
          join(
            options.outputDirectory,
            `${options.outputLabel}-${options.theme}-${options.cols}x${options.rows}-failure.txt`,
          ),
          await session.screen.text(),
          'utf8',
        );
        console.error(await session.logs.text());
      }
    } catch (captureError) {
      console.error(`Could not retain failure screen: ${String(captureError)}`);
    }
    throw error;
  } finally {
    try {
      await session?.stop();
    } finally {
      try {
        await terminal?.close();
      } finally {
        await rm(paths.root, {recursive: true, force: true});
      }
    }
  }
}

const options = parseArguments(Bun.argv.slice(2));
if (options !== undefined) {
  await Effect.runPromise(
    Effect.tryPromise({
      try: () => runCapture(options),
      catch: error =>
        error instanceof Error ? error : new Error(String(error)),
    }),
  ).catch(error => {
    console.error(`Capture failed: ${String(error)}`);
    process.exitCode = 1;
  });
}
