import {StringEnum} from '@earendil-works/pi-ai';
import {Type, type Static} from 'typebox';
import {Value} from 'typebox/value';
import {resolve} from 'node:path';
import {resolveNeeds, type RunMode} from './graph';
import {SubagentError} from './session';

const taskFields = {
  id: Type.Optional(Type.String({pattern: '^[A-Za-z0-9_-]{1,64}$'})),
  agent: Type.String({minLength: 1}),
  task: Type.String({minLength: 1}),
  cwd: Type.Optional(Type.String({minLength: 1})),
  needs: Type.Optional(Type.Array(Type.String())),
};
const task = Type.Object(taskFields);

export const subagentParameters = Type.Object({
  command: StringEnum(['dispatch', 'status', 'result', 'wait', 'cancel']),
  agent: Type.Optional(taskFields.agent),
  task: Type.Optional(taskFields.task),
  cwd: taskFields.cwd,
  tasks: Type.Optional(Type.Array(task, {minItems: 1, maxItems: 16})),
  chain: Type.Optional(Type.Array(task, {minItems: 1, maxItems: 16})),
  concurrency: Type.Optional(Type.Integer({minimum: 1, maximum: 8})),
  autoAwait: Type.Optional(Type.Boolean()),
  notifyPerTask: Type.Optional(Type.Boolean()),
  runId: Type.Optional(Type.String({minLength: 1})),
  taskId: Type.Optional(Type.String({minLength: 1})),
  timeoutMs: Type.Optional(Type.Number({minimum: 0})),
});
export type SubagentParameters = Static<typeof subagentParameters>;

export interface TaskInput {
  id: string;
  agent: string;
  task: string;
  cwd: string;
  needs: string[];
}

export interface Dispatch {
  mode: RunMode;
  tasks: TaskInput[];
  concurrency: number;
  autoAwait: boolean;
  notifyPerTask: boolean;
}

export function validateParameters(input: SubagentParameters): void {
  if (!Value.Check(subagentParameters, input))
    throw new SubagentError({message: 'Invalid subagent arguments.'});
  if (input.command !== 'dispatch' && !input.runId)
    throw new SubagentError({message: 'A runId is required.'});
}

export function dispatchInput(
  input: SubagentParameters,
  parentCwd: string,
): Dispatch {
  const forms =
    Number(input.tasks !== undefined) +
    Number(input.chain !== undefined) +
    Number(input.agent !== undefined || input.task !== undefined);
  if (forms !== 1)
    throw new SubagentError({
      message: 'Choose one dispatch form: agent/task, tasks, or chain.',
    });
  let mode: RunMode;
  let inputs: Static<typeof task>[];
  if (input.tasks) {
    mode = 'parallel';
    inputs = input.tasks;
  } else if (input.chain) {
    mode = 'chain';
    inputs = input.chain;
  } else {
    if (!input.agent || !input.task)
      throw new SubagentError({
        message: 'Single dispatch needs agent and task.',
      });
    mode = 'single';
    inputs = [{agent: input.agent, task: input.task}];
  }
  const edges = resolveNeeds(inputs, mode);
  return {
    mode,
    tasks: inputs.map((task, index) => ({
      id: task.id ?? `task_${index + 1}`,
      agent: task.agent,
      task: task.task,
      cwd: resolve(parentCwd, task.cwd ?? input.cwd ?? '.'),
      needs: edges[index] ?? [],
    })),
    concurrency: input.concurrency ?? 3,
    autoAwait: input.autoAwait ?? false,
    notifyPerTask: input.notifyPerTask ?? true,
  };
}
