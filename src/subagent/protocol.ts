import {Type, type Static} from 'typebox';

const Assignment = Type.Object({
  name: Type.String({minLength: 1}),
  prompt: Type.String({minLength: 1}),
  description: Type.Optional(
    Type.String({
      description:
        'Provide a short one-line assignment summary for the agent list and overview. Keep detailed instructions in prompt.',
    }),
  ),
  key: Type.Optional(
    Type.String({
      description:
        'Local key for other tasks in this dispatch to reference in needs.',
    }),
  ),
  needs: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Keys in this dispatch whose saved, fulfilled results must be available before this task starts.',
    }),
  ),
  inputs: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Task IDs of already saved, fulfilled results from earlier work. Use needs for tasks in this dispatch.',
    }),
  ),
  role: Type.Optional(Type.String()),
  instructions: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(
    Type.Enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
  ),
  tools: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Omit to use workspace-appropriate tools within the parent ceiling. An explicit list must include subagent for delivery and communication. bash requires workspace write or direct, even for running tests.',
    }),
  ),
  cwd: Type.Optional(Type.String()),
  workspace: Type.Optional(
    Type.Union(
      [
        Type.Literal('snapshot'),
        Type.Literal('write'),
        Type.Literal('live'),
        Type.Literal('direct'),
      ],
      {
        description:
          'Default snapshot: isolated read-only code, no bash. write: isolated writable Git worktree, needed to run tests or edit. live: read-only current directory. direct: write in the selected directory. Reviewing code AND running tests needs write; it does not apply changes to main.',
      },
    ),
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
  files: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'For finish: every changed file to include in the fixed code artifact, relative to the child working directory. Omitting changed files prevents successful delivery.',
    }),
  ),
  checks: Type.Optional(Type.Array(Type.String())),
  timeoutMs: Type.Optional(
    Type.Number({
      minimum: 1,
      description:
        'Bounded event wait. Omit for the configured wait duration; do not repeatedly poll with short waits. A timeout does not cancel work.',
    }),
  ),
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
