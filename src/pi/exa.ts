import {createProvider, envApiKeyAuth} from '@earendil-works/pi-ai';
import type {ModelRegistry} from '@earendil-works/pi-coding-agent';
import {Effect} from 'effect';
import {WebError} from '../web/errors';

export const exaProvider = createProvider({
  id: 'exa',
  name: 'Exa',
  auth: {apiKey: envApiKeyAuth('Exa API key', ['EXA_API_KEY'])},
  models: [],
  api: {},
});

export function resolveExa(
  registry: Pick<ModelRegistry, 'getProviderAuth'>,
): Effect.Effect<string | undefined, WebError> {
  return Effect.gen(function* () {
    const resolved = yield* Effect.tryPromise({
      try: () => registry.getProviderAuth('exa'),
      catch: () =>
        new WebError({
          kind: 'authentication',
          message:
            'Pi Exa authentication failed. Check /login exa or the host provider configuration.',
        }),
    });
    if (!resolved) return undefined;
    const key = resolved.auth.apiKey?.trim();
    if (!key)
      return yield* Effect.fail(
        new WebError({
          kind: 'authentication',
          message: 'Pi Exa authentication did not return an API key.',
        }),
      );
    return key;
  }).pipe(
    Effect.timeoutOrElse({
      duration: '30 seconds',
      orElse: () =>
        Effect.fail(
          new WebError({
            kind: 'authentication',
            message: 'Pi Exa authentication resolution timed out.',
          }),
        ),
    }),
  );
}
