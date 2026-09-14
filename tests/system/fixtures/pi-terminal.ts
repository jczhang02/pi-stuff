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
});

// The real host loads the product entrypoint. Only the external model is deterministic.
export async function launchPi(configuration = '{}') {
  const directory = await mkdtemp(join(tmpdir(), 'pi-stuff-rtk-'));
  const agent = join(directory, 'agent');
  await mkdir(agent);
  let tool = '';
  let args = '{}';
  let turn = 0;
  let result = '';
  let reloads = 0;
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
            models: [{id: 'fixture'}],
          },
        },
      }),
    );
    driver = await TerminalControl.make({
      binaryPath: resolve('node_modules/.bin/termctrl'),
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
        '--tools',
        'bash,read',
        '--provider',
        'fixture',
        '--model',
        'fixture',
        '--tui-mode',
        'fullscreen',
        '-e',
        resolve('.'),
        '-e',
        resolve('tests/system/fixtures/host-controls.ts'),
      ],
      cwd: directory,
      viewport: {cols: 100, rows: 30},
      inheritEnv: false,
      env: {
        HOME: directory,
        PATH: '/usr/bin:/bin',
        TERM: 'xterm-256color',
        PI_CODING_AGENT_DIR: agent,
        PI_CODING_AGENT_SESSION_DIR: join(directory, 'sessions'),
        PI_OFFLINE: '1',
        PI_TELEMETRY: '0',
        NO_PROXY: '127.0.0.1,localhost',
      },
    });
    const screen = terminal;
    await screen.screen.waitForText('fixture', {timeoutMs: 15000});
    async function command(text: string) {
      await screen.keyboard.type(text);
      await screen.keyboard.press('Escape');
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
      terminal: screen,
      close,
      command,
      start,
      async invoke(name: string, parameters: string) {
        await start(name, parameters);
        await screen.screen.waitForText(`RTK_TURN_${turn}_DONE`, {
          timeoutMs: 15000,
        });
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
    await close();
    throw error;
  }
}
