import {Schema} from 'effect';

export const NamingSettings = Schema.Struct({
  model: Schema.optional(
    Schema.Struct({provider: Schema.String, id: Schema.String}),
  ),
});
export type NamingSettings = typeof NamingSettings.Type;
