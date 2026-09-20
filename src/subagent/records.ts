import {Schema} from 'effect';
import {Workspace} from './workspace';

export const EffectiveConfiguration = Schema.Struct({
  model: Schema.String,
  thinking: Schema.Literals([
    'off',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ]),
  tools: Schema.Array(Schema.String),
  ceiling: Schema.Array(Schema.String),
  cwd: Schema.String,
  workspace: Schema.Literals(['snapshot', 'write', 'live', 'direct']),
  instructions: Schema.String,
  role: Schema.NullOr(Schema.String),
  copyHistory: Schema.Boolean,
  executionTimeoutMs: Schema.NullOr(Schema.Number),
  extensions: Schema.Array(Schema.String),
  baseline: Schema.NullOr(Schema.String),
  include: Schema.Array(Schema.String),
});
export type EffectiveConfiguration = typeof EffectiveConfiguration.Type;

const Usage = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  cost: Schema.Number,
});

export const TaskRecord = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  dispatchId: Schema.String,
  parentTaskId: Schema.NullOr(Schema.String),
  prompt: Schema.String,
  description: Schema.String,
  needs: Schema.Array(Schema.String),
  admittedAt: Schema.Number,
  startedAt: Schema.NullOr(Schema.Number),
  endedAt: Schema.NullOr(Schema.Number),
  phase: Schema.Literals([
    'queued',
    'starting',
    'executing',
    'waiting',
    'cancelling',
    'ended',
    'unknown',
  ]),
  outcome: Schema.NullOr(
    Schema.Literals([
      'fulfilled',
      'unable',
      'incomplete',
      'failed',
      'cancelled',
      'skipped',
      'interrupted',
    ]),
  ),
  declaration: Schema.NullOr(Schema.Literals(['fulfilled', 'unable'])),
  stopOutcome: Schema.NullOr(Schema.Literals(['cancelled', 'interrupted'])),
  durability: Schema.Literals(['pending', 'saved', 'failed']),
  acceptance: Schema.NullOr(Schema.Boolean),
  reason: Schema.String,
  stage: Schema.String,
  liveText: Schema.String,
  activeTools: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      startedAt: Schema.Number,
      progress: Schema.String,
    }),
  ),
  report: Schema.String,
  files: Schema.Array(Schema.String),
  checks: Schema.Array(Schema.String),
  configuration: EffectiveConfiguration,
  currentTools: Schema.Array(Schema.String),
  usage: Schema.NullOr(Usage),
  turns: Schema.Number,
  retries: Schema.Number,
  executionMs: Schema.Number,
  lastEventAt: Schema.Number,
  sessionFile: Schema.NullOr(Schema.String),
  historyFile: Schema.NullOr(Schema.String),
  workspaceDirectory: Schema.NullOr(Schema.String),
  baseline: Schema.NullOr(Schema.String),
  commit: Schema.NullOr(Schema.String),
  baselineRequest: Schema.NullOr(Schema.String),
  diff: Schema.String,
  artifactError: Schema.NullOr(Schema.String),
  unsavedFiles: Schema.Array(Schema.String),
  ignoredFiles: Schema.Array(Schema.String),
  events: Schema.Array(
    Schema.Struct({
      at: Schema.Number,
      kind: Schema.String,
      text: Schema.String,
    }),
  ),
  consumedChildren: Schema.Array(Schema.String),
});
export type TaskRecord = typeof TaskRecord.Type;

export const AgentRecord = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  dispatchId: Schema.String,
  parentAgentId: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  depth: Schema.Number,
  configuration: EffectiveConfiguration,
  currentTools: Schema.Array(Schema.String),
  sessionFile: Schema.NullOr(Schema.String),
  workspace: Schema.NullOr(Workspace),
  held: Schema.Boolean,
  released: Schema.Boolean,
});
export type AgentRecord = typeof AgentRecord.Type;

export const Communication = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['message', 'steer', 'question', 'reply', 'report']),
  fromTaskId: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  questionId: Schema.NullOr(Schema.String),
  text: Schema.String,
  receivedAt: Schema.Number,
  consumedAt: Schema.NullOr(Schema.Number),
  expiresAt: Schema.NullOr(Schema.Number),
});
export type Communication = typeof Communication.Type;

export const FleetRecord = Schema.Struct({
  version: Schema.Literal(1),
  sessionId: Schema.String,
  revision: Schema.Number,
  storageError: Schema.NullOr(Schema.String),
  agents: Schema.Array(AgentRecord),
  tasks: Schema.Array(TaskRecord),
  dispatches: Schema.Array(
    Schema.Struct({id: Schema.String, admitted: Schema.Number}),
  ),
  messages: Schema.Array(Communication),
  notices: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      taskId: Schema.String,
      text: Schema.String,
      acknowledged: Schema.Boolean,
    }),
  ),
});
export type FleetRecord = typeof FleetRecord.Type;
