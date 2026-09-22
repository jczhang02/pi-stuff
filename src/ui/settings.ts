import {Schema} from 'effect';

const PreviewLines = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const UiSettings = Schema.Struct({
  retrievalGroups: Schema.optional(Schema.Boolean),
  enabled: Schema.optional(Schema.Boolean),
  welcome: Schema.optional(Schema.Boolean),
  bashPreviewLines: Schema.optional(PreviewLines),
  bashRunningPreviewLines: Schema.optional(PreviewLines),
  writePreviewLines: Schema.optional(PreviewLines),
  editPreviewLines: Schema.optional(PreviewLines),
});
export type UiSettings = typeof UiSettings.Type;
