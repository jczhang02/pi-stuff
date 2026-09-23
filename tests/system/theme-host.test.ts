import {expect, test} from 'bun:test';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {TerminalControl} from '@kitlangton/terminal-control';

const themeNames = [
  'catppuccin-latte',
  'catppuccin-frappe',
  'catppuccin-macchiato',
  'catppuccin-mocha',
  'tokyonight-day',
  'tokyonight-night',
  'gruvbox-light-medium',
  'gruvbox-dark-medium',
  'rose-pine-dawn',
  'rose-pine',
] as const;

const automaticPairs = [
  ['catppuccin-latte', 'catppuccin-mocha'],
  ['tokyonight-day', 'tokyonight-night'],
  ['gruvbox-light-medium', 'gruvbox-dark-medium'],
  ['rose-pine-dawn', 'rose-pine'],
] as const;

let themeStateRequest = 0;

async function launchThemeHost(
  initialTheme?: string,
  existingDirectory?: string,
) {
  const ownsDirectory = existingDirectory === undefined;
  const directory =
    existingDirectory ??
    (await mkdtemp(join(tmpdir(), 'pi-stuff-theme-host-')));
  let server: ReturnType<typeof Bun.serve> | undefined;
  let terminalControl:
    | Awaited<ReturnType<typeof TerminalControl.make>>
    | undefined;
  try {
    const agent = join(directory, 'agent');
    await mkdir(agent, {recursive: true});
    if (initialTheme !== undefined)
      await writeFile(
        join(agent, 'settings.json'),
        JSON.stringify({theme: initialTheme}),
      );
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => {
        const chunk = {
          id: 'theme-fixture',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [
            {
              index: 0,
              delta: {
                content:
                  'THEME_ASSISTANT_MARKER\n# Theme export\n\n`const selected = true`\n\nTHEME_CONTENT_MARKER',
              },
              finish_reason: null,
            },
          ],
        };
        const done = {
          ...chunk,
          choices: [{index: 0, delta: {}, finish_reason: 'stop'}],
        };
        return new Response(
          `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(done)}\n\ndata: [DONE]\n\n`,
          {headers: {'content-type': 'text/event-stream'}},
        );
      },
    });
    await writeFile(
      join(agent, 'models.json'),
      JSON.stringify({
        providers: {
          fixture: {
            baseUrl: `${server.url}v1`,
            api: 'openai-completions',
            apiKey: 'offline-fixture',
            models: [{id: 'fixture'}],
          },
        },
      }),
    );
    terminalControl = await TerminalControl.make({
      binaryPath: resolve('node_modules/.bin/termctrl'),
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
    const control = terminalControl;
    const hostServer = server;
    const piCommand = process.env.PI_TEST_HOST ?? process.execPath;
    const piArguments = [
      ...(process.env.PI_TEST_HOST
        ? []
        : [
            resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
          ]),
      '--offline',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-context-files',
      '--no-approve',
      '--no-builtin-tools',
      '--provider',
      'fixture',
      '--model',
      'fixture',
      '--tui-mode',
      'regular',
      '-e',
      resolve(process.env.PI_TEST_PACKAGE ?? '.'),
      '-e',
      resolve('tests/system/fixtures/theme-discovery.ts'),
    ];
    const terminal = await control.launch({
      command: [piCommand, ...piArguments],
      cwd: directory,
      viewport: {cols: 120, rows: 32},
      inheritEnv: false,
      env: {
        HOME: directory,
        PATH: '/usr/bin:/bin',
        TERM: 'xterm-256color',
        XDG_CONFIG_HOME: join(directory, 'config'),
        XDG_DATA_HOME: join(directory, 'data'),
        PI_CODING_AGENT_DIR: agent,
        PI_CODING_AGENT_SESSION_DIR: join(directory, 'sessions'),
        PI_OFFLINE: '1',
        PI_TELEMETRY: '0',
        NO_PROXY: '127.0.0.1,localhost',
        COLORFGBG: '15;0',
      },
    });
    return {
      directory,
      terminal,
      close: async (removeDirectory = true) => {
        try {
          await terminal.stop();
        } finally {
          try {
            await control.close();
          } finally {
            try {
              await hostServer.stop(true);
            } finally {
              if (removeDirectory)
                await rm(directory, {recursive: true, force: true});
            }
          }
        }
      },
    };
  } catch (error) {
    try {
      await terminalControl?.close();
    } finally {
      try {
        await server?.stop(true);
      } finally {
        if (ownsDirectory) await rm(directory, {recursive: true, force: true});
      }
    }
    throw error;
  }
}

async function invokeCommand(
  terminal: Awaited<ReturnType<typeof launchThemeHost>>['terminal'],
  command: string,
) {
  await terminal.keyboard.type(`/${command}`);
  await terminal.keyboard.press('Enter');
}

async function openNativeThemeSelector(
  terminal: Awaited<ReturnType<typeof launchThemeHost>>['terminal'],
) {
  await invokeCommand(terminal, 'settings');
  await terminal.screen.waitForText('Auto-compact', {timeoutMs: 5000});
  await terminal.keyboard.type('Theme');
  await terminal.screen.waitForText('Theme', {timeoutMs: 5000});
  await terminal.keyboard.press('Enter');
  await terminal.screen.waitForText('Select a theme', {timeoutMs: 5000});
}

