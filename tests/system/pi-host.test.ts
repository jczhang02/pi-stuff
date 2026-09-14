import {expect, test} from 'bun:test';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  readdir,
  rm,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {TerminalControl} from '@kitlangton/terminal-control';
import {Schema} from 'effect';

const RequestBody = Schema.Struct({
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

// A deterministic model emits real tool calls; Pi loads the unmodified entrypoint.
// The fixture never substitutes registration, execution, storage or extraction.
test.each([['regular'], ['fullscreen']] as const)(
  'Pi terminal (%s): fetch/find, reload, new session, switches and invalid configuration',
  async tuiMode => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-stuff-host-'));
    const agent = join(directory, 'agent');
    await mkdir(agent);
    let requestedTool = 'fetch_content';
    let argumentsJson = '';
    let resultText = '';
    let offered: string[] = [];
    let turn = 0;
    let slowRequests = 0;
    let slowAborts = 0;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (request.method === 'GET' && path === '/slow') {
          slowRequests++;
          return new Promise<Response>(resolveResponse => {
            request.signal.addEventListener(
              'abort',
              () => {
                slowAborts++;
                resolveResponse(new Response(null, {status: 499}));
              },
              {once: true},
            );
          });
        }
        if (request.method === 'GET' && path === '/page') {
          return new Response(
            'HOST_CONTENT 中文 needle ' +
              'body '.repeat(2000) +
              'HIDDEN_TAIL_MARKER',
            {headers: {'content-type': 'text/plain'}},
          );
        }
        if (request.method !== 'POST' || path !== '/v1/chat/completions')
          return new Response(null, {status: 404});
        const body = Schema.decodeUnknownSync(RequestBody)(
          await request.json(),
        );
        offered = body.tools?.map(tool => tool.function.name) ?? [];
        const last = body.messages.at(-1);
        const toolResult = last?.role === 'tool';
        if (toolResult)
          resultText = Schema.is(Schema.String)(last.content)
            ? last.content
            : JSON.stringify(last.content);
        const delta =
          toolResult || requestedTool === ''
            ? {content: `HOST_TURN_${turn}_DONE`}
            : {
                tool_calls: [
                  {
                    index: 0,
                    id: `call_${turn}`,
                    type: 'function',
                    function: {name: requestedTool, arguments: argumentsJson},
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
          `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({...chunk, choices: [{index: 0, delta: {}, finish_reason: toolResult || requestedTool === '' ? 'stop' : 'tool_calls'}]})}\n\ndata: [DONE]\n\n`,
          {headers: {'content-type': 'text/event-stream'}},
        );
      },
    });
    try {
      const reloadReady = join(directory, 'reload-ready');
      await writeFile(reloadReady, '');
      for (const [path, method] of [
        ['/', 'GET'],
        ['/v1/chat/completions', 'GET'],
        ['/unrelated', 'POST'],
        ['/page', 'POST'],
        ['/slow', 'POST'],
      ] as const) {
        const probe = await fetch(new URL(path, server.url), {
          method,
          signal: AbortSignal.timeout(1000),
        });
        expect(probe.status).toBe(404);
        await probe.body?.cancel();
      }
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
      const terminalControl = await TerminalControl.make({
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
      try {
        const terminal = await terminalControl.launch({
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
            '--no-builtin-tools',
            '--provider',
            'fixture',
            '--model',
            'fixture',
            '--tui-mode',
            tuiMode,
            '-e',
            resolve('.'),
            '-e',
            resolve('tests/system/fixtures/host-controls.ts'),
          ],
          cwd: directory,
          viewport: {cols: 140, rows: 42},
          env: {
            PI_CODING_AGENT_DIR: agent,
            PI_CODING_AGENT_SESSION_DIR: join(directory, 'sessions'),
            PI_OFFLINE: '1',
            PI_TELEMETRY: '0',
            EXA_API_KEY: 'fixture-env-key',
            NO_PROXY: '127.0.0.1,localhost',
          },
        });
        try {
          await terminal.screen.waitForText('fixture', {timeoutMs: 15000});
          const startup = await terminal.screen.text();
          expect(
            startup.split('[Extensions]\n')[1]?.split('\n\n')[0],
          ).toContain(basename(resolve('.')));
          async function invoke(tool: string, args: string) {
            requestedTool = tool;
            argumentsJson = args;
            resultText = '';
            turn++;
            await terminal.keyboard.type(`Run fixture turn ${turn}`);
            await terminal.keyboard.press('Enter');
            await terminal.screen.waitForText(`HOST_TURN_${turn}_DONE`, {
              timeoutMs: 15000,
            });
            return resultText;
          }
          async function auth(label: string, source: string) {
            await terminal.keyboard.type(`/host-auth ${label}`);
            await terminal.keyboard.press('Enter');
            await terminal.screen.waitForText(
              `HOST_AUTH_${label}:${source}:exaModels=0:model=fixture/fixture`,
              {timeoutMs: 5000},
            );
          }
          let reloadCount = 0;
          async function reload() {
            reloadCount++;
            await terminal.keyboard.type(`/host-reload ${reloadCount}`);
            await terminal.keyboard.press('Enter');
            await terminal.screen.waitUntil(
              async () =>
                (await readFile(reloadReady, 'utf8')) === String(reloadCount),
              {timeoutMs: 15000},
            );
          }
          await auth('before', 'env');
          await terminal.keyboard.type('/login exa');
          await terminal.screen.waitForText('/login exa', {timeoutMs: 5000});
          await terminal.keyboard.press('Escape'); // Close command completion before submitting.
          await terminal.screen.capture({settleMs: 50});
          await terminal.keyboard.press('Enter');
          await terminal.screen.waitForText('Enter Exa API key', {
            timeoutMs: 5000,
          });
          await terminal.keyboard.type('fixture-stored-key');
          await terminal.keyboard.press('Enter');
          await terminal.screen.waitForText('Saved API key for Exa', {
            timeoutMs: 5000,
          });
          await auth('saved', 'stored');
          const authPath = join(agent, 'auth.json');
          expect(await readFile(authPath, 'utf8')).toContain(
            'fixture-stored-key',
          );
          expect((await stat(authPath)).mode & 0o777).toBe(0o600);
          await writeFile(
            authPath,
            JSON.stringify({exa: {type: 'api_key', key: 'fixture-next-key'}}),
          );
          await auth('edited', 'changed');
          await writeFile(
            authPath,
            JSON.stringify({
              exa: {
                type: 'api_key',
                key: 'fixture-malformed\ncredential-marker',
              },
            }),
          );
          const authFailure = await invoke(
            'web_search',
            JSON.stringify({queries: ['fixture authentication check']}),
          );
          expect(authFailure).toContain('error: authentication:');
          expect(authFailure).not.toContain('fixture-malformed');
          expect(authFailure).not.toContain('credential-marker');
          await writeFile(
            authPath,
            JSON.stringify({exa: {type: 'api_key', key: 'fixture-next-key'}}),
          );
          const first = await invoke(
            'fetch_content',
            JSON.stringify({urls: [`${server.url}page`], mode: 'raw'}),
          );
          expect(first).toContain('HOST_CONTENT 中文 needle');
          expect(offered.toSorted()).toEqual([
            'fetch_content',
            'get_search_content',
            'web_search',
          ]);
          const sessions = join(directory, 'sessions');
          const sessionFiles = (
            await readdir(sessions, {recursive: true})
          ).filter(file => file.endsWith('.jsonl'));
          expect(sessionFiles.length).toBeGreaterThan(0);
          for (const file of sessionFiles) {
            const contents = await readFile(join(sessions, file), 'utf8');
            for (const hidden of [
              'HIDDEN_TAIL_MARKER',
              'fixture-stored-key',
              'fixture-next-key',
              'fixture-malformed',
              'credential-marker',
            ])
              expect(contents).not.toContain(hidden);
          }
          const id = /contentId: ([^\s]+)/.exec(first)?.[1];
          expect(id).toBeDefined();
          expect(
            await invoke(
              'get_search_content',
              JSON.stringify({contentId: id, find: 'NEEDLE'}),
            ),
          ).toContain('needle');
          expect(
            await invoke(
              'get_search_content',
              JSON.stringify({contentId: id, offset: 8000}),
            ),
          ).toContain('HIDDEN_TAIL_MARKER');
          await terminal.keyboard.type(
            '/host-tools get_search_content,web_search',
          );
          await terminal.keyboard.press('Enter');
          await terminal.screen.waitForText(
            'HOST_SELECTION:get_search_content,web_search',
            {
              timeoutMs: 5000,
            },
          );
          expect(
            await invoke(
              'get_search_content',
              JSON.stringify({contentId: id, find: 'needle'}),
            ),
          ).toContain('needle');
          expect(offered.toSorted()).toEqual([
            'get_search_content',
            'web_search',
          ]);
          await reload();
          expect(
            await invoke('get_search_content', JSON.stringify({contentId: id})),
          ).toContain('fetch again');
          await auth('reloaded', 'changed');
          await terminal.keyboard.type('/logout');
          await terminal.keyboard.press('Enter');
          await terminal.screen.waitForText('Select provider to logout', {
            timeoutMs: 5000,
          });
          await terminal.keyboard.press('Enter');
          await terminal.screen.waitForText('Removed stored API key for Exa', {
            timeoutMs: 5000,
          });
          await auth('removed', 'env');
          expect(await readFile(authPath, 'utf8')).not.toContain(
            'fixture-next-key',
          );
          const second = await invoke(
            'fetch_content',
            JSON.stringify({urls: [`${server.url}page`], mode: 'raw'}),
          );
          const secondId = /contentId: ([^\s]+)/.exec(second)?.[1];
          expect(secondId).toBeDefined();
          await terminal.keyboard.type('/new');
          await terminal.keyboard.press('Enter');
          await terminal.screen.waitForText('New session started', {
            timeoutMs: 15000,
          });
          expect(
            await invoke(
              'get_search_content',
              JSON.stringify({contentId: secondId}),
            ),
          ).toContain('fetch again');
          await writeFile(
            join(agent, 'pi-stuff.json'),
            JSON.stringify({tools: {fetch_content: false}}),
          );
          await reload();
          await invoke('', '{}');
          expect(offered.toSorted()).toEqual([
            'get_search_content',
            'web_search',
          ]);
          await terminal.keyboard.type(
            '/host-tools fetch_content,get_search_content,web_search',
          );
          await terminal.keyboard.press('Enter');
          await invoke('', '{}');
          expect(offered.toSorted()).toEqual([
            'get_search_content',
            'web_search',
          ]);
          await writeFile(join(agent, 'pi-stuff.json'), '{invalid');
          await reload();
          await terminal.screen.waitForText(
            'Invalid or unreadable pi-stuff.json',
            {
              timeoutMs: 15000,
            },
          );
          await invoke('', '{}');
          expect(offered).toEqual([]);
          await writeFile(join(agent, 'pi-stuff.json'), '{}');
          await reload();
          await invoke('', '{}');
          expect(offered.toSorted()).toEqual([
            'fetch_content',
            'get_search_content',
            'web_search',
          ]);
          requestedTool = 'fetch_content';
          argumentsJson = JSON.stringify({
            urls: Array.from({length: 5}, () => `${server.url}slow`),
          });
          turn++;
          await terminal.keyboard.type(`Cancel fixture turn ${turn}`);
          await terminal.keyboard.press('Enter');
          await terminal.screen.waitUntil(() => slowRequests === 3, {
            timeoutMs: 5000,
          });
          await terminal.keyboard.press('Escape');
          await terminal.screen.waitUntil(() => slowAborts === 3, {
            timeoutMs: 5000,
          });
          expect(slowRequests).toBe(3);
          expect(slowAborts).toBe(3);
          await invoke('', '{}');
          expect(slowRequests).toBe(3);
          await terminal.keyboard.press('Control+D');
          const exit = await terminal.waitForExit({timeoutMs: 5000});
          expect(exit.reason).toBe('exited');
        } catch (error) {
          try {
            console.error(
              (
                await terminal.screen.capture({
                  allowIncomplete: true,
                  settleMs: 0,
                  deadlineMs: 0,
                })
              ).text,
            );
          } catch (captureError) {
            console.error(
              `Could not capture Pi terminal output: ${String(captureError)}`,
            );
          }
          throw error;
        } finally {
          await terminal.stop();
        }
      } finally {
        await terminalControl.close();
      }
    } finally {
      await server.stop(true);
      await rm(directory, {recursive: true, force: true});
    }
  },
  90000,
);
