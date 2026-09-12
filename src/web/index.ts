import {StringEnum} from '@earendil-works/pi-ai';
import {Effect} from 'effect';
import {Type, type Static} from 'typebox';
import {Value} from 'typebox/value';
import {Content, OUTPUT_BYTES} from './content';
import {fetchText} from './fetch';
import {WebError} from './errors';
import type {Network} from './network';
import {search, type Credentials} from './search';
import type {WebSettings} from './settings';

const fetchParameters = Type.Object(
  {
    urls: Type.Array(Type.String({minLength: 1, maxLength: 8192}), {
      minItems: 1,
      maxItems: 5,
    }),
    mode: Type.Optional(StringEnum(['readable', 'raw'])),
  },
  {additionalProperties: false},
);
const contentParameters = Type.Object(
  {
    contentId: Type.String({minLength: 1, maxLength: 100}),
    find: Type.Optional(Type.String({minLength: 1, maxLength: 200})),
    offset: Type.Optional(Type.Integer({minimum: 0})),
    limit: Type.Optional(Type.Integer({minimum: 1, maximum: 20000})),
  },
  {additionalProperties: false},
);

const searchParameters = Type.Object(
  {
    queries: Type.Array(Type.String({minLength: 1, maxLength: 2000}), {
      minItems: 1,
      maxItems: 5,
    }),
    maxResults: Type.Optional(Type.Integer({minimum: 1, maximum: 20})),
    includeDomains: Type.Optional(
      Type.Array(Type.String({minLength: 1, maxLength: 253}), {maxItems: 20}),
    ),
    excludeDomains: Type.Optional(
      Type.Array(Type.String({minLength: 1, maxLength: 253}), {maxItems: 20}),
    ),
  },
  {additionalProperties: false},
);

export function createWebTools(
  network: Network,
  settings: WebSettings = {},
  credentials: Credentials = {
    exa: () => Effect.succeed(undefined),
    openai: () => Effect.succeed(undefined),
  },
) {
  const content = new Content();
  let lifetime = new AbortController();
  async function batch(
    items: readonly string[],
    retrieve: (item: string) => Effect.Effect<string, WebError>,
    signal: AbortSignal | undefined,
  ) {
    const budget = Math.floor((OUTPUT_BYTES - 100) / items.length);
    const output = await Effect.runPromise(
      Effect.forEach(
        items,
        (item, index) =>
          retrieve(item).pipe(
            Effect.flatMap(text =>
              Effect.try({
                try: () =>
                  `item: ${index}\n${content.page(content.store(text), 0, 8000, budget - 32)}`,
                catch: error =>
                  error instanceof WebError
                    ? error
                    : new WebError({
                        kind: 'content',
                        message: 'Could not retain content.',
                      }),
              }),
            ),
            Effect.catch(error =>
              Effect.succeed(
                `item: ${index}\nerror: ${error.kind}: ${error.message}`,
              ),
            ),
          ),
        {concurrency: 3},
      ),
      {
        signal: signal
          ? AbortSignal.any([signal, lifetime.signal])
          : lifetime.signal,
      },
    );
    return {
      content: [{type: 'text' as const, text: output.join('\n\n')}],
      details: undefined,
    };
  }
  const webSearch = {
    name: 'web_search',
    label: 'Web search',
    description:
      'Search 1-5 queries. Select useful URLs and call fetch_content separately. Results are bounded to 32 KiB and retained for paging in this session.',
    parameters: searchParameters,
    async execute(
      _id: string,
      params: Static<typeof searchParameters>,
      signal: AbortSignal | undefined,
    ) {
      signal?.throwIfAborted();
      if (!Value.Check(searchParameters, params))
        throw new WebError({
          kind: 'input',
          message: 'Invalid search arguments.',
        });
      return batch(
        params.queries,
        query => search(query, params, settings, credentials, network),
        signal,
      );
    },
  };
  const fetchContent = {
    name: 'fetch_content',
    label: 'Fetch content',
    description:
      'Fetch HTTP(S) text URLs reachable from this host, including local/private targets. No browser cookies are used. Content is retained only in this session.',
    parameters: fetchParameters,
    async execute(
      _id: string,
      params: Static<typeof fetchParameters>,
      signal: AbortSignal | undefined,
    ) {
      signal?.throwIfAborted();
      if (!Value.Check(fetchParameters, params))
        throw new WebError({
          kind: 'input',
          message: 'Invalid fetch arguments.',
        });
      return batch(
        params.urls,
        url => fetchText(url, params.mode ?? 'readable', network),
        signal,
      );
    },
  };
  const getSearchContent = {
    name: 'get_search_content',
    label: 'Get search content',
    description: 'Page through retained content using UTF-16 offsets.',
    parameters: contentParameters,
    async execute(
      _id: string,
      params: Static<typeof contentParameters>,
      signal: AbortSignal | undefined,
    ) {
      signal?.throwIfAborted();
      if (!Value.Check(contentParameters, params))
        throw new WebError({
          kind: 'input',
          message: 'Invalid content arguments.',
        });
      if (
        params.find !== undefined &&
        (params.offset !== undefined || params.limit !== undefined)
      ) {
        throw new WebError({
          kind: 'input',
          message: 'Do not mix find with paging options.',
        });
      }
      const text =
        params.find === undefined
          ? content.page(params.contentId, params.offset, params.limit)
          : content.find(params.contentId, params.find);
      return {content: [{type: 'text' as const, text}], details: undefined};
    },
  };
  return {
    webSearch,
    fetchContent,
    getSearchContent,
    clear: () => {
      lifetime.abort();
      lifetime = new AbortController();
      content.clear();
    },
  };
}
