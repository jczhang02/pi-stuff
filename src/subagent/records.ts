import {Schema, Struct} from 'effect';

const Question = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  expiresAt: Schema.Number,
});
const Workspace = Schema.Struct({
  root: Schema.String,
  path: Schema.String,
  cwd: Schema.String,
  branch: Schema.String,
  base: Schema.String,
});
const WorkspaceSaveResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('empty'),
    diffStat: Schema.Literal(''),
    changedFiles: Schema.Tuple([]),
  }),
  Schema.Struct({
    status: Schema.Literal('committed'),
    commitSha: Schema.String,
    diffStat: Schema.String,
    changedFiles: Schema.Array(Schema.String),
  }),
]);

export const Usage = Schema.Struct({
  input: Schema.optional(Schema.Number),
  output: Schema.optional(Schema.Number),
  cacheRead: Schema.optional(Schema.Number),
  cacheWrite: Schema.optional(Schema.Number),
  cost: Schema.optional(Schema.Number),
  turns: Schema.Number,
}).mapFields(Struct.map(Schema.mutableKey));
export type Usage = typeof Usage.Type;

const requestFields = {
  id: Schema.NonEmptyString,
  agent: Schema.String,
  task: Schema.String,
  cwd: Schema.String,
  prompt: Schema.String,
  write: Schema.Boolean,
  tools: Schema.mutable(Schema.Array(Schema.String)),
  explicitTools: Schema.Boolean,
  model: Schema.optional(Schema.String),
  thinking: Schema.optional(
    Schema.Literals([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]),
  ),
  needs: Schema.mutable(Schema.Array(Schema.String)),
  maxRuntimeMs: Schema.Number,
  requestId: Schema.NonEmptyString,
  startEntryId: Schema.optional(Schema.String),
  endEntryId: Schema.optional(Schema.String),
  usage: Schema.optional(Usage),
  status: Schema.Literals([
    'queued',
    'starting',
    'running',
    'awaiting_parent',
    'stopping',
    'completed',
    'failed',
    'stopped',
    'skipped',
  ]),
  finalText: Schema.String,
  error: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.Number),
  endedAt: Schema.optional(Schema.Number),
  sessionId: Schema.optional(Schema.String),
  sessionFile: Schema.optional(Schema.String),
  question: Schema.optional(Question),
  pendingInstructions: Schema.mutable(Schema.Array(Schema.String)),
  workspace: Schema.optional(Workspace),
  git: Schema.optional(WorkspaceSaveResult),
  preservationError: Schema.optional(Schema.String),
  cleanupError: Schema.optional(Schema.String),
  notificationError: Schema.optional(Schema.String),
  extensionErrors: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  finalizing: Schema.optional(Schema.Boolean),
  roleSource: Schema.optional(Schema.String),
  configurationNotes: Schema.mutable(Schema.Array(Schema.String)),
  provider: Schema.optional(Schema.String),
};
export const RequestRecord = Schema.Struct(requestFields).mapFields(
  Struct.map(Schema.mutableKey),
);
export type RequestRecord = typeof RequestRecord.Type;
export const TaskSnapshot = Schema.Struct({
  ...requestFields,
  history: Schema.mutable(Schema.Array(RequestRecord)),
  cumulativeUsage: Schema.optional(Usage),
}).mapFields(Struct.map(Schema.mutableKey));
export type TaskSnapshot = typeof TaskSnapshot.Type;

export const RunSnapshot = Schema.Struct({
  id: Schema.NonEmptyString,
  mode: Schema.Literals(['single', 'parallel', 'chain']),
  notifyPerTask: Schema.Boolean,
  status: Schema.Literals(['running', 'completed', 'failed', 'stopped']),
  tasks: Schema.mutable(Schema.Array(TaskSnapshot)),
  intercom: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        taskId: Schema.String,
        text: Schema.String,
        level: Schema.Literals(['info', 'warning', 'error']),
      }),
    ),
  ),
  persistenceError: Schema.optional(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey));
export type RunSnapshot = typeof RunSnapshot.Type;
