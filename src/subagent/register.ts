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
  const runs = new Runs((run, task) => {
    pi.sendMessage(
      {
        customType: 'subagent',
        content: `${task.agent}: ${task.status}\n${task.error ?? task.finalText}`,
        display: true,
        details: {runId: run.id, taskId: task.id},
      },
      {triggerTurn: true, deliverAs: 'followUp'},
    );
  });
  pi.on('session_shutdown', () => runs.close());
  pi.on('session_start', () => runs.close());
  registerTool(pi, switches, {
    name: 'subagent',
    label: 'Subagent',
    description:
      'Dispatch independent or dependent read-only Pi subagents. Background by default. Query status/result, wait for completion, or cancel one task or the run.',
    parameters: subagentParameters,
    async execute(_id, input, signal, _update, ctx) {
      const result = await Effect.runPromise(
        Effect.tryPromise({
          async try() {
            signal?.throwIfAborted();
            validateParameters(input);
            if (input.command === 'dispatch') {
              const dispatch = dispatchInput(input, ctx.cwd);
              const run = runs.dispatch(dispatch, ctx);
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
