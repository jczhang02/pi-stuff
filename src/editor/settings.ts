import {Schema} from 'effect';
export const Keyword = Schema.Struct({
  pattern: Schema.String,
  caseSensitive: Schema.optional(Schema.Boolean),
});
export const EditorSettings = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  keywords: Schema.optional(Schema.Array(Keyword)),
});
export type EditorSettings = typeof EditorSettings.Type;
export const Match = Schema.Struct({start: Schema.Number, end: Schema.Number});
export type Match = typeof Match.Type;
