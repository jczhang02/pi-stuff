import {expect, test} from 'bun:test';
import {Effect} from 'effect';
import {createWebTools} from '../../src/web';

const openai = () =>
  Effect.succeed({model: 'fixture', codex: false, headers: new Headers()});

test('search cancellation stops active and queued queries without fallback', async () => {
  const started = Promise.withResolvers<void>();
  const hosts: string[] = [];
  let stopped = 0;
  const web = createWebTools(
    {
      request: request => {
        hosts.push(request.url.hostname);
        if (hosts.length === 3) started.resolve();
        return Effect.never.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              stopped++;
            }),
          ),
        );
      },
    },
    {},
    {openai, exa: () => Effect.succeed('fixture')},
  );
  const controller = new AbortController();
  const result = web.webSearch.execute(
    'search',
    {queries: ['one', 'two', 'three', 'four', 'five']},
    controller.signal,
  );
  await started.promise;
  controller.abort();
  await expect(result).rejects.toThrow();
  expect(hosts).toEqual(['api.openai.com', 'api.openai.com', 'api.openai.com']);
  expect(stopped).toBe(3);
  await expect(
    web.webSearch.execute('before', {queries: ['none']}, AbortSignal.abort()),
  ).rejects.toThrow();
  expect(hosts).toHaveLength(3);
});

for (const provider of ['openai', 'exa'] as const) {
  for (const fallback of [false, true]) {
    test(`cancellation during ${fallback ? 'fallback' : 'initial'} ${provider} authentication starts no provider attempt`, async () => {
      const started = Promise.withResolvers<void>();
      const hosts: string[] = [];
      let stopped = false;
      const authenticate = () =>
        Effect.sync(() => started.resolve()).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(
            Effect.sync(() => {
              stopped = true;
            }),
          ),
        );
      const alternate = provider === 'exa' ? 'openai' : 'exa';
      const web = createWebTools(
        {
          request: request => {
            hosts.push(request.url.hostname);
            return Effect.succeed(new Response(null, {status: 503}));
          },
        },
        {provider: fallback ? alternate : provider},
        {
          exa:
            provider === 'exa' ? authenticate : () => Effect.succeed('fixture'),
          openai: provider === 'openai' ? authenticate : openai,
        },
      );
      const controller = new AbortController();
      const result = web.webSearch.execute(
        'auth',
        {queries: ['q']},
        controller.signal,
      );
      await started.promise;
      controller.abort();
      await expect(result).rejects.toThrow();
      expect(stopped).toBe(true);
      expect(hosts).toEqual(
        fallback ? [alternate === 'exa' ? 'api.exa.ai' : 'api.openai.com'] : [],
      );
    });
  }
}
