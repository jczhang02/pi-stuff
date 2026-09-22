import {Schema} from 'effect';

const NonBlank = Schema.String.check(Schema.isPattern(/\S/u));

export const NamingSettings = Schema.Struct({
  automatic: Schema.optional(Schema.Boolean),
  prompt: Schema.optional(NonBlank),
  maxLength: Schema.optional(
    Schema.Finite.check(Schema.isInt(), Schema.isGreaterThan(0)),
  ),
  model: Schema.optional(Schema.Struct({provider: NonBlank, id: NonBlank})),
});
export type NamingSettings = typeof NamingSettings.Type;
