import {expect, test} from 'bun:test';
import {Effect} from 'effect';
import {resolveExa} from '../../src/pi/exa';
import {createWebTools} from '../../src/web';
import {WebError} from '../../src/web/errors';

test('subsequent searches resolve changed Exa credentials without rebuilding tools', async () => {
  let key: string | undefined = 'fixture-first';
  const sent: (string | null)[] = [];
  const web = createWebTools(
    {
      request: request => {
        sent.push(request.headers.get('x-api-key'));
        return Effect.succeed(Response.json({results: []}));
      },
    },
    {provider: 'exa'},
    {
      openai: () => Effect.succeed(undefined),
      exa: () =>
        resolveExa({
          getProviderAuth: async () =>
            key === undefined ? undefined : {auth: {apiKey: key}},
        }),
    },
  );
  await web.webSearch.execute('first', {queries: ['q']}, undefined);
  key = 'fixture-second';
  await web.webSearch.execute('second', {queries: ['q']}, undefined);
  expect(sent).toEqual(['fixture-first', 'fixture-second']);
  key = undefined;
  const missing = await web.webSearch.execute(
    'removed',
    {queries: ['q'], includeDomains: ['example.com']},
    undefined,
  );
  expect(missing.content[0]?.text).toContain('/login exa');
  expect(sent).toHaveLength(2);
});

test('Exa auth failures are not absence and never trigger OpenAI requests', async () => {
  let calls = 0;
  const web = createWebTools(
    {
      request: () => {
        calls++;
        return Effect.succeed(new Response('unexpected'));
      },
    },
    {provider: 'exa'},
    {
      openai: () => {
        calls++;
        return Effect.succeed(undefined);
      },
      exa: () =>
        resolveExa({
          getProviderAuth: async () => {
            throw new Error('fixture-private-key');
          },
        }),
    },
  );
  const result = await web.webSearch.execute(
    'failed',
    {queries: ['q']},
    undefined,
  );
  expect(result.content[0]?.text).toContain('authentication');
  expect(result.content[0]?.text).not.toContain('fixture-private-key');
  expect(calls).toBe(0);
});

test('successful preferred OpenAI search does not resolve unrelated Exa credentials', async () => {
  let exaCalls = 0;
  const web = createWebTools(
    {
      request: () =>
        Effect.succeed(
          Response.json({
            status: 'completed',
            output: [{type: 'web_search_call', action: {sources: []}}],
          }),
        ),
    },
    {},
    {
      openai: () =>
        Effect.succeed({
          model: 'fixture',
          codex: false,
          headers: new Headers(),
        }),
      exa: () => {
        exaCalls++;
        return Effect.fail(
          new WebError({kind: 'authentication', message: 'unrelated failure'}),
        );
      },
    },
  );
  const result = await web.webSearch.execute(
    'openai',
    {queries: ['q']},
    undefined,
  );
  expect(result.content[0]?.text).toContain('provider: openai');
  expect(exaCalls).toBe(0);
});

test('invalid resolved credentials fail safely instead of selecting another provider', async () => {
  for (const apiKey of [undefined, '   ']) {
    let requests = 0;
    const web = createWebTools(
      {
        request: () => {
          requests++;
          return Effect.succeed(Response.json({results: []}));
        },
      },
      {provider: 'exa'},
      {
        exa: () =>
          resolveExa({
            getProviderAuth: async () => ({
              auth: apiKey === undefined ? {} : {apiKey},
            }),
          }),
        openai: () => Effect.succeed(undefined),
      },
    );
    const result = await web.webSearch.execute(
      'invalid',
      {queries: ['q']},
      undefined,
    );
    expect(result.content[0]?.text).toContain('error: authentication:');
    expect(requests).toBe(0);
  }
});

test('Exa key rejection neither re-resolves a key nor falls back or exposes response secrets', async () => {
  let resolutions = 0;
  const sent: (string | null)[] = [];
  const web = createWebTools(
    {
      request: request => {
        sent.push(request.headers.get('x-api-key'));
        return Effect.succeed(
          new Response('fixture-stored-key', {status: 401}),
        );
      },
    },
    {provider: 'exa'},
    {
      exa: () =>
        resolveExa({
          getProviderAuth: async () => {
            resolutions++;
            return {auth: {apiKey: 'fixture-stored-key'}};
          },
        }),
      openai: () =>
        Effect.succeed({
          model: 'fixture',
          codex: false,
          headers: new Headers(),
        }),
    },
  );
  const result = await web.webSearch.execute(
    'rejected',
    {queries: ['q']},
    undefined,
  );
  expect(sent).toEqual(['fixture-stored-key']);
  expect(resolutions).toBe(1);
  expect(result.content[0]?.text).toContain('HTTP 401');
  expect(result.content[0]?.text).not.toContain('fixture-stored-key');
});
