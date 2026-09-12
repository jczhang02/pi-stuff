import {Effect} from 'effect';
import {WebError} from '../web/errors';
import type {Network} from '../web/network';

// Use the runtime's ordinary DNS, connection and proxy handling.
// Redirects remain explicit so the capability can enforce its hop/URL limits.
export const network: Network = {
  request: request =>
    Effect.gen(function* () {
      const controller = new AbortController();
      yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
      const response = yield* Effect.tryPromise({
        try: signal =>
          fetch(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            redirect: 'manual',
            credentials: 'omit',
            signal: AbortSignal.any([signal, controller.signal]),
          }),
        catch: () =>
          new WebError({kind: 'transport', message: 'Network request failed.'}),
      });
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await response.body?.cancel().catch(() => {});
        }),
      );
      return response;
    }),
};
