import {mkdtemp, mkdir, writeFile, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {TerminalControl, type Session} from '@kitlangton/terminal-control';
import {Schema} from 'effect';

const Request = Schema.Struct({
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

// The real host loads the product entrypoint. Only the external model is deterministic.
export async function launchPi(
  configuration = '{}',
  extraExtension?: string,
  profile: 'rtk' | 'web' | 'ui' = 'rtk',
  mode: 'regular' | 'fullscreen' = 'fullscreen',
) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-stuff-rtk-'));
  const agent = join(directory, 'agent');
  await mkdir(agent);
  let tool = '';
  let args = '{}';
  let turn = 0;
  let result = '';
  let response: {text: string; thinking: string} | undefined;
  let sentAssistant = '';
  let reloads = 0;
  let offered: string[] = [];
  let remaining: {name: string; parameters: string}[] = [];
  let simultaneous: {name: string; parameters: string}[] = [];
  let callIndex = 0;
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
      offered = body.tools?.map(tool => tool.function.name) ?? [];
      const previous = body.messages.findLast(
        message => message.role === 'assistant',
      );
      sentAssistant = JSON.stringify(previous?.content ?? null);
      const last = body.messages.at(-1);
      const next = last?.role === 'tool' ? remaining.shift() : undefined;
      if (next) {
        tool = next.name;
        args = next.parameters;
        callIndex++;
      }
      const finished = (last?.role === 'tool' && !next) || tool === '';
      if (last?.role === 'tool')
        result = Schema.is(Schema.String)(last.content)
          ? last.content
          : JSON.stringify(last.content);
      const delta = finished
        ? {content: response?.text ?? `RTK_TURN_${turn}_DONE`}
        : {
            tool_calls: [{name: tool, parameters: args}, ...simultaneous].map(
              (call, index) => ({
                index,
                id: `rtk_${turn}_${callIndex}_${index}`,
                type: 'function',
                function: {name: call.name, arguments: call.parameters},
              }),
            ),
          };
      const chunk = {
        id: `chat_${turn}`,
        object: 'chat.completion.chunk',
        created: 1,
        model: 'fixture',
        choices: [{index: 0, delta, finish_reason: null}],
      };
      const thinking =
        finished && response?.thinking
          ? `data: ${JSON.stringify({
              ...chunk,
              choices: [
                {
                  index: 0,
                  delta: {reasoning_content: response.thinking},
                  finish_reason: null,
                },
              ],
            })}\n\n`
          : '';
      return new Response(
        `${thinking}data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({
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
            models: [{id: 'fixture'}],
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
    terminal = await driver.launch({
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
          : [
              '--tools',
              profile === 'ui'
                ? 'bash,read,write,edit,grep,find,ls,web_search,fetch_content,get_search_content'
                : 'bash,read',
            ]),
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
    });
    const screen = terminal;
    await screen.screen.waitForText('fixture', {timeoutMs: 15000});
    async function command(text: string) {
      // Trailing space dismisses exact argument completion before submission.
      await screen.keyboard.type(text.includes(' ') ? `${text} ` : text);
      await screen.keyboard.press('Enter');
    }
    async function submit() {
      result = '';
      turn++;
      await screen.keyboard.type(`Run RTK turn ${turn}`);
      await screen.keyboard.press('Enter');
    }
    async function start(
      name: string,
      parameters: string,
      next: {name: string; parameters: string}[] = [],
      parallel: {name: string; parameters: string}[] = [],
    ) {
      remaining = [...next];
      simultaneous = [...parallel];
      callIndex = 0;
      tool = name;
      args = parameters;
      response = undefined;
      await submit();
    }
    return {
      directory,
      agent,
      terminal: screen,
      close,
      command,
      start,
      sentAssistant: () => sentAssistant,
      async startResponse(text: string, thinking = '') {
        tool = '';
        remaining = [];
        simultaneous = [];
        response = {text, thinking};
        await submit();
      },
      async startParallel(calls: {name: string; parameters: string}[]) {
        const [first, ...parallel] = calls;
        if (!first) throw new Error('A batch needs at least one call');
        await start(first.name, first.parameters, [], parallel);
      },
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
      async sequence(calls: {name: string; parameters: string}[]) {
        const [first, ...next] = calls;
        if (!first) throw new Error('A sequence needs at least one call');
        await start(first.name, first.parameters, next);
        await screen.screen.waitForText(`RTK_TURN_${turn}_DONE`, {
          timeoutMs: 15000,
        });
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
