import type {Api, Model} from '@earendil-works/pi-ai';
import type {ModelRegistry} from '@earendil-works/pi-coding-agent';
import {Effect, Schema} from 'effect';
import {WebError} from '../web/errors';
import type {OpenAI} from '../web/search';
import type {WebSettings} from '../web/settings';

type Registry = Pick<
  ModelRegistry,
  'find' | 'hasConfiguredAuth' | 'getApiKeyAndHeaders'
>;
const Account = Schema.Struct({
  'https://api.openai.com/auth': Schema.Struct({
    chatgpt_account_id: Schema.NonEmptyString,
  }),
});

function official(model: Model<Api>, baseUrl = model.baseUrl): boolean {
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      return false;
    const path = url.pathname.replace(/\/$/, '');
    return (
      (model.provider === 'openai' &&
        model.api === 'openai-responses' &&
        url.hostname === 'api.openai.com' &&
        path === '/v1') ||
      (model.provider === 'openai-codex' &&
        model.api === 'openai-codex-responses' &&
        url.hostname === 'chatgpt.com' &&
        path === '/backend-api')
    );
  } catch {
    return false;
  }
}

export function selectSearchModel(
  registry: Registry,
  current: Model<Api> | undefined,
  settings: WebSettings,
) {
  const explicit = settings.openaiModel;
  const model = explicit
    ? registry.find(explicit.provider, explicit.id)
    : current;
  if (explicit && (!model || !official(model)))
    throw new WebError({
      kind: 'configuration',
      message:
        'Invalid explicit web.openaiModel in pi-stuff.json. Use an exact official OpenAI/Codex Responses model and /reload.',
    });
  return model && official(model) ? model : undefined;
}

export function resolveOpenAI(
  registry: Registry,
  current: Model<Api> | undefined,
  settings: WebSettings,
): Effect.Effect<OpenAI | undefined, WebError> {
  return Effect.gen(function* () {
    const model = yield* Effect.try({
      try: () => selectSearchModel(registry, current, settings),
      catch: () =>
        new WebError({
          kind: 'configuration',
          message: 'Invalid explicit OpenAI search model.',
        }),
    });
    if (!model || !registry.hasConfiguredAuth(model)) return undefined;
    const resolved = yield* Effect.tryPromise({
      try: () => registry.getApiKeyAndHeaders(model),
      catch: () =>
        new WebError({
          kind: 'authentication',
          message: 'Pi OpenAI authentication failed.',
        }),
    });
    if (!resolved.ok || !resolved.apiKey)
      return yield* Effect.fail(
        new WebError({
          kind: 'authentication',
          message:
            'Pi OpenAI authentication failed. Check /login or the host provider configuration.',
        }),
      );
    if (resolved.baseUrl && !official(model, resolved.baseUrl))
      return yield* Effect.fail(
        new WebError({
          kind: 'configuration',
          message: 'Search does not support a custom OpenAI gateway.',
        }),
      );
    const headers = new Headers();
    for (const [name, value] of Object.entries(resolved.headers ?? {}))
      if (value !== null) headers.set(name, value);
    headers.set('authorization', `Bearer ${resolved.apiKey}`);
    headers.set('accept', 'text/event-stream');
    const codex = model.provider === 'openai-codex';
    if (codex) {
      const payload = resolved.apiKey.split('.')[1];
      if (!payload)
        return yield* Effect.fail(
          new WebError({
            kind: 'authentication',
            message: 'Invalid Codex authentication token.',
          }),
        );
      const account = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(Account),
      )(Buffer.from(payload, 'base64url').toString('utf8')).pipe(
        Effect.mapError(
          () =>
            new WebError({
              kind: 'authentication',
              message: 'Codex token lacks an account identifier.',
            }),
        ),
      );
      headers.set(
        'chatgpt-account-id',
        account['https://api.openai.com/auth'].chatgpt_account_id,
      );
      headers.set('originator', 'pi');
      headers.set('OpenAI-Beta', 'responses=experimental');
    }
    return {model: model.id, codex, headers};
  }).pipe(
    Effect.timeoutOrElse({
      duration: '30 seconds',
      orElse: () =>
        Effect.fail(
          new WebError({
            kind: 'authentication',
            message: 'Pi authentication resolution timed out.',
          }),
        ),
    }),
  );
}
