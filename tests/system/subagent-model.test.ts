import {expect, test} from 'bun:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Schema} from 'effect';
import {launchPi} from './fixtures/pi-terminal';

test('an unusable requested model falls back with an explicit explanation', async () => {
  let probes = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      probes++;
      return Response.json(
        {
          error: {
            message: 'Model unavailable for this account',
            type: 'invalid_request_error',
          },
        },
        {status: 400},
      );
    },
  });
  const directory = await mkdtemp(join(tmpdir(), 'pi-model-fixture-'));
  const extension = join(directory, 'provider.ts');
  let host: Awaited<ReturnType<typeof launchPi>> | undefined;
  try {
    await writeFile(
      extension,
      `import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
export default function(pi: ExtensionAPI) {
  pi.registerProvider('unavailable-fixture', {
    baseUrl: ${JSON.stringify(`${server.url}v1`)}, api: 'openai-completions', apiKey: 'offline-fixture',
    models: [{id: 'unavailable', name: 'Unavailable fixture', reasoning: false, input: ['text'],
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 8192, maxTokens: 1024}],
  });
}
`,
    );
    host = await launchPi(
      '{}',
      extension,
      'subagent',
      'fullscreen',
      request => {
        if (request.tools?.some(tool => tool.function.name === 'subagent'))
          return undefined;
        return {type: 'content', content: 'FALLBACK_REPORT'};
      },
    );
    const serialized = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        agent: 'reviewer',
        task: 'Inspect the fallback behavior.',
        model: 'unavailable-fixture/unavailable',
        autoAwait: true,
        notifyPerTask: false,
      }),
    );
    const result = Schema.decodeUnknownSync(
      Schema.Struct({
        status: Schema.String,
        tasks: Schema.Array(
          Schema.Struct({
            model: Schema.String,
            provider: Schema.String,
            finalText: Schema.String,
            configurationNotes: Schema.Array(Schema.String),
          }),
        ),
      }),
    )(JSON.parse(serialized));
    expect(probes).toBeGreaterThan(0);
    expect(result.status).toBe('completed');
    expect(result.tasks[0]?.model).toBe('fixture');
    expect(result.tasks[0]?.provider).toBe('fixture');
    expect(result.tasks[0]?.finalText).toBe('FALLBACK_REPORT');
    expect(result.tasks[0]?.configurationNotes.join('\n')).toContain(
      'failed preflight',
    );
    expect(result.tasks[0]?.configurationNotes.join('\n')).toContain(
      'using parent model fixture/fixture',
    );
  } finally {
    await host?.close();
    await server.stop(true);
    await rm(directory, {recursive: true, force: true});
  }
}, 60000);
