import {Schema} from 'effect';

export const UiSettings = Schema.Struct({
  retrievalGroups: Schema.optional(Schema.Boolean),
  enabled: Schema.optional(Schema.Boolean),
  bashPreviewLines: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
});
export type UiSettings = typeof UiSettings.Type;
