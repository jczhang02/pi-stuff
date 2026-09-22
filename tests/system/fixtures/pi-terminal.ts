import {mkdtemp, mkdir, writeFile, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {
  TerminalControl,
  type Session,
  type LaunchOptions,
} from '@kitlangton/terminal-control';
import {Schema} from 'effect';

const Request = Schema.Struct({
  model: Schema.String,
  max_tokens: Schema.optional(Schema.Number),
  max_completion_tokens: Schema.optional(Schema.Number),
  reasoning_effort: Schema.optional(Schema.String),
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.String,
      content: Schema.optional(
        Schema.Union([
          Schema.String,
          Schema.Null,
          Schema.Array(
            Schema.Struct({
              type: Schema.String,
              text: Schema.optional(Schema.String),
            }),
          ),
        ]),
      ),
    }),
  ),
  tools: Schema.optional(
    Schema.Array(
      Schema.Struct({function: Schema.Struct({name: Schema.String})}),
    ),
  ),
});
export type ModelRequest = typeof Request.Type;

// The real host loads the product entrypoint. Only the external model is deterministic.
export async function launchPi(
  configuration = '{}',
  extraExtension?: string,
  profile: 'rtk' | 'web' = 'rtk',
  mode: 'regular' | 'fullscreen' = 'fullscreen',
  modelReply?: (
    body: ModelRequest,
    signal: AbortSignal,
  ) => Response | undefined | Promise<Response | undefined>,
  startupArgs: readonly string[] = [],
) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-stuff-rtk-'));
  const agent = join(directory, 'agent');
  await mkdir(agent);
  let tool = '';
  let args = '{}';
  let turn = 0;
  let result = '';
  let reloads = 0;
  let offered: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (
        request.method !== 'POST' ||
        new URL(request.url).pathname !== '/v1/chat/completions'
      )
        return new Response(null, {status: 404});
      const body = Schema.decodeUnknownSync(Request)(await request.json());
      const reply = await modelReply?.(body, request.signal);
      if (reply !== undefined) return reply;
      offered = body.tools?.map(tool => tool.function.name) ?? [];
      const last = body.messages.at(-1);
      const finished = last?.role === 'tool' || tool === '';
      if (last?.role === 'tool')
        result = Schema.is(Schema.String)(last.content)
          ? last.content
          : JSON.stringify(last.content);
      const delta = finished
        ? {content: `RTK_TURN_${turn}_DONE`}
        : {
            tool_calls: [
              {
                index: 0,
                id: `rtk_${turn}`,
                type: 'function',
                function: {name: tool, arguments: args},
              },
            ],
          };
      const chunk = {
        id: `chat_${turn}`,
        object: 'chat.completion.chunk',
        created: 1,
        model: 'fixture',
        choices: [{index: 0, delta, finish_reason: null}],
      };
      return new Response(
        `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({
          ...chunk,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: finished ? 'stop' : 'tool_calls',
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
        {headers: {'content-type': 'text/event-stream'}},
      );
    },
  });
  let driver: TerminalControl | undefined;
  let terminal: Session | undefined;
  async function close() {
    try {
      await terminal?.stop();
    } finally {
      try {
        await driver?.close();
      } finally {
        await server.stop(true);
        await rm(directory, {recursive: true, force: true});
      }
    }
  }
  try {
    await writeFile(join(agent, 'pi-stuff.json'), configuration);
    await writeFile(
      join(agent, 'models.json'),
      JSON.stringify({
        providers: {
          fixture: {
            baseUrl: `${server.url}v1`,
            api: 'openai-completions',
            apiKey: 'offline-fixture',
            models: [{id: 'fixture'}, {id: 'naming'}],
          },
        },
      }),
    );
    driver = await TerminalControl.make({
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
    const launchOptions: LaunchOptions = {
      command: [
        process.env.PI_TEST_HOST ?? process.execPath,
        ...(process.env.PI_TEST_HOST
          ? []
          : [
              resolve(
                'node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
              ),
            ]),
        '--offline',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--no-themes',
        '--no-context-files',
        '--no-approve',
        ...(profile === 'web'
          ? ['--no-builtin-tools']
          : ['--tools', 'bash,read']),
        '--provider',
        'fixture',
        '--model',
        'fixture',
        '--tui-mode',
        mode,
        '-e',
        resolve('.'),
        '-e',
        resolve('tests/system/fixtures/host-controls.ts'),
        ...(extraExtension === undefined ? [] : ['-e', extraExtension]),
        ...startupArgs,
      ],
      cwd: directory,
      viewport:
        profile === 'web' ? {cols: 140, rows: 42} : {cols: 100, rows: 30},
      inheritEnv: false,
      env: {
        HOME: directory,
        PATH: '/usr/bin:/bin',
        TERM: 'xterm-256color',
        PI_CODING_AGENT_DIR: agent,
        PI_CODING_AGENT_SESSION_DIR: join(directory, 'sessions'),
        PI_OFFLINE: '1',
        PI_TELEMETRY: '0',
        EXA_API_KEY: profile === 'web' ? 'fixture-env-key' : '',
        NO_PROXY: '127.0.0.1,localhost',
        XDG_CONFIG_HOME: join(directory, 'config'),
        XDG_DATA_HOME: join(directory, 'data'),
        RTK_DB_PATH: join(directory, 'rtk.db'),
        RTK_TEE: '0',
        RTK_TELEMETRY_DISABLED: '1',
        MISE_OFFLINE: '1',
        MISE_NO_HOOKS: '1',
        MISE_AUTO_INSTALL: '0',
        MISE_DATA_DIR: join(directory, 'mise-data'),
        MISE_INSTALLS_DIR:
          process.env.PI_TEST_MISE_INSTALLS ?? join(directory, 'mise-installs'),
        MISE_GLOBAL_CONFIG_FILE:
          process.env.PI_TEST_MISE_CONFIG ?? join(directory, 'mise.toml'),
        MISE_CONFIG_DIR: join(directory, 'mise-config'),
        MISE_SYSTEM_CONFIG_DIR: join(directory, 'mise-system'),
        MISE_CACHE_DIR: join(directory, 'mise-cache'),
        MISE_STATE_DIR: join(directory, 'mise-state'),
      },
    };
    terminal = await driver.launch(launchOptions);
    let screen = terminal;
    await screen.screen.waitForText('fixture', {timeoutMs: 15000});
    async function command(text: string) {
      // Trailing space dismisses exact argument completion before submission.
      await screen.keyboard.type(text.includes(' ') ? `${text} ` : text);
      await screen.keyboard.press('Enter');
    }
    async function start(name: string, parameters: string) {
      tool = name;
      args = parameters;
      result = '';
      turn++;
      await screen.keyboard.type(`Run RTK turn ${turn}`);
      await screen.keyboard.press('Enter');
    }
    return {
      directory,
      agent,
      get terminal() {
        return screen;
      },
      async restart(args: readonly string[], waitForTui = true) {
        await screen.stop();
        await rm(join(directory, 'observed-session-name'), {force: true});
        if (!driver) throw new Error('Fixture driver is closed');
        terminal = await driver.launch({
          ...launchOptions,
          command: [...launchOptions.command, ...args],
        });
        screen = terminal;
        if (waitForTui)
          await screen.screen.waitForText('fixture', {timeoutMs: 15000});
      },
      close,
      command,
      async waitForName(name: string) {
        await screen.screen.waitUntil(
          async () => {
            try {
              return (
                (await readFile(
                  join(directory, 'observed-session-name'),
                  'utf8',
                )) === name
              );
            } catch {
              return false;
            }
          },
          {timeoutMs: 4000},
        );
      },
      start,
      offered: () => offered,
      async invoke(name: string, parameters: string) {
        await start(name, parameters);
        try {
          await screen.screen.waitForText(`RTK_TURN_${turn}_DONE`, {
            timeoutMs: 15000,
          });
        } catch (error) {
          console.error(await screen.screen.text());
          console.error(await screen.logs.text());
          throw error;
        }
        return result;
      },
      async reload() {
        reloads++;
        await command(`/host-reload ${reloads}`);
        await screen.screen.waitUntil(
          async () => {
            try {
              return (
                (await readFile(join(directory, 'reload-ready'), 'utf8')) ===
                String(reloads)
              );
            } catch {
              return false;
            }
          },
          {timeoutMs: 15000},
        );
      },
    };
  } catch (error) {
    try {
      if (terminal) console.error(await terminal.logs.text());
    } catch (captureError) {
      console.error(`Could not capture Pi startup: ${String(captureError)}`);
    } finally {
      await close();
    }
    throw error;
  }
}
