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

export const DEFAULT_NAMING_PROMPT =
  'Use English with the exact format "<type>: <Action object>", including a literal colon and space, without quotation marks. Types: research, feat, fix, refactor, docs, chore. Prefer 4-8 description words. Describe the whole requested task, not its current phase. Preserve technical identifier casing. Omit scope parentheses, dates, progress and completion state.';
