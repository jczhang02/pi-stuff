import {Schema} from 'effect';

export const NamingSettings = Schema.Struct({
  automatic: Schema.optional(Schema.Boolean),
  prompt: Schema.optional(Schema.NonEmptyString),
  maxLength: Schema.optional(
    Schema.Finite.check(Schema.isInt(), Schema.isGreaterThan(0)),
  ),
  model: Schema.optional(
    Schema.Struct({provider: Schema.NonEmptyString, id: Schema.NonEmptyString}),
  ),
});
export type NamingSettings = typeof NamingSettings.Type;
