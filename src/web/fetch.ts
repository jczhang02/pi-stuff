// Extraction path adapted from pi-web-access 0.28.0, e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5.
// Copyright (c) 2025 Nico Bailon. MIT; see THIRD_PARTY_LICENSES/pi-web-access.txt.
import {Readability} from '@mozilla/readability';
import {Effect} from 'effect';
import {parseHTML} from 'linkedom';
import TurndownService from 'turndown';
import {WebError} from './errors';
import {readBody} from './network';
import type {Network} from './network';
import {textUrl} from './url';

const markdown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

export function fetchText(raw: string, mode: string, network: Network) {
  return Effect.gen(function* () {
    let current = raw;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const url = yield* textUrl(current);
      const response = yield* network.request({
        url,
        method: 'GET',
        headers: new Headers({
          accept: 'text/html, text/plain, application/json, text/markdown',
          'user-agent': 'pi-stuff',
        }),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || redirects === 5)
          return yield* Effect.fail(
            new WebError({
              kind: 'http',
              message: 'Invalid redirect or more than five redirects.',
            }),
          );
        current = yield* Effect.try({
          try: () => new URL(location, url).href,
          catch: () =>
            new WebError({kind: 'response', message: 'Invalid redirect URL.'}),
        });
        continue;
      }
      if (!response.ok)
        return yield* Effect.fail(
          new WebError({
            kind: 'http',
            status: response.status,
            message: `HTTP ${response.status}.`,
          }),
        );
      const mime =
        response.headers
          .get('content-type')
          ?.split(';')[0]
          ?.trim()
          .toLowerCase() ?? '';
      if (
        !(
          mime.startsWith('text/') ||
          [
            'application/json',
            'application/xml',
            'application/xhtml+xml',
            'application/javascript',
          ].includes(mime) ||
          /^application\/.+\+(json|xml)$/.test(mime)
        )
      ) {
        return yield* Effect.fail(
          new WebError({kind: 'content', message: 'Unsupported content type.'}),
        );
      }
      const text = yield* readBody(response);
      if (
        mode === 'raw' ||
        !['text/html', 'application/xhtml+xml'].includes(mime)
      )
        return text;
      return yield* Effect.try({
        try: () => {
          const {document} = parseHTML(text);
          // Linkedom's document supplies the DOM used by Readability; no scripts or subresources run.
          Object.defineProperty(document, 'documentURI', {
            value: url.href,
          });
          Object.defineProperty(document, 'baseURI', {value: url.href});
          const article = new Readability(document).parse();
          if (!article?.content) throw new Error('No article.');
          const result = markdown.turndown(article.content).trim();
          if (!result) throw new Error('Empty article.');
          return result;
        },
        catch: () =>
          new WebError({
            kind: 'content',
            message:
              'Could not extract readable HTML content. Try another source or raw mode.',
          }),
      });
    }
    return yield* Effect.fail(
      new WebError({kind: 'http', message: 'Too many redirects.'}),
    );
  }).pipe(
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: '30 seconds',
      orElse: () =>
        Effect.fail(
          new WebError({
            kind: 'timeout',
            message: 'Page fetch timed out after 30 seconds.',
          }),
        ),
    }),
  );
}
