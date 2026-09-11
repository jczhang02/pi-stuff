import {Effect, Schema} from 'effect';
import {WebError} from './errors';
import {readBody, type Network, type Request} from './network';
import {openAIResponse} from './openai-response';
import type {WebSettings} from './settings';

export interface OpenAI {
  model: string;
  codex: boolean;
  headers: Headers;
}
export interface Credentials {
  exaKey?: string | undefined;
  openai(): Effect.Effect<OpenAI | undefined, WebError>;
}
export interface SearchOptions {
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
}
interface Filters {
  include: string[];
  exclude: string[];
}
const ExaResponse = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      url: Schema.NonEmptyString,
      title: Schema.optional(Schema.NullOr(Schema.String)),
      highlights: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});

function domains(entries: readonly string[]): string[] {
  return entries.map(entry => {
    const domain = entry.toLowerCase().replace(/\.$/, '');
    if (
      domain.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
        domain,
      )
    ) {
      throw new WebError({
        kind: 'input',
        message: 'Domains must be hostnames, not URLs or wildcards.',
      });
    }
    return domain;
  });
}

function matches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function allowedSource(raw: string, filters: Filters): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !filters.exclude.some(domain => matches(host, domain)) &&
      (filters.include.length === 0 ||
        filters.include.some(domain => matches(host, domain)))
    );
  } catch {
    return false;
  }
}

export function search(
  query: string,
  options: SearchOptions,
  settings: WebSettings,
  credentials: Credentials,
  network: Network,
) {
  return Effect.gen(function* () {
    const filters = yield* Effect.try({
      try: () => ({
        include: domains(options.includeDomains ?? []),
        exclude: domains(options.excludeDomains ?? []),
      }),
      catch: () =>
        new WebError({
          kind: 'input',
          message: 'Domains must be hostnames, not URLs or wildcards.',
        }),
    });
    const filtered = filters.include.length > 0 || filters.exclude.length > 0;
    const preferred = filtered ? 'exa' : (settings.provider ?? 'openai');
    if (filtered && !credentials.exaKey)
      return yield* Effect.fail(
        new WebError({
          kind: 'configuration',
          message: 'Domain filtering requires EXA_API_KEY.',
        }),
      );
    const maxResults = options.maxResults ?? 5;

    function response(request: Request) {
      return Effect.suspend(() => network.request(request)).pipe(
        Effect.flatMap(reply =>
          reply.ok
            ? readBody(reply)
            : Effect.fail(
                new WebError({
                  kind: 'http',
                  status: reply.status,
                  message: `HTTP ${reply.status}.`,
                }),
              ),
        ),
      );
    }

    function exaSearch(key: string) {
      return response({
        url: new URL('https://api.exa.ai/search'),
        method: 'POST',
        headers: new Headers({
          'x-api-key': key,
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          query,
          type: 'auto',
          numResults: maxResults,
          includeDomains: filters.include,
          excludeDomains: filters.exclude,
          contents: {highlights: true, text: false},
        }),
      }).pipe(
        Effect.flatMap(raw =>
          Schema.decodeUnknownEffect(Schema.fromJsonString(ExaResponse))(
            raw,
          ).pipe(
            Effect.mapError(
              () =>
                new WebError({
                  kind: 'response',
                  message: 'Malformed Exa response.',
                }),
            ),
          ),
        ),
        Effect.map(data =>
          data.results
            .filter(result => allowedSource(result.url, filters))
            .slice(0, maxResults)
            .map(
              (source, index) =>
                `${index + 1}. ${source.title ?? source.url}\nurl: ${source.url}\nsource: ${new URL(source.url).hostname}\nsnippet: ${(source.highlights ?? []).join(' ')}`,
            )
            .join('\n\n'),
        ),
      );
    }

    function openaiSearch(auth: OpenAI) {
      const headers = new Headers(auth.headers);
      headers.set('content-type', 'application/json');
      return response({
        url: new URL(
          auth.codex
            ? 'https://chatgpt.com/backend-api/codex/responses'
            : 'https://api.openai.com/v1/responses',
        ),
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: auth.model,
          instructions:
            'Search the web and answer concisely with source citations.',
          input: [{role: 'user', content: [{type: 'input_text', text: query}]}],
          tools: [{type: 'web_search'}],
          tool_choice: 'required',
          include: ['web_search_call.action.sources'],
          store: false,
          stream: true,
        }),
      }).pipe(
        Effect.flatMap(raw => openAIResponse(raw, maxResults)),
        Effect.flatMap(data =>
          data.sources.some(source => !allowedSource(source.url, filters))
            ? Effect.fail(
                new WebError({
                  kind: 'response',
                  message: 'Invalid OpenAI source URL.',
                }),
              )
            : Effect.succeed(
                `answer: ${data.answer}\n\ncitations: ${JSON.stringify(data.citations)}\n\n${data.sources.map((source, index) => `${index + 1}. ${source.title}\nurl: ${source.url}\nsource: ${new URL(source.url).hostname}\nsnippet: ${source.snippet}`).join('\n\n')}`,
              ),
        ),
      );
    }

    // A candidate carries an already-authenticated operation, not an invalid
    // provider/optional-auth combination that each protocol must defend against.
    const exa = credentials.exaKey
      ? {provider: 'exa' as const, run: exaSearch(credentials.exaKey)}
      : undefined;
    const openai = Effect.suspend(() => credentials.openai()).pipe(
      Effect.map(auth =>
        auth
          ? {provider: 'openai' as const, run: openaiSearch(auth)}
          : undefined,
      ),
    );
    const selected =
      preferred === 'exa' && exa ? exa : ((yield* openai) ?? exa);
    if (!selected)
      return yield* Effect.fail(
        new WebError({
          kind: 'configuration',
          message:
            'Configure an official OpenAI search model/authentication or EXA_API_KEY.',
        }),
      );

    function attempt(run: ReturnType<typeof openaiSearch>) {
      return run.pipe(
        Effect.scoped,
        Effect.timeoutOrElse({
          duration: '30 seconds',
          orElse: () =>
            Effect.fail(
              new WebError({
                kind: 'timeout',
                message: 'Provider attempt timed out after 30 seconds.',
              }),
            ),
        }),
      );
    }
    const result = yield* attempt(selected.run).pipe(
      Effect.map(text => ({
        text,
        provider: selected.provider,
        fallback: false,
      })),
      Effect.catch(error =>
        Effect.gen(function* () {
          const temporary =
            error.kind === 'transport' ||
            error.kind === 'timeout' ||
            (error.kind === 'http' &&
              (error.status === 408 ||
                error.status === 429 ||
                (error.status !== undefined &&
                  error.status >= 500 &&
                  error.status <= 599)));
          if (filtered || !temporary) return yield* Effect.fail(error);
          const alternate =
            selected.provider === 'openai' ? exa : yield* openai;
          if (!alternate) return yield* Effect.fail(error);
          const text = yield* attempt(alternate.run);
          return {text, provider: alternate.provider, fallback: true};
        }),
      ),
    );
    return `query: ${query}\nprovider: ${result.provider}\nselection: ${filtered ? 'domain filters' : selected.provider === preferred ? 'preferred' : 'available provider'}\nfallback: ${result.fallback}\n\n${result.text}`;
  });
}
