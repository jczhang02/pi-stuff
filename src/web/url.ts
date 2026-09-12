import {Effect} from 'effect';
import {WebError} from './errors';

// Reachability, DNS and proxy routing belong to the host network, not this tool.
export function textUrl(raw: string) {
  return Effect.try({
    try: () => {
      const url = new URL(raw);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        throw new Error('Unsupported URL.');
      }
      return url;
    },
    catch: () =>
      new WebError({
        kind: 'input',
        message: 'Only HTTP(S) URLs without embedded credentials are allowed.',
      }),
  });
}
