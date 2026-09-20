import {Schema} from 'effect';

const positive = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0));
export const ThinkingLevel = Schema.Literals([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
export type ThinkingLevel = typeof ThinkingLevel.Type;

export const Workspace = Schema.Literals([
  'snapshot',
  'write',
  'live',
  'direct',
]);
export type Workspace = typeof Workspace.Type;

export const SubagentDefaults = Schema.Struct({
  model: Schema.optional(Schema.String),
  thinking: Schema.optional(ThinkingLevel),
  tools: Schema.optional(Schema.Array(Schema.String)),
  instructions: Schema.optional(Schema.String),
  executionTimeoutMs: Schema.optional(positive),
  extensions: Schema.optional(Schema.Array(Schema.String)),
  cwd: Schema.optional(Schema.String),
  workspace: Schema.optional(Workspace),
  copyHistory: Schema.optional(Schema.Boolean),
  baseline: Schema.optional(Schema.String),
  include: Schema.optional(Schema.Array(Schema.String)),
});
export type SubagentDefaults = typeof SubagentDefaults.Type;

export const SubagentSettings = Schema.Struct({
  concurrency: Schema.optional(positive),
  tasksPerDispatch: Schema.optional(positive),
  maxDepth: Schema.optional(positive),
  resultWaitMs: Schema.optional(positive),
  answerWaitMs: Schema.optional(positive),
  previewCharacters: Schema.optional(positive),
  inspectShortcut: Schema.optional(Schema.String),
  defaults: Schema.optional(SubagentDefaults),
  rolePaths: Schema.optional(Schema.Array(Schema.String)),
});
export type SubagentSettings = typeof SubagentSettings.Type;
