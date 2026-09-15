import {Schema} from 'effect';

export const RtkSettings = Schema.Struct({
  rewrite: Schema.optional(Schema.Boolean),
  ansi: Schema.optional(Schema.Boolean),
  executable: Schema.optional(Schema.String),
});
export type RtkSettings = typeof RtkSettings.Type;
