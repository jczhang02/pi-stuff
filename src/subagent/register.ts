import {getAgentDir, type ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {Effect} from 'effect';
import {registerTool, type ToolSwitches} from '../pi/tool-switches';
import {SubagentError} from './session';
import {
  dispatchInput,
  subagentParameters,
  validateParameters,
} from './protocol';
import {Runs} from './runs';
import {readAutoLimit, setAutoLimit} from './settings';
import {projectRunStatus, projectTaskStatus} from './status';
import {SubagentUI} from './ui';
import {renderSubagentResult} from './tool-view';

export function registerSubagent(
  pi: ExtensionAPI,
  switches: ToolSwitches | undefined,
) {
  const runs = new Runs(
    (run, task, message) => {
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
    },
    () => {
      const active = new Set(pi.getActiveTools());
      return pi.getAllTools().filter(tool => active.has(tool.name));
    },
  );
  const ui = new SubagentUI(runs);
  pi.registerCommand('subagents', {
    description:
      'Manage subagents. Use auto-limit on|off for a 1 h or 6 h default runtime.',
    async handler(args, ctx) {
      if (!args.trim()) {
        ui.open();
        return;
      }
      const parts = args.trim().toLowerCase().split(/\s+/);
      if (
        parts[0] !== 'auto-limit' ||
        parts.length > 2 ||
        (parts[1] !== undefined && !['on', 'off'].includes(parts[1]))
      ) {
        ctx.ui.notify('Usage: /subagents auto-limit [on|off]', 'info');
        return;
      }
      try {
        const autoLimit = await Effect.runPromise(
          parts[1] === undefined
            ? readAutoLimit(getAgentDir())
            : setAutoLimit(getAgentDir(), parts[1] === 'on'),
        );
        ctx.ui.notify(
          `Auto-limit ${autoLimit ? 'on' : 'off'}: default runtime ${autoLimit ? '1 h' : '6 h'}.`,
          'info',
        );
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          'error',
        );
      }
    },
  });
  pi.on('session_shutdown', () => {
    ui.dispose();
    return runs.close();
  });
  pi.on('session_start', async (_event, ctx) => {
    ui.dispose();
    await runs.restore(ctx);
    ui.mount(ctx);
  });
  registerTool(pi, switches, {
    name: 'subagent',
    label: 'Subagent',
    description:
      'Dispatch independent or dependent Pi subagents. Background and read-only by default; writers use separate Git worktrees. Query status/result, wait for completion or a question, reply to a question, steer live work, resume a failed/stopped child, follow up a completed child, or cancel one task or the run.',
    parameters: subagentParameters,
    renderResult: renderSubagentResult,
    async execute(_id, input, signal, _update, ctx) {
      const result = await Effect.runPromise(
        Effect.tryPromise({
          async try() {
            signal?.throwIfAborted();
            validateParameters(input);
            if (input.command === 'dispatch') {
              const autoLimit = await Effect.runPromise(
                readAutoLimit(getAgentDir()),
              );
              const dispatch = dispatchInput(input, ctx.cwd, autoLimit);
              const run = await runs.dispatch(dispatch, ctx, signal);
              return dispatch.autoAwait ? runs.wait(run.id) : run;
            }
            if (!input.runId)
              throw new SubagentError({message: 'A runId is required.'});
            switch (input.command) {
              case 'resume':
              case 'follow-up': {
                if (!input.taskId)
                  throw new SubagentError({
                    message: 'Continuation needs taskId.',
                  });
                const run = await runs.continueTask(
                  {
                    ...input,
                    command: input.command,
                    runId: input.runId,
                    taskId: input.taskId,
                  },
                  ctx,
                  signal,
                );
                return input.autoAwait ? runs.wait(run.id) : run;
              }
              case 'status': {
                const snapshot = runs.result(input.runId, input.taskId);
                return 'tasks' in snapshot
                  ? projectRunStatus(snapshot)
                  : projectTaskStatus(snapshot);
              }
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
      await runs.flush();
      return {
        content: [{type: 'text', text: JSON.stringify(result)}],
        details: result,
      };
    },
  });
}
