import type {SessionEntry} from '@earendil-works/pi-coding-agent';
import {Schema} from 'effect';

const text = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String,
  textSignature: Schema.optionalKey(Schema.String),
});
const image = Schema.Struct({
  type: Schema.Literal('image'),
  data: Schema.String,
  mimeType: Schema.String,
});
const textAndImages = Schema.mutable(Schema.Array(Schema.Union([text, image])));
const content = Schema.Union([Schema.String, textAndImages]);
const usage = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  cacheWrite1h: Schema.optionalKey(Schema.Number),
  reasoning: Schema.optionalKey(Schema.Number),
  totalTokens: Schema.Number,
  cost: Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
    cacheRead: Schema.Number,
    cacheWrite: Schema.Number,
    total: Schema.Number,
  }),
});
// Pi 0.86 records prompt/tool changes in the transcript. Keep these as host
// records, without pretending they are part of the pinned 0.85 SDK union.
const systemMessage = Schema.Struct({
  role: Schema.Literal('system'),
  content: Schema.Union([Schema.String, Schema.mutable(Schema.Array(text))]),
  sections: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
  ),
  toolsAdded: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        description: Schema.String,
        parameters: Schema.Record(Schema.String, Schema.MutableJson),
      }),
    ),
  ),
  toolsRemoved: Schema.optionalKey(
    Schema.Array(Schema.Struct({name: Schema.String})),
  ),
  timestamp: Schema.Number,
});
const message = Schema.Union([
  Schema.Struct({
    role: Schema.Literal('user'),
    content,
    timestamp: Schema.Number,
  }),
  Schema.Struct({
    role: Schema.Literal('assistant'),
    content: Schema.mutable(
      Schema.Array(
        Schema.Union([
          text,
          Schema.Struct({
            type: Schema.Literal('thinking'),
            thinking: Schema.String,
            thinkingSignature: Schema.optionalKey(Schema.String),
            redacted: Schema.optionalKey(Schema.Boolean),
          }),
          Schema.Struct({
            type: Schema.Literal('toolCall'),
            id: Schema.String,
            name: Schema.String,
            arguments: Schema.Record(Schema.String, Schema.Unknown),
            thoughtSignature: Schema.optionalKey(Schema.String),
            namespace: Schema.optionalKey(Schema.String),
          }),
        ]),
      ),
    ),
    api: Schema.String,
    provider: Schema.String,
    model: Schema.String,
    usage,
    stopReason: Schema.Literals([
      'pending',
      'stop',
      'length',
      'toolUse',
      'error',
      'aborted',
      'deferred',
    ]),
    timestamp: Schema.Number,
    responseModel: Schema.optionalKey(Schema.String),
    responseId: Schema.optionalKey(Schema.String),
    providerThinkingLevel: Schema.optionalKey(Schema.String),
    errorMessage: Schema.optionalKey(Schema.String),
    rawStopReason: Schema.optionalKey(Schema.String),
    endTurn: Schema.optionalKey(Schema.Boolean),
    diagnostics: Schema.optionalKey(
      Schema.mutable(
        Schema.Array(
          Schema.Struct({
            type: Schema.String,
            timestamp: Schema.Number,
            error: Schema.optionalKey(
              Schema.Struct({
                name: Schema.optionalKey(Schema.String),
                message: Schema.String,
                stack: Schema.optionalKey(Schema.String),
                code: Schema.optionalKey(
                  Schema.Union([Schema.String, Schema.Number]),
                ),
              }),
            ),
            details: Schema.optionalKey(
              Schema.Record(Schema.String, Schema.Unknown),
            ),
          }),
        ),
      ),
    ),
    deferred: Schema.optionalKey(
      Schema.Struct({
        provider: Schema.String,
        modelId: Schema.String,
        api: Schema.String,
        id: Schema.String,
        expiresAt: Schema.optionalKey(Schema.Number),
        pollAfterMs: Schema.optionalKey(Schema.Number),
        data: Schema.optionalKey(Schema.MutableJson),
      }),
    ),
  }),
  Schema.Struct({
    role: Schema.Literal('toolResult'),
    toolCallId: Schema.String,
    toolName: Schema.String,
    content: textAndImages,
    details: Schema.optionalKey(Schema.Unknown),
    usage: Schema.optionalKey(usage),
    addedToolNames: Schema.optionalKey(
      Schema.mutable(Schema.Array(Schema.String)),
    ),
    isError: Schema.Boolean,
    timestamp: Schema.Number,
  }),
  Schema.Struct({
    role: Schema.Literal('custom'),
    customType: Schema.String,
    content,
    display: Schema.Boolean,
    details: Schema.optionalKey(Schema.Unknown),
    timestamp: Schema.Number,
  }),
  Schema.Struct({
    role: Schema.Literal('bashExecution'),
    command: Schema.String,
    output: Schema.String,
    exitCode: Schema.optionalKey(Schema.Number),
    cancelled: Schema.Boolean,
    truncated: Schema.Boolean,
    fullOutputPath: Schema.optionalKey(Schema.String),
    excludeFromContext: Schema.optionalKey(Schema.Boolean),
    timestamp: Schema.Number,
  }),
  Schema.Struct({
    role: Schema.Literal('branchSummary'),
    summary: Schema.String,
    fromId: Schema.NullOr(Schema.String),
    timestamp: Schema.Number,
  }),
  Schema.Struct({
    role: Schema.Literal('compactionSummary'),
    summary: Schema.String,
    tokensBefore: Schema.Number,
    timestamp: Schema.Number,
  }),
]);
const base = {
  id: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  timestamp: Schema.String,
};
const summary = {
  summary: Schema.String,
  details: Schema.optionalKey(Schema.Unknown),
  usage: Schema.optionalKey(usage),
  fromHook: Schema.optionalKey(Schema.Boolean),
};
const systemEntry = Schema.Struct({
  ...base,
  type: Schema.Literal('message'),
  message: systemMessage,
});
const usageEntry = Schema.Struct({
  ...base,
  type: Schema.Literal('usage'),
  kind: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  usage,
  note: Schema.optionalKey(Schema.String),
});

