import {expect, test} from 'bun:test';
import type {Model} from '@earendil-works/pi-ai';
import {Effect} from 'effect';
import {resolveOpenAI, selectSearchModel} from '../../src/pi/openai';

const model: Model<'openai-responses'> = {
  id: 'gpt-4.1',
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

test('explicit exact official model wins, invalid configuration never guesses', () => {
  const lookedUp: string[] = [];
  const registry = {
    find: (provider: string, id: string) => {
      lookedUp.push(`${provider}/${id}`);
      return provider === model.provider && id === model.id ? model : undefined;
    },
    hasConfiguredAuth: () => false,
    getApiKeyAndHeaders: async () => ({ok: true as const, apiKey: 'fixture'}),
  };
  expect(
    selectSearchModel(registry, codex, {
      openaiModel: {provider: model.provider, id: model.id},
    }),
  ).toBe(model);
  expect(lookedUp).toEqual(['openai/gpt-4.1']);
  expect(selectSearchModel(registry, codex, {})).toBe(codex);
  expect(
    selectSearchModel(
      registry,
      {...model, baseUrl: 'https://custom.example/v1'},
      {},
    ),
  ).toBeUndefined();
  expect(() =>
    selectSearchModel(registry, model, {
      openaiModel: {provider: 'openai', id: 'missing'},
    }),
  ).toThrow('Invalid explicit');
});

test('host authentication is resolved per search, absent auth is not failure', async () => {
  let configured = false;
  let calls = 0;
  const registry = {
    find: () => model,
    hasConfiguredAuth: () => configured,
    getApiKeyAndHeaders: async () => {
      calls++;
      return {
        ok: true as const,
        apiKey: `fixture-${calls}`,
        headers: {'x-fixture': 'host'},
      };
    },
  };
  expect(
    await Effect.runPromise(resolveOpenAI(registry, model, {})),
  ).toBeUndefined();
  expect(calls).toBe(0);
  configured = true;
  for (const count of [1, 2]) {
    const resolved = await Effect.runPromise(
      resolveOpenAI(registry, model, {}),
    );
    expect(resolved?.headers.get('authorization')).toBe(
      `Bearer fixture-${count}`,
    );
    expect(resolved?.headers.get('x-fixture')).toBe('host');
  }
  expect(calls).toBe(2);
});

test('host authentication failure and resolved custom gateway fail explicitly', async () => {
  const registry = {
    find: () => model,
    hasConfiguredAuth: () => true,
    getApiKeyAndHeaders: async () => {
      throw new Error('private authentication detail');
    },
  };
  await expect(
    Effect.runPromise(resolveOpenAI(registry, model, {})),
  ).rejects.toThrow('Pi OpenAI authentication failed');
  await expect(
    Effect.runPromise(
      resolveOpenAI(
        {
          ...registry,
          getApiKeyAndHeaders: async () => ({
            ok: true as const,
            apiKey: 'fixture',
            baseUrl: 'https://custom.example/v1',
          }),
        },
        model,
        {},
      ),
    ),
  ).rejects.toThrow('custom OpenAI gateway');
});

test('Codex host token supplies account header, malformed token fails', async () => {
  let token = `header.${Buffer.from(JSON.stringify({'https://api.openai.com/auth': {chatgpt_account_id: 'fixture-account'}})).toString('base64url')}.signature`;
  const registry = {
    find: () => codex,
    hasConfiguredAuth: () => true,
    getApiKeyAndHeaders: async () => ({ok: true as const, apiKey: token}),
  };
  const resolved = await Effect.runPromise(resolveOpenAI(registry, codex, {}));
  expect(resolved?.codex).toBe(true);
  expect(resolved?.headers.get('chatgpt-account-id')).toBe('fixture-account');
  token = 'invalid';
  await expect(
    Effect.runPromise(resolveOpenAI(registry, codex, {})),
  ).rejects.toThrow('Invalid Codex authentication token');
});
