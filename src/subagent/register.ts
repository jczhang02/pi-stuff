import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {Effect} from 'effect';
import {registerTool, type ToolSwitches} from '../pi/tool-switches';
import {SubagentError} from './session';
import {
  dispatchInput,
  subagentParameters,
  validateParameters,
} from './protocol';
import {Runs} from './runs';

export function registerSubagent(
  pi: ExtensionAPI,
  switches: ToolSwitches | undefined,
) {
  const runs = new Runs((run, task, message) => {
    pi.sendMessage(
      {
        customType: 'subagent',
        content: `${task.agent}: ${task.status}\n${message ?? task.question?.text ?? task.error ?? task.finalText}`,
        display: true,
        details: {runId: run.id, taskId: task.id},
      },
      {
        triggerTurn: true,
        deliverAs: task.status === 'failed' ? 'steer' : 'followUp',
      },
    );
  });
  pi.on('session_shutdown', () => runs.close());
  pi.on('session_start', () => runs.close());
  registerTool(pi, switches, {
    name: 'subagent',
    label: 'Subagent',
    description:
      'Dispatch independent or dependent Pi subagents. Background and read-only by default; writers use separate Git worktrees. Query status/result, wait for completion or a question, reply to a question, steer live work, or cancel one task or the run.',
    parameters: subagentParameters,
    async execute(_id, input, signal, _update, ctx) {
      const result = await Effect.runPromise(
        Effect.tryPromise({
          async try() {
            signal?.throwIfAborted();
            validateParameters(input);
            if (input.command === 'dispatch') {
              const dispatch = dispatchInput(input, ctx.cwd);
              const run = await runs.dispatch(dispatch, ctx, signal);
              return dispatch.autoAwait ? runs.wait(run.id) : run;
            }
            if (!input.runId)
              throw new SubagentError({message: 'A runId is required.'});
            switch (input.command) {
              case 'status':
              case 'result':
                return runs.result(input.runId, input.taskId);
              case 'wait':
                return runs.wait(input.runId, input.timeoutMs);
              case 'cancel':
                return runs.cancel(input.runId, input.taskId);
              case 'reply':
                if (!input.taskId || !input.questionId || !input.message)
                  throw new SubagentError({
                    message: 'Reply needs taskId, questionId and message.',
                  });
                return runs.reply(
                  input.runId,
                  input.taskId,
                  input.questionId,
                  input.message,
                );
              case 'steer':
                if (!input.message)
                  throw new SubagentError({message: 'Steer needs a message.'});
                return runs.steer(input.runId, input.taskId, input.message);
            }
          },
          catch: error =>
            error instanceof SubagentError
              ? error
              : new SubagentError({
                  message:
                    error instanceof Error ? error.message : String(error),
                }),
        }),
      );
      return {
        content: [{type: 'text', text: JSON.stringify(result)}],
        details: result,
      };
    },
  });
}