async function selectVisibleOption(
  terminal: Awaited<ReturnType<typeof launchThemeHost>>['terminal'],
  name: string,
) {
  for (let attempt = 0; attempt < 32; attempt++) {
    await terminal.screen.capture({settleMs: 20, deadlineMs: 1000});
    const selectedLine = (await terminal.screen.text())
      .split('\n')
      .find(line => line.match(/→\s+(.+)$/)?.[1]?.trim() === name);
    if (selectedLine) {
      await terminal.keyboard.press('Enter');
      return;
    }
    await terminal.keyboard.press('ArrowDown');
  }
  console.error(await terminal.screen.text());
  throw new Error(`Native selector did not expose selected option ${name}`);
}

async function selectThemeThroughSettings(
  terminal: Awaited<ReturnType<typeof launchThemeHost>>['terminal'],
  name: string,
) {
  await openNativeThemeSelector(terminal);
  await selectVisibleOption(terminal, name);
  await terminal.screen.waitUntil(
    async () => {
      const screen = await terminal.screen.text();
      return (
        screen.includes('Type to search') &&
        screen.includes(name) &&
        !screen.includes('Select a theme')
      );
    },
    {timeoutMs: 5000},
  );
  await terminal.keyboard.press('Escape');
  await terminal.screen.waitUntil(
    async () => !(await terminal.screen.text()).includes('Type to search'),
    {timeoutMs: 5000},
  );
}

async function expectActiveTheme(
  terminal: Awaited<ReturnType<typeof launchThemeHost>>['terminal'],
  name: string,
) {
  const request = String(++themeStateRequest);
  await invokeCommand(terminal, `theme-state ${request}`);
  try {
    await terminal.screen.waitForText(
      `THEME_ACTIVE:${name}:REQUEST:${request}:END`,
      {timeoutMs: 5000},
    );
  } catch (error) {
    console.error(await terminal.screen.text());
    throw error;
  }
}

async function waitForHostReady(
  terminal: Awaited<ReturnType<typeof launchThemeHost>>['terminal'],
) {
  await terminal.screen.waitForText('fixture', {timeoutMs: 15000});
  await terminal.screen.waitUntil(
    async () =>
      !(await terminal.screen.text()).includes('Startup is still in progress'),
    {timeoutMs: 15000},
  );
}

test('Pi package loading discovers all bundled themes through the host', async () => {
  const host = await launchThemeHost();
  try {
    await waitForHostReady(host.terminal);
    await expectActiveTheme(host.terminal, 'dark');
    await invokeCommand(host.terminal, 'theme-discovery');
    await host.terminal.screen.waitForText('THEMES_DISCOVERY:', {
      timeoutMs: 5000,
    });
    const screen = await host.terminal.screen.text();
    for (const name of ['dark', 'light', ...themeNames])
      expect(screen).toContain(name);
  } finally {
    await host.close();
  }
}, 90000);

test('native theme selection preserves an existing setting and survives restart', async () => {
  const first = await launchThemeHost('light');
  try {
    try {
      await waitForHostReady(first.terminal);
      await expectActiveTheme(first.terminal, 'light');
      await selectThemeThroughSettings(first.terminal, 'catppuccin-mocha');
      await expectActiveTheme(first.terminal, 'catppuccin-mocha');
    } finally {
      await first.close(false);
    }

    const restarted = await launchThemeHost(undefined, first.directory);
    try {
      await waitForHostReady(restarted.terminal);
      await expectActiveTheme(restarted.terminal, 'catppuccin-mocha');
    } finally {
      await restarted.close(false);
    }
  } finally {
    await rm(first.directory, {recursive: true, force: true});
  }
}, 90000);

test.each(automaticPairs)(
  'native Automatic mode resolves the %s/%s pair from terminal appearance',
  async (lightTheme, darkTheme) => {
    const host = await launchThemeHost(`${lightTheme}/${darkTheme}`);
    try {
      await waitForHostReady(host.terminal);
      await expectActiveTheme(host.terminal, darkTheme);
      await host.terminal.keyboard.write(
        new TextEncoder().encode('\u001b[?997;2n'),
      );
      await expectActiveTheme(host.terminal, lightTheme);
      await host.terminal.keyboard.write(
        new TextEncoder().encode('\u001b[?997;1n'),
      );
      await expectActiveTheme(host.terminal, darkTheme);
    } finally {
      await host.close();
    }
  },
  90000,
);

test('native HTML export uses each bundled theme', async () => {
  const host = await launchThemeHost('dark');
  try {
    await waitForHostReady(host.terminal);
    await host.terminal.keyboard.type('Render the export fixture content');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('THEME_CONTENT_MARKER', {
      timeoutMs: 15000,
    });

    const exportSignatures = new Set<string>();
    for (const name of themeNames) {
      await selectThemeThroughSettings(host.terminal, name);
      await expectActiveTheme(host.terminal, name);
      const output = join(host.directory, `${name}.html`);
      await invokeCommand(host.terminal, `export ${output}`);
      await host.terminal.screen.waitUntil(
        async () => {
          try {
            await readFile(output);
            return true;
          } catch {
            return false;
          }
        },
        {timeoutMs: 10000},
      );
      const html = await readFile(output, 'utf8');
      const exportValues = ['PageBg', 'CardBg', 'InfoBg'].map(
        key => html.match(new RegExp(`--export${key}:\\s*([^;]+);`))?.[1] ?? '',
      );
      for (const value of exportValues) expect(value).not.toBe('');
      exportSignatures.add(exportValues.join('|'));
      const sessionData = html.match(
        /<script id="session-data" type="application\/json">([^<]+)<\/script>/,
      )?.[1];
      expect(sessionData).toBeDefined();
      expect(
        Buffer.from(sessionData ?? '', 'base64').toString('utf8'),
      ).toContain('THEME_CONTENT_MARKER');
    }
    expect(exportSignatures.size).toBe(themeNames.length);
  } finally {
    await host.close();
  }
}, 180000);
