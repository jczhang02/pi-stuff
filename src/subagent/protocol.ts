import {Type, type Static} from 'typebox';

const Assignment = Type.Object({
  name: Type.String({minLength: 1}),
  prompt: Type.String({minLength: 1}),
  description: Type.Optional(Type.String()),
  key: Type.Optional(Type.String()),
  needs: Type.Optional(Type.Array(Type.String())),
  inputs: Type.Optional(Type.Array(Type.String())),
  role: Type.Optional(Type.String()),
  instructions: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(
    Type.Enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
  ),
  tools: Type.Optional(Type.Array(Type.String())),
  cwd: Type.Optional(Type.String()),
  workspace: Type.Optional(
    Type.Union([
      Type.Literal('snapshot'),
      Type.Literal('write'),
      Type.Literal('live'),
      Type.Literal('direct'),
    ]),
  ),
  include: Type.Optional(Type.Array(Type.String())),
  baseline: Type.Optional(Type.String()),
  copyHistory: Type.Optional(Type.Boolean()),
  executionTimeoutMs: Type.Optional(Type.Number({minimum: 1})),
  extensions: Type.Optional(Type.Array(Type.String())),
});

export const SubagentInput = Type.Object({
  command: Type.Enum([
    'dispatch',
    'inspect',
    'wait',
    'finish',
    'report',
    'message',
    'steer',
    'ask',
    'reply',
    'followup',
    'cancel',
    'roles',
    'read',
    'release',
    'restrict',
    'queue',
    'accept',
    'acknowledge',
  ]),
  tasks: Type.Optional(Type.Array(Assignment, {minItems: 1})),
  overrides: Type.Optional(
    Type.Omit(Assignment, ['name', 'prompt', 'key', 'needs', 'inputs']),
  ),
  taskId: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  dispatchId: Type.Optional(Type.String()),
  questionId: Type.Optional(Type.String()),
  noticeId: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  outcome: Type.Optional(
    Type.Union([Type.Literal('fulfilled'), Type.Literal('unable')]),
  ),
  files: Type.Optional(Type.Array(Type.String())),
  checks: Type.Optional(Type.Array(Type.String())),
  timeoutMs: Type.Optional(Type.Number({minimum: 1})),
  tools: Type.Optional(Type.Array(Type.String())),
  recovery: Type.Optional(Type.Boolean()),
  accepted: Type.Optional(Type.Boolean()),
  queueAction: Type.Optional(Type.Enum(['continue', 'cancel'])),
  offset: Type.Optional(Type.Integer({minimum: 0})),
  length: Type.Optional(Type.Integer({minimum: 1, maximum: 16000})),
  record: Type.Optional(
    Type.Union([
      Type.Literal('report'),
      Type.Literal('transcript'),
      Type.Literal('diff'),
    ]),
  ),
});

export type SubagentInput = Static<typeof SubagentInput>;
export type Assignment = Static<typeof Assignment>;
