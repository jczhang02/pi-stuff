// Protocol parsing adapted from pi-web-access 0.28.0, e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5.
// Copyright (c) 2025 Nico Bailon. MIT; see THIRD_PARTY_LICENSES/pi-web-access.txt.
import {Effect, Schema} from 'effect';
import {WebError} from './errors';

const Annotation = Schema.Struct({
  type: Schema.String,
  url: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  start_index: Schema.optional(Schema.Int),
  end_index: Schema.optional(Schema.Int),
});
const OutputItem = Schema.Struct({
  type: Schema.String,
  content: Schema.optional(
    Schema.Array(
      Schema.Struct({
        type: Schema.String,
        text: Schema.optional(Schema.String),
        annotations: Schema.optional(Schema.Array(Annotation)),
      }),
    ),
  ),
  action: Schema.optional(
    Schema.Struct({
      sources: Schema.optional(
        Schema.Array(
          Schema.Struct({
            type: Schema.optional(Schema.String),
            url: Schema.optional(Schema.String),
            title: Schema.optional(Schema.String),
          }),
        ),
      ),
    }),
  ),
});
const ResponsePayload = Schema.Struct({
  status: Schema.String,
  output: Schema.Array(OutputItem),
});
const Event = Schema.Struct({
  type: Schema.String,
  response: Schema.optional(ResponsePayload),
  item: Schema.optional(OutputItem),
});

export function openAIResponse(raw: string, maxResults: number) {
  return Effect.gen(function* () {
    let payload: typeof ResponsePayload.Type | undefined;
    // Codex may omit Content-Type. Decode the actual JSON or SSE envelope.
    if (raw.trimStart().startsWith('{'))
      payload = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(ResponsePayload),
      )(raw);
    else {
      const completedItems: (typeof OutputItem.Type)[] = [];
      for (const block of raw.split(/\r?\n\r?\n/)) {
        const data = block
          .split(/\r?\n/)
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart())
          .join('\n');
        if (!data || data === '[DONE]') continue;
        const event = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Event),
        )(data);
        if (
          ['response.failed', 'response.incomplete', 'error'].includes(
            event.type,
          )
        )
          return yield* Effect.fail(
            new WebError({
              kind: 'response',
              message: 'OpenAI search did not complete.',
            }),
          );
        if (event.type === 'response.output_item.done' && event.item)
          completedItems.push(event.item);
        if (['response.completed', 'response.done'].includes(event.type))
          payload = event.response;
      }
      if (payload && payload.output.length === 0) {
        payload = {...payload, output: completedItems};
      }
    }
    if (
      !payload ||
      payload.status !== 'completed' ||
      !payload.output.some(item => item.type === 'web_search_call')
    ) {
      return yield* Effect.fail(
        new WebError({
          kind: 'response',
          message: 'OpenAI response lacks a completed web search.',
        }),
      );
    }
    const answers: string[] = [];
    const citations: (typeof Annotation.Type)[] = [];
    const sources = new Map<
      string,
      {title: string; url: string; snippet: string}
    >();
    for (const item of payload.output) {
      if (item.type !== 'message') continue;
      if (!item.content)
        return yield* Effect.fail(
          new WebError({
            kind: 'response',
            message: 'Malformed OpenAI message.',
          }),
        );
      for (const part of item.content) {
        if (part.type !== 'output_text') continue;
        if (part.text === undefined)
          return yield* Effect.fail(
            new WebError({
              kind: 'response',
              message: 'Malformed OpenAI answer.',
            }),
          );
        answers.push(part.text);
        for (const annotation of part.annotations ?? []) {
          if (annotation.type !== 'url_citation') continue;
          if (
            !annotation.url ||
            annotation.start_index === undefined ||
            annotation.end_index === undefined
          )
            return yield* Effect.fail(
              new WebError({
                kind: 'response',
                message: 'Malformed OpenAI citation.',
              }),
            );
          citations.push(annotation);
          sources.set(annotation.url, {
            title: annotation.title ?? annotation.url,
            url: annotation.url,
            snippet: part.text.slice(
              Math.max(0, annotation.start_index - 100),
              annotation.end_index + 100,
            ),
          });
        }
      }
    }
    for (const item of payload.output) {
      if (item.type !== 'web_search_call') continue;
      for (const source of item.action?.sources ?? []) {
        if (source.url && !sources.has(source.url))
          sources.set(source.url, {
            title: source.title ?? source.url,
            url: source.url,
            snippet: '',
          });
      }
    }
    return {
      answer: answers.join('\n'),
      citations,
      sources: [...sources.values()].slice(0, maxResults),
    };
  }).pipe(
    Effect.mapError(
      () =>
        new WebError({
          kind: 'response',
          message: 'Malformed or incomplete OpenAI search response.',
        }),
    ),
  );
}
