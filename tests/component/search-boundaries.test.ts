import {expect, test} from 'bun:test';
import {Effect} from 'effect';
import {createWebTools} from '../../src/web';
import {WebError} from '../../src/web/errors';

const openai = () =>
  Effect.succeed({model: 'fixture', codex: false, headers: new Headers()});

test('unconfigured preferred provider selects available provider without fallback', async () => {
  for (const provider of ['openai', 'exa'] as const) {
    const hosts: string[] = [];
    const web = createWebTools(
      {
        request: request => {
          hosts.push(request.url.hostname);
          return Effect.succeed(
            Response.json(
              provider === 'openai'
                ? {results: []}
                : {
                    status: 'completed',
                    output: [{type: 'web_search_call', action: {sources: []}}],
                  },
            ),
          );
        },
      },
      {provider},
      {
        openai:
          provider === 'openai' ? () => Effect.succeed(undefined) : openai,
        ...(provider === 'openai' ? {exaKey: 'fixture'} : {exaKey: undefined}),
      },
    );
    const result = await web.webSearch.execute(
      'selection',
      {queries: ['q']},
      undefined,
    );
    expect(hosts).toEqual([
      provider === 'openai' ? 'api.exa.ai' : 'api.openai.com',
    ]);
    expect(result.content[0]?.text).toContain('selection: available provider');
    expect(result.content[0]?.text).toContain('fallback: false');
  }
});

test('transport fallback is attempted only once even if the alternate also fails', async () => {
  const hosts: string[] = [];
  const web = createWebTools(
    {
      request: request => {
        hosts.push(request.url.hostname);
        return Effect.fail(
          new WebError({
            kind: 'transport',
            message: 'fixture transport failure',
          }),
        );
      },
    },
    {},
    {openai, exaKey: 'fixture'},
  );
  expect(
    (await web.webSearch.execute('transport', {queries: ['q']}, undefined))
      .content[0]?.text,
  ).toContain('transport failure');
  expect(hosts).toEqual(['api.openai.com', 'api.exa.ai']);
});

test('malformed provider response and valid empty results never cause fallback', async () => {
  for (const raw of [
    '{invalid',
    JSON.stringify({
      status: 'completed',
      output: [{type: 'web_search_call', action: {sources: []}}],
    }),
  ]) {
    let requests = 0;
    const web = createWebTools(
      {
        request: () => {
          requests++;
          return Effect.succeed(new Response(raw));
        },
      },
      {},
      {openai, exaKey: 'fixture'},
    );
    const output = await web.webSearch.execute(
      'decode',
      {queries: ['q']},
      undefined,
    );
    expect(requests).toBe(1);
    expect(output.content[0]?.text).toContain(
      raw === '{invalid' ? 'error: response:' : 'fallback: false',
    );
  }
});

test('filters fail before requesting without Exa or with invalid hostnames', async () => {
  let requests = 0;
  const web = createWebTools(
    {
      request: () => {
        requests++;
        return Effect.succeed(Response.json({results: []}));
      },
    },
    {},
    {openai},
  );
  for (const domain of [
    'example.com',
    'https://example.com',
    '*.example.com',
  ]) {
    const output = await web.webSearch.execute(
      'filter',
      {queries: ['q'], includeDomains: [domain]},
      undefined,
    );
    expect(output.content[0]?.text).toContain(
      domain === 'example.com' ? 'EXA_API_KEY' : 'hostnames',
    );
  }
  expect(requests).toBe(0);
});

test('filtered temporary failure never relaxes constraints; result cap is an upper bound', async () => {
  const hosts: string[] = [];
  let failed = true;
  const web = createWebTools(
    {
      request: request => {
        hosts.push(request.url.hostname);
        return Effect.succeed(
          failed
            ? new Response(null, {status: 503})
            : Response.json({
                results: [
                  {url: 'https://example.com/a'},
                  {url: 'https://sub.example.com/b'},
                  {url: 'https://example.com/c'},
                ],
              }),
        );
      },
    },
    {},
    {openai, exaKey: 'fixture'},
  );
  const failure = await web.webSearch.execute(
    'filtered',
    {queries: ['q'], includeDomains: ['example.com']},
    undefined,
  );
  expect(failure.content[0]?.text).toContain('HTTP 503');
  expect(hosts).toEqual(['api.exa.ai']);
  failed = false;
  const capped = await web.webSearch.execute(
    'cap',
    {queries: ['q'], maxResults: 1, includeDomains: ['example.com']},
    undefined,
  );
  expect(capped.content[0]?.text).toContain('https://example.com/a');
  expect(capped.content[0]?.text).not.toContain('https://sub.example.com/b');
  expect(capped.content[0]?.text).not.toContain('https://example.com/c');
});

test('real 30-second deadlines interrupt page and provider work before one fallback', async () => {
  let interrupted = 0;
  const hosts: string[] = [];
  const web = createWebTools(
    {
      request: request => {
        hosts.push(request.url.hostname);
        return request.url.hostname === 'api.exa.ai'
          ? Effect.succeed(Response.json({results: []}))
          : Effect.never.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  interrupted++;
                }),
              ),
            );
      },
    },
    {},
    {openai, exaKey: 'fixture'},
  );
  const [page, search] = await Promise.all([
    web.fetchContent.execute(
      'deadline',
      {urls: ['https://example.com']},
      undefined,
    ),
    web.webSearch.execute('deadline', {queries: ['q']}, undefined),
  ]);
  expect(page.content[0]?.text).toContain(
    'Page fetch timed out after 30 seconds',
  );
  expect(search.content[0]?.text).toContain('fallback: true');
  expect(hosts).toEqual(['example.com', 'api.openai.com', 'api.exa.ai']);
  expect(interrupted).toBe(2);
}, 35000);
