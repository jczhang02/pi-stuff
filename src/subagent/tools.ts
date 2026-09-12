import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {Text} from '@earendil-works/pi-tui';
import {registerTool, type ToolSwitches} from '../tool-switches';
import {type SubagentManager, type RunSnapshot} from './runtime';
import {formatRun, taskSummary} from './runtime/format';
import {
  SubagentParams,
  ResultParam,
  AwaitParam,
  ReplyParam,
  SteerParam,
  ResumeParam,
} from './runtime/schemas';

interface Result {
  run?: RunSnapshot | undefined;
}
const text = (value: string, details: Result = {}, isError = false) => ({
  content: [{type: 'text' as const, text: value}],
  details,
  isError,
});

export function registerSubagentTools(
  pi: ExtensionAPI,
  manager: () => SubagentManager,
  switches: ToolSwitches | undefined,
): void {
  registerTool<typeof SubagentParams, Result>(pi, switches, {
    name: 'subagent',
    label: 'Subagent',
    parameters: SubagentParams,
    description:
      'Delegate tasks to independent background Pi sessions. Use agent+task, tasks for parallel or dependency graphs, or chain for sequential work. Children default to read-only tools; write or bash requires an isolated Git worktree. Returns immediately. Notifications wake the parent without visible Follow-up queue messages.',
    promptSnippet:
      'Delegate independent development work to observable child agents.',
    promptGuidelines: [
      'Choose a focused task and system prompt for each child. Send related tasks in one batch with explicit ids; needs edges propagate completed outputs.',
      'Continue your own work while children run. If idle, end your turn; results arrive automatically. Use await_subagent only when you need to synchronize.',
      'Treat child output as evidence to review. Write worktrees preserve uncommitted changes for inspection; do not merge, commit or delete them without the required repository authorization.',
      'Answer questions with reply_subagent; steer running children or resume completed/failed/aborted children with a new message. Cancellation affects only the selected task or run.',
    ],
    async execute(_id, params, signal, _update, ctx) {
      const result = manager().startInBackground(params, ctx);
      if (params.autoAwait) {
        const awaited = await manager().awaitRun(result.run.id, 60_000, signal);
        if (awaited)
          return text(
            formatRun(awaited.run) +
              '\n' +
              awaited.intercom
                .map(
                  message =>
                    `${message.kind} ${message.taskId}: ${message.text}`,
                )
                .join('\n'),
            {run: awaited.run},
          );
      }
      return text(
        `Started ${result.run.id}. Continue your work; child results arrive automatically.\n${formatRun(result.run)}`,
        result,
      );
    },
    renderCall(args, theme) {
      const tasks = args.tasks ?? args.chain;
      const names =
        tasks
          ?.map(task => task.agent ?? task.id)
          .filter(Boolean)
          .join(', ') ??
        args.agent ??
        '';
      return new Text(
        theme.fg('toolTitle', theme.bold(`subagent ${names}`)),
        0,
        0,
      );
    },
    renderResult(result, options, theme) {
      const run = result.details?.run;
      return new Text(
        run
          ? options.expanded
            ? formatRun(run)
            : theme.fg(
                'muted',
                `${run.id} · ${run.tasks.length} agents · ${run.status}`,
              )
          : result.content[0]?.type === 'text'
            ? result.content[0].text
            : '',
        0,
        0,
      );
    },
  });
  registerTool(pi, switches, {
    name: 'subagent_status',
    label: 'Subagent Status',
    parameters: ResultParam,
    description:
      'Inspect live child states, current activity, token usage and session/worktree locations without waiting.',
    async execute(_id, params) {
      const run = manager().getRun(params.runId);
      return run
        ? text(formatRun(run), {run})
        : text(`Unknown run: ${params.runId}`, {}, true);
    },
  });
  registerTool(pi, switches, {
    name: 'subagent_result',
    label: 'Subagent Result',
    parameters: ResultParam,
    description:
      'Read the final output and diagnostics of a run or a specific child task.',
    async execute(_id, params) {
      const run = manager().getRun(params.runId);
      if (!run) return text(`Unknown run: ${params.runId}`, {}, true);
      if (!params.taskId) return text(formatRun(run), {run});
      const task = run.tasks.find(task => task.id === params.taskId);
      return task
        ? text(taskSummary(task), {run})
        : text(`Unknown task: ${params.taskId}`, {}, true);
    },
  });
  registerTool(pi, switches, {
    name: 'await_subagent',
    label: 'Await Subagent',
    parameters: AwaitParam,
    description:
      'Wait for completion or a child message, up to 60 seconds. Returns early for questions. Cancellation stops waiting; children remain independent.',
    async execute(_id, params, signal) {
      const result = await manager().awaitRun(
        params.runId,
        params.timeoutMs,
        signal,
      );
      return result
        ? text(
            formatRun(result.run) +
              '\n' +
              result.intercom
                .map(
                  message =>
                    `${message.kind} ${message.taskId}: ${message.text}`,
                )
                .join('\n'),
            {run: result.run},
          )
        : text(`Unknown run: ${params.runId}`, {}, true);
    },
  });
  registerTool(pi, switches, {
    name: 'reply_subagent',
    label: 'Reply Subagent',
    parameters: ReplyParam,
    description: 'Answer a specific child’s pending ask_parent question.',
    async execute(_id, params) {
      const ok = manager().deliverReply(
        params.runId,
        params.taskId,
        params.message,
      );
      return text(
        ok ? 'Reply delivered.' : 'This child has no pending question.',
        {},
        !ok,
      );
    },
  });
  registerTool(pi, switches, {
    name: 'steer_subagent',
    label: 'Steer Subagent',
    parameters: SteerParam,
    description:
      'Queue a steering message for a running child, or all running children in this run. They consume it at the next model boundary.',
    async execute(_id, params) {
      const ok = manager().steerTask(
        params.runId,
        params.taskId,
        params.message,
      );
      return text(
        ok
          ? 'Steering message queued.'
          : 'No matching child is currently accepting steering.',
        {},
        !ok,
      );
    },
  });
  registerTool(pi, switches, {
    name: 'resume_subagent',
    label: 'Resume Subagent',
    parameters: ResumeParam,
    description:
      'Continue a completed, failed or aborted child independently in its saved conversation; a task that never started is retried. Other children keep running. An optional model changes only this child.',
    async execute(_id, params, _signal, _update, ctx) {
      const result = await manager().resumeTask(
        params.runId,
        params.taskId,
        ctx,
        {message: params.message, model: params.model},
      );
      return result.ok
        ? text(`Continuation queued for ${params.taskId}.`, {
            run: manager().getRun(params.runId),
          })
        : text(result.reason, {}, true);
    },
  });
  registerTool(pi, switches, {
    name: 'subagent_cancel',
    label: 'Subagent Cancel',
    parameters: ResultParam,
    description:
      'Cancel one child task, or the entire run when taskId is omitted. Completed edits remain available for review.',
    async execute(_id, params, _signal, _update, ctx) {
      if (!manager().getRun(params.runId))
        return text(`Unknown run: ${params.runId}`, {}, true);
      const count = params.taskId
        ? Number(manager().cancelTask(params.runId, params.taskId, ctx))
        : manager().cancelRun(params.runId).aborted;
      return text(`Cancellation requested for ${count} task(s).`);
    },
  });
}
