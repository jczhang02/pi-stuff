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
import {join, resolve} from 'node:path';
import {Schema} from 'effect';
import {launchTerminal} from 'tuistory';

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
test('Pi terminal: fetch/find, reload, new session, switches and invalid configuration', async () => {
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
      if (new URL(request.url).pathname === '/slow') {
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
      if (new URL(request.url).pathname === '/page') {
        return new Response(
          'HOST_CONTENT 中文 needle ' +
            'body '.repeat(2000) +
            'HIDDEN_TAIL_MARKER',
          {headers: {'content-type': 'text/plain'}},
        );
      }
      if (
        request.method !== 'POST' ||
        !new URL(request.url).pathname.endsWith('/chat/completions')
      )
        return new Response('not found', {status: 404});
      const body = Schema.decodeUnknownSync(RequestBody)(await request.json());
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
    const terminal = await launchTerminal({
      command: process.env.PI_TEST_HOST ?? process.execPath,
      args: [
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
        '-e',
        resolve('src/pi/index.ts'),
        '-e',
        resolve('tests/system/fixtures/host-controls.ts'),
      ],
      cwd: directory,
      cols: 140,
      rows: 42,
      env: {
        PI_CODING_AGENT_DIR: agent,
        PI_CODING_AGENT_SESSION_DIR: join(directory, 'sessions'),
        PI_OFFLINE: '1',
        PI_TELEMETRY: '0',
        EXA_API_KEY: 'fixture-env-key',
        HTTP_PROXY: undefined,
        HTTPS_PROXY: undefined,
        ALL_PROXY: undefined,
        http_proxy: undefined,
        https_proxy: undefined,
        all_proxy: undefined,
        NO_PROXY: '127.0.0.1,localhost',
      },
    });
    try {
      await terminal.waitForText('fixture', {timeout: 15000});
      async function invoke(tool: string, args: string) {
        requestedTool = tool;
        argumentsJson = args;
        resultText = '';
        turn++;
        await terminal.type(`Run fixture turn ${turn}`);
        await terminal.press('enter');
        await terminal.text({
          timeout: 15000,
          waitFor: () =>
            terminal
              .getTerminalData()
              .lines.slice(-42)
              .map(line => line.spans.map(span => span.text).join(''))
              .join('\n')
              .includes(`HOST_TURN_${turn}_DONE`),
        });
        return resultText;
      }
      async function auth(label: string, source: string) {
        await terminal.type(`/host-auth ${label}`);
        await terminal.press('enter');
        await terminal.waitForText(
          `HOST_AUTH_${label}:${source}:exaModels=0:model=fixture/fixture`,
          {timeout: 5000},
        );
      }
      await auth('before', 'env');
      await terminal.type('/login exa');
      await terminal.press('esc'); // Close command completion before submitting.
      await terminal.press('enter');
      await terminal.waitForText('Enter Exa API key', {timeout: 5000});
      await terminal.type('fixture-stored-key');
      await terminal.press('enter');
      await terminal.waitForText('Saved API key for Exa', {timeout: 5000});
      await auth('saved', 'stored');
      const authPath = join(agent, 'auth.json');
      expect(await readFile(authPath, 'utf8')).toContain('fixture-stored-key');
      expect((await stat(authPath)).mode & 0o777).toBe(0o600);
      await writeFile(
        authPath,
        JSON.stringify({exa: {type: 'api_key', key: 'fixture-next-key'}}),
      );
      await auth('edited', 'changed');
      const first = await invoke(
        'fetch_content',
        JSON.stringify({urls: [`${server.url}page`], mode: 'raw'}),
      );
      expect(first).toContain('HOST_CONTENT 中文 needle');
      expect(offered.toSorted()).toEqual([
        'await_subagent',
        'fetch_content',
        'get_search_content',
        'reply_subagent',
        'resume_subagent',
        'steer_subagent',
        'subagent',
        'subagent_cancel',
        'subagent_result',
        'subagent_status',
        'web_search',
      ]);
      const sessions = join(directory, 'sessions');
      const sessionFiles = (await readdir(sessions, {recursive: true})).filter(
        file => file.endsWith('.jsonl'),
      );
      expect(sessionFiles.length).toBeGreaterThan(0);
      for (const file of sessionFiles) {
        expect(await readFile(join(sessions, file), 'utf8')).not.toContain(
          'HIDDEN_TAIL_MARKER',
        );
        expect(await readFile(join(sessions, file), 'utf8')).not.toContain(
          'fixture-stored-key',
        );
        expect(await readFile(join(sessions, file), 'utf8')).not.toContain(
          'fixture-next-key',
        );
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
      await terminal.type('/host-tools get_search_content,web_search');
      await terminal.press('enter');
      await terminal.waitForText(
        'HOST_SELECTION:get_search_content,web_search',
        {
          timeout: 5000,
        },
      );
      expect(
        await invoke(
          'get_search_content',
          JSON.stringify({contentId: id, find: 'needle'}),
        ),
      ).toContain('needle');
      expect(offered.toSorted()).toEqual(['get_search_content', 'web_search']);
      await terminal.type('/reload');
      await terminal.press('enter');
      await terminal.waitForText('Reloaded', {timeout: 15000});
      expect(
        await invoke('get_search_content', JSON.stringify({contentId: id})),
      ).toContain('fetch again');
      await auth('reloaded', 'changed');
      await terminal.type('/logout');
      await terminal.press('enter');
      await terminal.waitForText('Select provider to logout', {timeout: 5000});
      await terminal.press('enter');
      await terminal.waitForText('Removed stored API key for Exa', {
        timeout: 5000,
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
      await terminal.type('/new');
      await terminal.press('enter');
      await terminal.waitForText('fixture', {timeout: 15000});
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
      await terminal.type('/reload');
      await terminal.press('enter');
      await terminal.waitForText('Reloaded', {timeout: 15000});
      await invoke('', '{}');
      expect(offered.toSorted()).toEqual([
        'await_subagent',
        'get_search_content',
        'reply_subagent',
        'resume_subagent',
        'steer_subagent',
        'subagent',
        'subagent_cancel',
        'subagent_result',
        'subagent_status',
        'web_search',
      ]);
      await terminal.type(
        '/host-tools fetch_content,get_search_content,web_search',
      );
      await terminal.press('enter');
      await invoke('', '{}');
      expect(offered.toSorted()).toEqual(['get_search_content', 'web_search']);
      await writeFile(join(agent, 'pi-stuff.json'), '{invalid');
      await terminal.type('/reload');
      await terminal.press('enter');
      await terminal.waitForText('Invalid or unreadable pi-stuff.json', {
        timeout: 15000,
      });
      await invoke('', '{}');
      expect(offered).toEqual([]);
      await writeFile(join(agent, 'pi-stuff.json'), '{}');
      await terminal.type('/reload');
      await terminal.press('enter');
      await terminal.waitForText('Reloaded', {timeout: 15000});
      await invoke('', '{}');
      expect(offered.toSorted()).toEqual([
        'await_subagent',
        'fetch_content',
        'get_search_content',
        'reply_subagent',
        'resume_subagent',
        'steer_subagent',
        'subagent',
        'subagent_cancel',
        'subagent_result',
        'subagent_status',
        'web_search',
      ]);
      requestedTool = 'fetch_content';
      argumentsJson = JSON.stringify({
        urls: Array.from({length: 5}, () => `${server.url}slow`),
      });
      turn++;
      await terminal.type(`Cancel fixture turn ${turn}`);
      await terminal.press('enter');
      await terminal.text({timeout: 5000, waitFor: () => slowRequests === 3});
      await terminal.press('esc');
      await terminal.text({timeout: 5000, waitFor: () => slowAborts === 3});
      expect(slowRequests).toBe(3);
      expect(slowAborts).toBe(3);
      await invoke('', '{}');
      expect(slowRequests).toBe(3);
    } catch (error) {
      console.error(await terminal.text({immediate: true}));
      throw error;
    } finally {
      try {
        terminal.killProcess();
        expect(await terminal.waitForExit(5000)).toBe(true);
      } finally {
        terminal.close();
      }
    }
  } finally {
    await server.stop(true);
    await rm(directory, {recursive: true, force: true});
  }
}, 90000);
