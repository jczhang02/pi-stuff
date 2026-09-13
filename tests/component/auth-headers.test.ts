import {expect, test} from 'bun:test';
import type {Model} from '@earendil-works/pi-ai';
import {Effect} from 'effect';
import {resolveOpenAI} from '../../src/web/openai-auth';
import {createWebTools} from '../../src/web/tools';

const model: Model<'openai-responses'> = {
  id: 'fixture-openai',
  name: 'Fixture OpenAI',
  api: 'openai-responses',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  reasoning: false,
  input: ['text'],
  cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
  contextWindow: 128000,
  maxTokens: 8000,
};
const codex: Model<'openai-codex-responses'> = {
  ...model,
  id: 'fixture-codex',
  api: 'openai-codex-responses',
  provider: 'openai-codex',
  baseUrl: 'https://chatgpt.com/backend-api',
};

function completedResponse() {
  return Response.json({
    status: 'completed',
    output: [{type: 'web_search_call', action: {sources: []}}],
  });
}

function codexToken(account: string) {
  return `header.${Buffer.from(
    JSON.stringify({
      'https://api.openai.com/auth': {chatgpt_account_id: account},
    }),
  ).toString('base64url')}.signature`;
}

test('malformed Exa keys become fixed auth errors without fallback or leaks', async () => {
  const controls = [
    String.fromCharCode(13, 10),
    String.fromCharCode(10),
    String.fromCharCode(0),
  ];
  for (const control of controls) {
    const key = `fixture-exa-secret${control}fixture-exa-tail`;
    const hosts: string[] = [];
    let fallbackAuth = 0;
    const web = createWebTools(
      {
        request: request => {
          hosts.push(request.url.hostname);
          return Effect.succeed(completedResponse());
        },
      },
      {provider: 'exa'},
      {
        exa: () => Effect.succeed(key),
        openai: () => {
          fallbackAuth++;
          return Effect.succeed(undefined);
        },
      },
    );
    const result = await web.webSearch.execute(
      'malformed exa',
      {queries: ['q']},
      undefined,
    );
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('error: authentication:');
    expect(text).not.toContain('fixture-exa-secret');
    expect(text).not.toContain('fixture-exa-tail');
    expect(hosts).toEqual([]);
    expect(fallbackAuth).toBe(0);
  }
});

test('malformed OpenAI host headers and bearer keys become fixed auth errors', async () => {
  const crlf = String.fromCharCode(13, 10);
  const malformed = [
    {
      headers: {[`x-fixture${crlf}name`]: 'fixture-host-value'},
      apiKey: 'fixture-openai-key',
    },
    {
      headers: {'x-fixture': `fixture-host-value${crlf}tail`},
      apiKey: 'fixture-openai-key',
    },
    {
      headers: {},
      apiKey: `fixture-openai-key${String.fromCharCode(0)}tail`,
    },
  ];
  for (const auth of malformed) {
    let requests = 0;
    let fallbackAuth = 0;
    const registry = {
      find: () => model,
      hasConfiguredAuth: () => true,
      getApiKeyAndHeaders: async () => ({
        ok: true as const,
        apiKey: auth.apiKey,
        headers: auth.headers,
      }),
    };
    const web = createWebTools(
      {
        request: () => {
          requests++;
          return Effect.succeed(completedResponse());
        },
      },
      {},
      {
        openai: () => resolveOpenAI(registry, model, {}),
        exa: () => {
          fallbackAuth++;
          return Effect.succeed('fixture-exa');
        },
      },
    );
    const result = await web.webSearch.execute(
      'malformed openai',
      {queries: ['q']},
      undefined,
    );
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('error: authentication:');
    expect(text).not.toContain('fixture-openai-key');
    expect(text).not.toContain('fixture-host-value');
    expect(text).not.toContain('fixture-exa');
    expect(requests).toBe(0);
    expect(fallbackAuth).toBe(0);
  }
});

test('malformed Codex account headers become fixed auth errors', async () => {
  const account = `fixture-account${String.fromCharCode(0)}tail`;
  const registry = {
    find: () => codex,
    hasConfiguredAuth: () => true,
    getApiKeyAndHeaders: async () => ({
      ok: true as const,
      apiKey: codexToken(account),
    }),
  };
  let requests = 0;
  const web = createWebTools(
    {
      request: () => {
        requests++;
        return Effect.succeed(completedResponse());
      },
    },
    {},
    {
      openai: () => resolveOpenAI(registry, codex, {}),
      exa: () => Effect.succeed('fixture-exa'),
    },
  );
  const result = await web.webSearch.execute(
    'malformed codex',
    {queries: ['q']},
    undefined,
  );
  const text = result.content[0]?.text ?? '';
  expect(text).toContain('error: authentication:');
  expect(text).not.toContain('fixture-account');
  expect(text).not.toContain('tail');
  expect(requests).toBe(0);
});

test('typed header failures stay isolated from successful batch siblings', async () => {
  const invalid = `fixture-batch-secret${String.fromCharCode(13, 10)}tail`;
  let authCalls = 0;
  const hosts: string[] = [];
  const web = createWebTools(
    {
      request: request => {
        hosts.push(request.url.hostname);
        return Effect.succeed(Response.json({results: []}));
      },
    },
    {provider: 'exa'},
    {
      exa: () => {
        authCalls++;
        return Effect.succeed(authCalls === 1 ? invalid : 'fixture-valid-exa');
      },
      openai: () => Effect.succeed(undefined),
    },
  );
  const result = await web.webSearch.execute(
    'mixed batch',
    {queries: ['bad', 'good']},
    undefined,
  );
  const text = result.content[0]?.text ?? '';
  expect(text).toContain('error: authentication:');
  expect(text).toContain('provider: exa');
  expect(text).toContain('query: good');
  expect(text).not.toContain('fixture-batch-secret');
  expect(text).not.toContain('tail');
  expect(hosts).toEqual(['api.exa.ai']);
});
