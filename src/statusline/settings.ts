import {Schema} from 'effect';

export const StatuslineSettings = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
});
export type StatuslineSettings = typeof StatuslineSettings.Type;
