// Throwaway launcher: isolated Pi settings/session plus a local dialogue fixture.
import {Effect} from 'effect';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';

await Effect.runPromise(
  Effect.tryPromise({
    try: async () => {
      const directory = await mkdtemp(join(tmpdir(), 'pi-autoname-native-'));
      const agent = join(directory, 'agent');
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch() {
          const chunk = {
            id: 'oauth-research',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'gpt-6-astra',
            choices: [
              {
                index: 0,
                delta: {
                  content:
                    'I will compare authorization flows, token refresh behavior and migration constraints across the OAuth providers.',
                },
                finish_reason: null,
              },
            ],
          };
          return new Response(
            `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({...chunk, choices: [{index: 0, delta: {}, finish_reason: 'stop'}]})}\n\ndata: [DONE]\n\n`,
            {headers: {'content-type': 'text/event-stream'}},
          );
        },
      });
      try {
        await mkdir(agent);
        await writeFile(
          join(agent, 'settings.json'),
          JSON.stringify({
            theme: process.env.PI_NATIVE_THEME ?? 'dark',
            quietStartup: true,
          }),
        );
        await writeFile(
          join(agent, 'models.json'),
          JSON.stringify({
            providers: {
              openai: {
                baseUrl: `${server.url}v1`,
                api: 'openai-completions',
                apiKey: 'local-scenario',
                models: [
                  {id: 'gpt-6-astra'},
                  {id: 'gpt-5.6-luna'},
                  {id: 'gpt-5.6-sol'},
                ],
              },
            },
          }),
        );
        const child = Bun.spawn(
          [
            process.env.PI_NATIVE_HOST ?? '/opt/bin/pi',
            '--offline',
            '--no-extensions',
            '--no-skills',
            '--no-prompt-templates',
            '--no-themes',
            '--no-context-files',
            '--no-approve',
            '--no-builtin-tools',
            '--provider',
            'openai',
            '--model',
            'gpt-6-astra',
            '--tui-mode',
            'fullscreen',
            '-e',
            resolve(import.meta.dir, '..'),
          ],
          {
            cwd: directory,
            stdin: 'inherit',
            stdout: 'inherit',
            stderr: 'inherit',
            env: {
              HOME: directory,
              PATH: '/usr/bin:/bin',
              TERM: 'xterm-256color',
              PI_CODING_AGENT_DIR: agent,
              PI_OFFLINE: '1',
              PI_TELEMETRY: '0',
              NO_PROXY: '127.0.0.1,localhost',
            },
          },
        );
        process.exitCode = await child.exited;
      } finally {
        await server.stop(true);
        await rm(directory, {recursive: true, force: true});
      }
    },
    catch: cause =>
      new Error('Could not run the native AutoName prototype.', {cause}),
  }),
);
