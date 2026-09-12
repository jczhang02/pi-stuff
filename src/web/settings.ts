import {Schema} from 'effect';

export const WebSettings = Schema.Struct({
  provider: Schema.optional(Schema.Literals(['openai', 'exa'])),
  openaiModel: Schema.optional(
    Schema.Struct({
      provider: Schema.NonEmptyString,
      id: Schema.NonEmptyString,
    }),
  ),
});
export type WebSettings = typeof WebSettings.Type;
