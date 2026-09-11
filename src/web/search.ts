import {Effect, Schema} from 'effect';
import {WebError} from './errors';
import {readBody, type Network} from './network';
import {openAIResponse} from './openai-response';
import {textUrl} from './url';
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
type Provider = 'openai' | 'exa';
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
    const openai =
      preferred === 'exa' && credentials.exaKey
        ? undefined
        : yield* credentials.openai();
    const selected: Provider =
      preferred === 'exa' && credentials.exaKey
        ? 'exa'
        : openai
          ? 'openai'
          : 'exa';
    if (selected === 'exa' && !credentials.exaKey)
      return yield* Effect.fail(
        new WebError({
          kind: 'configuration',
          message:
            'Configure an official OpenAI search model/authentication or EXA_API_KEY.',
        }),
      );
    const maxResults = options.maxResults ?? 5;

    function attempt(provider: Provider, auth: OpenAI | undefined) {
      return Effect.gen(function* () {
        const isExa = provider === 'exa';
        if (!isExa && !auth)
          return yield* Effect.fail(
            new WebError({
              kind: 'configuration',
              message: 'OpenAI search is not configured.',
            }),
          );
        const endpoint = isExa
          ? 'https://api.exa.ai/search'
          : auth?.codex
            ? 'https://chatgpt.com/backend-api/codex/responses'
            : 'https://api.openai.com/v1/responses';
        const headers = isExa
          ? new Headers({'x-api-key': credentials.exaKey ?? ''})
          : new Headers(auth?.headers);
        headers.set('content-type', 'application/json');
        const body = isExa
          ? {
              query,
              type: 'auto',
              numResults: maxResults,
              includeDomains: filters.include,
              excludeDomains: filters.exclude,
              contents: {highlights: true, text: false},
            }
          : {
              model: auth?.model,
              instructions:
                'Search the web and answer concisely with source citations.',
              input: [
                {role: 'user', content: [{type: 'input_text', text: query}]},
              ],
              tools: [{type: 'web_search'}],
              tool_choice: 'required',
              include: ['web_search_call.action.sources'],
              store: false,
              stream: true,
            };
        const url = yield* textUrl(endpoint);
        const response = yield* network.request({
          url,
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        if (!response.ok)
          return yield* Effect.fail(
            new WebError({
              kind: 'http',
              status: response.status,
              message: `HTTP ${response.status}.`,
            }),
          );
        const raw = yield* readBody(response);
        if (isExa) {
          const data = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(ExaResponse),
          )(raw).pipe(
            Effect.mapError(
              () =>
                new WebError({
                  kind: 'response',
                  message: 'Malformed Exa response.',
                }),
            ),
          );
          const sources = data.results
            .filter(result => allowedSource(result.url, filters))
            .slice(0, maxResults);
          return sources
            .map(
              (source, index) =>
                `${index + 1}. ${source.title ?? source.url}\nurl: ${source.url}\nsource: ${new URL(source.url).hostname}\nsnippet: ${(source.highlights ?? []).join(' ')}`,
            )
            .join('\n\n');
        }
        const data = yield* openAIResponse(raw, maxResults);
        if (data.sources.some(source => !allowedSource(source.url, filters)))
          return yield* Effect.fail(
            new WebError({
              kind: 'response',
              message: 'Invalid OpenAI source URL.',
            }),
          );
        return `answer: ${data.answer}\n\ncitations: ${JSON.stringify(data.citations)}\n\n${data.sources.map((source, index) => `${index + 1}. ${source.title}\nurl: ${source.url}\nsource: ${new URL(source.url).hostname}\nsnippet: ${source.snippet}`).join('\n\n')}`;
      }).pipe(
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

    const result = yield* attempt(selected, openai).pipe(
      Effect.map(text => ({text, provider: selected, fallback: false})),
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
          const alternate: Provider = selected === 'openai' ? 'exa' : 'openai';
          const alternateAuth =
            alternate === 'openai' ? yield* credentials.openai() : undefined;
          if (alternate === 'exa' ? !credentials.exaKey : !alternateAuth)
            return yield* Effect.fail(error);
          const text = yield* attempt(alternate, alternateAuth);
          return {text, provider: alternate, fallback: true};
        }),
      ),
    );
    return `query: ${query}\nprovider: ${result.provider}\nselection: ${filtered ? 'domain filters' : selected === preferred ? 'preferred' : 'available provider'}\nfallback: ${result.fallback}\n\n${result.text}`;
  });
}
