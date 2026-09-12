import {StringEnum} from '@earendil-works/pi-ai';
import {Type} from 'typebox';
export const DEFAULT_CONCURRENCY = 3;
export const MAX_CONCURRENCY = 8;

export const THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
const TaskItem = Type.Object({
  id: Type.Optional(Type.String({description: 'Optional stable task id'})),
  agent: Type.String({
    minLength: 1,
    description: 'Agent name you invent (defined inline via `prompt`)',
  }),
  task: Type.String({minLength: 1, description: 'Task for this agent'}),
  prompt: Type.Optional(
    Type.String({description: "System prompt defining this agent's behavior"}),
  ),
  write: Type.Optional(
    Type.Boolean({
      description:
        'true = write toolset (adds bash, edit, write); default false = read-only (read, grep, find, ls)',
    }),
  ),
  model: Type.Optional(
    Type.String({description: 'Model override (provider/model-id)'}),
  ),
  thinking: Type.Optional(
    StringEnum(THINKING_LEVELS, {description: 'Thinking level override'}),
  ),
  cwd: Type.Optional(
    Type.String({description: 'Working directory (default: current project)'}),
  ),
  tools: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Explicit tool allowlist (overrides the toolset)',
    }),
  ),
  maxRuntimeMs: Type.Optional(
    Type.Number({description: 'Per-task timeout (ms)'}),
  ),
  needs: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Ids of tasks this one waits for; their outputs are prepended to this prompt.',
    }),
  ),
});

export const SubagentParams = Type.Object({
  agent: Type.Optional(
    Type.String({
      minLength: 1,
      description: 'Name you invent for this subagent (single mode)',
    }),
  ),
  task: Type.Optional(
    Type.String({minLength: 1, description: 'Task (single mode)'}),
  ),
  prompt: Type.Optional(
    Type.String({description: 'System prompt for this agent (single mode)'}),
  ),
  write: Type.Optional(
    Type.Boolean({
      description:
        'true = write toolset; default false = read-only (single mode)',
    }),
  ),
  tools: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Explicit tool allowlist (overrides the toolset) (single mode)',
    }),
  ),
  tasks: Type.Optional(Type.Array(TaskItem, {description: 'Parallel tasks'})),
  chain: Type.Optional(
    Type.Array(TaskItem, {
      description: 'Sequential tasks; {previous} = prior output',
    }),
  ),
  model: Type.Optional(
    Type.String({description: 'Model override (single mode)'}),
  ),
  thinking: Type.Optional(
    StringEnum(THINKING_LEVELS, {
      description: 'Thinking level override (single mode)',
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: 'Working directory (single mode). Default: current project.',
    }),
  ),
  concurrency: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_CONCURRENCY,
      description: `Parallel concurrency (default ${DEFAULT_CONCURRENCY}, max ${MAX_CONCURRENCY})`,
    }),
  ),
  maxRuntimeMs: Type.Optional(
    Type.Number({
      description:
        'Per-task timeout, ms. Omit unless a hard bound is genuinely required — a 1 h default ceiling applies (maximum 6 h).',
    }),
  ),
  autoAwait: Type.Optional(
    Type.Boolean({
      description:
        'Wait up to 60 seconds for completion or a child question and return inline. Default false.',
    }),
  ),
  notifyPerTask: Type.Optional(
    Type.Boolean({
      description:
        'Notify the parent as each task completes. Default true; notifications stay outside the visible Follow-up queue.',
      default: true,
    }),
  ),
});

export interface TaskInput {
  id?: string | undefined;
  agent: string;
  task: string;
  prompt?: string | undefined;
  write?: boolean | undefined;
  model?: string | undefined;
  thinking?: (typeof THINKING_LEVELS)[number] | undefined;
  cwd?: string | undefined;
  tools?: string[] | undefined;
  maxRuntimeMs?: number | undefined;
  needs?: string[] | undefined;
}
export interface SubagentInput extends Omit<
  TaskInput,
  'id' | 'agent' | 'task' | 'needs'
> {
  agent?: string | undefined;
  task?: string | undefined;
  tasks?: TaskInput[] | undefined;
  chain?: TaskInput[] | undefined;
  concurrency?: number | undefined;
  autoAwait?: boolean | undefined;
  notifyPerTask?: boolean | undefined;
}

export const ResultParam = Type.Object({
  runId: Type.String(),
  taskId: Type.Optional(
    Type.String({description: 'Specific task id; defaults to all'}),
  ),
});
export const AwaitParam = Type.Object({
  runId: Type.String(),
  timeoutMs: Type.Optional(
    Type.Number({
      description:
        'Maximum wait in ms, bounded to 60000; returns early for questions or completion',
    }),
  ),
});
export const ReplyParam = Type.Object({
  runId: Type.String(),
  taskId: Type.String(),
  message: Type.String({description: 'Answer for the child'}),
});
export const ResumeParam = Type.Object({
  runId: Type.String(),
  taskId: Type.String({
    description: 'Completed, failed or aborted task to continue',
  }),
  message: Type.Optional(
    Type.String({
      description:
        'Prompt delivered on resume (default: recap state, then continue the original task)',
    }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        'Model override for the resumed session (provider/model-id) — use when the original provider is rate-limited',
    }),
  ),
});
export const SteerParam = Type.Object({
  runId: Type.String(),
  taskId: Type.Optional(
    Type.String({
      description: 'Specific task id; defaults to all still-running tasks',
    }),
  ),
  message: Type.String({
    description: "Steering message to inject into the child's session",
  }),
});