export type PersistedSessionEntry =
  | SessionEntry
  | typeof systemEntry.Type
  | typeof usageEntry.Type;

const Entry = Schema.Union([
  systemEntry,
  usageEntry,
  Schema.Struct({...base, type: Schema.Literal('message'), message}),
  Schema.Struct({
    ...base,
    type: Schema.Literal('thinking_level_change'),
    thinkingLevel: Schema.String,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal('model_change'),
    provider: Schema.String,
    modelId: Schema.String,
  }),
  Schema.Struct({
    ...base,
    ...summary,
    type: Schema.Literal('compaction'),
    firstKeptEntryId: Schema.String,
    tokensBefore: Schema.Number,
    systemMessage: Schema.optionalKey(systemMessage),
  }),
  Schema.Struct({
    ...base,
    ...summary,
    type: Schema.Literal('branch_summary'),
    fromId: Schema.String,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal('custom'),
    customType: Schema.String,
    data: Schema.optionalKey(Schema.Unknown),
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal('custom_message'),
    customType: Schema.String,
    content,
    display: Schema.Boolean,
    details: Schema.optionalKey(Schema.Unknown),
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal('label'),
    targetId: Schema.String,
    label: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal('session_info'),
    name: Schema.optionalKey(Schema.String),
  }),
]);

/** Validate retained host records before the executing host's SDK opens them. */
export function decodeSessionRecord(serialized: string): PersistedSessionEntry {
  const entry = Schema.decodeUnknownSync(Schema.fromJsonString(Entry), {
    onExcessProperty: 'preserve',
  })(serialized);
  if (entry.type === 'label') return {...entry, label: entry.label};
  if (entry.type === 'message') {
    const value = entry.message;
    if (value.role === 'system') return {...entry, message: value};
    return {
      ...entry,
      message:
        value.role === 'bashExecution'
          ? {...value, exitCode: value.exitCode}
          : value,
    };
  }
  return entry;
}
