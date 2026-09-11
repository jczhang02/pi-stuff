import {expect, test} from 'bun:test';
import {Effect} from 'effect';
import {createWebTools} from '../../src/web/index';
import type {Request} from '../../src/web/network';
import {WebError} from '../../src/web/errors';

const openai = () =>
  Effect.succeed({
    model: 'fixture-model',
    codex: false,
    headers: new Headers({authorization: 'Bearer fixture-openai'}),
  });

for (const status of [408, 429, 500, 503]) {
  test(`ordinary search falls back once on HTTP ${status}`, async () => {
    const endpoints: string[] = [];
    const web = createWebTools(
      {
        request: request => {
          endpoints.push(request.url.hostname);
          return Effect.succeed(
            request.url.hostname === 'api.openai.com'
              ? new Response('provider error', {status})
              : Response.json({results: []}),
          );
        },
      },
      {},
      {openai, exaKey: 'fixture'},
    );
    const result = await web.webSearch.execute(
      's',
      {queries: ['question']},
      undefined,
    );
    expect(endpoints).toEqual(['api.openai.com', 'api.exa.ai']);
    expect(result.content[0]?.text).toContain('fallback: true');
    expect(result.content[0]?.text).toContain('provider: exa');
  });
}

for (const status of [400, 401, 403, 404, 422]) {
  test(`ordinary search does not fall back on HTTP ${status}`, async () => {
    const endpoints: string[] = [];
    const web = createWebTools(
      {
        request: request => {
          endpoints.push(request.url.hostname);
          return Effect.succeed(new Response(null, {status}));
        },
      },
      {},
      {openai, exaKey: 'fixture'},
    );
    const result = await web.webSearch.execute(
      's',
      {queries: ['question']},
      undefined,
    );
    expect(endpoints).toEqual(['api.openai.com']);
    expect(result.content[0]?.text).toContain(`HTTP ${status}`);
  });
}

test('authentication failure is not an unconfigured provider', async () => {
  let requests = 0;
  const web = createWebTools(
    {
      request: () => {
        requests++;
        return Effect.succeed(Response.json({results: []}));
      },
    },
    {},
    {
      openai: () =>
        Effect.fail(
          new WebError({
            kind: 'authentication',
            message: 'Authentication failed.',
          }),
        ),
      exaKey: 'fixture',
    },
  );
  const result = await web.webSearch.execute('s', {queries: ['q']}, undefined);
  expect(requests).toBe(0);
  expect(result.content[0]?.text).toContain('authentication');
});

test('OpenAI native answer and citations survive without a second request', async () => {
  let requests = 0;
  const web = createWebTools(
    {
      request: () => {
        requests++;
        return Effect.succeed(
          Response.json({
            status: 'completed',
            output: [
              {
                type: 'web_search_call',
                action: {
                  sources: [{url: 'https://example.com', title: 'Source'}],
                },
              },
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'Native answer.',
                    annotations: [
                      {
                        type: 'url_citation',
                        url: 'https://example.com',
                        title: 'Source',
                        start_index: 0,
                        end_index: 6,
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        );
      },
    },
    {},
    {openai},
  );
  const result = await web.webSearch.execute('s', {queries: ['q']}, undefined);
  expect(requests).toBe(1);
  expect(result.content[0]?.text).toContain('Native answer.');
  expect(result.content[0]?.text).toContain('https://example.com');
  expect(result.content[0]?.text).toContain('start_index');
});

test('filtered searches use Exa, validate domains and never fetch result bodies', async () => {
  const requests: Request[] = [];
  const web = createWebTools(
    {
      request: request => {
        requests.push(request);
        return Effect.succeed(
          Response.json({
            results: [
              {
                title: 'Allowed',
                url: 'https://docs.example.com/a',
                highlights: ['Useful snippet'],
              },
              {title: 'Excluded', url: 'https://bad.example.com/a'},
              {title: 'Other', url: 'https://notexample.com/a'},
            ],
          }),
        );
      },
    },
    {},
    {exaKey: 'fixture-exa', openai: () => Effect.succeed(undefined)},
  );
  const result = await web.webSearch.execute(
    's',
    {
      queries: ['find docs'],
      includeDomains: ['example.com'],
      excludeDomains: ['bad.example.com'],
    },
    undefined,
  );
  const text = result.content[0]?.text ?? '';
  expect(text).toContain('provider: exa');
  expect(text).toContain('Allowed');
  expect(text).toContain('Useful snippet');
  expect(text).not.toContain('Excluded');
  expect(text).not.toContain('Other');
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url.href).toBe('https://api.exa.ai/search');
  expect(requests[0]?.body).toContain('"excludeDomains":["bad.example.com"]');
});

test('Codex accepts unlabelled SSE and retains items when final output is empty', async () => {
  const events = [
    {
      type: 'response.output_item.done',
      item: {
        type: 'web_search_call',
        status: 'completed',
        action: {
          sources: [{url: 'https://bun.sh/docs/api/fetch', title: 'Bun fetch'}],
        },
      },
    },
    {
      type: 'response.output_item.done',
      item: {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'Official fetch documentation.',
            annotations: [
              {
                type: 'url_citation',
                url: 'https://bun.sh/docs/api/fetch',
                title: 'Bun fetch',
                start_index: 0,
                end_index: 5,
              },
            ],
          },
        ],
      },
    },
    {type: 'response.completed', response: {status: 'completed', output: []}},
  ];
  const web = createWebTools(
    {
      request: () =>
        Effect.succeed(
          new Response(
            new TextEncoder().encode(
              events
                .map(event => `data: ${JSON.stringify(event)}\n\n`)
                .join(''),
            ),
          ),
        ),
    },
    {},
    {openai},
  );
  const result = await web.webSearch.execute(
    'stream',
    {queries: ['Bun fetch']},
    undefined,
  );
  expect(result.content[0]?.text).toContain('Official fetch documentation.');
  expect(result.content[0]?.text).toContain('https://bun.sh/docs/api/fetch');
  expect(result.content[0]?.text).toContain('start_index');
});
