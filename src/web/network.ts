import {Effect, type Scope} from 'effect';
import {WebError} from './errors';

export interface Request {
  url: URL;
  method: 'GET' | 'POST';
  headers: Headers;
  body?: string;
}

export interface Network {
  request(request: Request): Effect.Effect<Response, WebError, Scope.Scope>;
}

export function readBody(response: Response) {
  return Effect.tryPromise({
    try: async signal => {
      const reader = response.body?.getReader();
      if (!reader) return '';
      const cancel = () => {
        void reader.cancel().catch(() => {});
      };
      signal.addEventListener('abort', cancel, {once: true});
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        signal.throwIfAborted();
        while (true) {
          const chunk = await reader.read();
          signal.throwIfAborted();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 5 * 1024 * 1024)
            throw new WebError({
              kind: 'content',
              message: 'Network response exceeds 5 MiB.',
            });
          chunks.push(chunk.value);
        }
        const charset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(
          response.headers.get('content-type') ?? '',
        )?.[1];
        const encoding = charset?.toLowerCase() ?? 'utf-8';
        if (
          encoding !== 'utf-8' &&
          encoding !== 'windows-1252' &&
          encoding !== 'utf-16'
        ) {
          throw new WebError({
            kind: 'content',
            message: 'Unsupported text encoding.',
          });
        }
        return new TextDecoder(encoding).decode(Buffer.concat(chunks));
      } finally {
        signal.removeEventListener('abort', cancel);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    },
    catch: error =>
      error instanceof WebError
        ? error
        : new WebError({
            kind: 'transport',
            message: 'Could not read network response.',
          }),
  });
}
