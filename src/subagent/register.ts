import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {join} from 'node:path';
import {stripVTControlCharacters} from 'node:util';
import {Effect, Schema} from 'effect';
import {Text} from '@earendil-works/pi-tui';
import {registerTool, type ToolSwitches} from '../pi/tool-switches';
import {SubagentInput} from './protocol';
import {Coordinator} from './coordinator';
import {FleetStore} from './store';
import type {SubagentSettings} from './settings';
import {installSubagentUI, type SubagentUIHandle} from './ui';
import {oneLine, stateOf} from './ui/format';

const ToolSummary = Schema.Struct({
  status: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  waitStatus: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  record: Schema.optional(Schema.String),
  total: Schema.optional(Schema.Number),
  tasks: Schema.optional(
    Schema.Array(
      Schema.Struct({
        phase: Schema.optional(Schema.String),
        outcome: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
});

export function registerSubagent(
  pi: ExtensionAPI,
  switches: ToolSwitches | undefined,
  settings: SubagentSettings = {},
) {
  let coordinator: Coordinator | undefined;
  let initialized = false;
  let opening: Promise<Coordinator> | undefined;
  let ui: SubagentUIHandle | undefined;
  let unsubscribe: (() => void) | undefined;
  const presentation = Schema.Struct({summary: Schema.String});
  pi.registerMessageRenderer('subagent', (message, options, theme) => {
    if (!Schema.is(presentation)(message.details)) return undefined;
    const text =
      options.expanded && Schema.is(Schema.String)(message.content)
        ? message.content
        : message.details.summary;
    return new Text(
      `${theme.fg('accent', 'subagent')} ${stripVTControlCharacters(text)}`,
      options.outputPad,
      0,
    );
  });

  const tool = (
    caller: string | null,
  ): ToolDefinition<typeof SubagentInput> => ({
    name: 'subagent',
    label: 'Subagent',
    description: [
      'Delegate with dispatch(tasks): name and prompt are required; needs refers to keys in that batch, inputs to saved fulfilled task IDs.',
      'Give each assignment a concise description for human inspection; put detailed instructions in prompt.',
      'Dispatch returns immediately. Use inspect or bounded wait to observe progress; ending the main response does not cancel background work.',
      'Omit tools for workspace-appropriate defaults. Explicit tools must include subagent. Default snapshot is read-only and cannot run bash; use workspace: write for edits OR running tests, including a reviewer who must execute tests.',
      'Wait without timeoutMs uses the configured event wait; avoid short polling loops. Scope wait to the task or dispatch whose result you need.',
      'Target message/steer/cancel/read/accept by taskId. Followup uses agentId and text to create a new assignment in retained context. release uses agentId.',
      'restrict(taskId, tools) can only REMOVE tools, never grant tools or change workspace. Select the required workspace and tools at dispatch.',
      'A child uses report(text) for an interim finding, ask(text) for a parent answer, and finish(outcome: fulfilled|unable, text, files?, checks?) to declare delivery. A normal final answer does not declare fulfillment.',
      'Reply uses questionId and text. read(taskId, record: report|transcript|diff, offset?, length?) retrieves full saved content.',
      'Use returned identities, not names. Inspect effective configuration before requesting tools or workspaces beyond the current ceiling.',
    ].join(' '),
    parameters: SubagentInput,
    renderCall: (args, theme) =>
      new Text(
        `${theme.fg('toolTitle', theme.bold('subagent'))} ${args.command ?? ''}${args.tasks?.length ? ` · ${args.tasks.map(task => oneLine(task.name ?? 'agent')).join(', ')}` : ''}`,
        0,
        0,
      ),
    renderResult: (result, options, theme, context) => {
      const full = result.content
        .flatMap(content => (content.type === 'text' ? [content.text] : []))
        .join('\n');
      if (options.expanded)
        return new Text(stripVTControlCharacters(full), 0, 0);
      const summary = Schema.is(ToolSummary)(result.details)
        ? result.details
        : undefined;
      const tasks = summary?.tasks;
      const outcomeCounts = new Map<string, number>();
      for (const task of tasks ?? []) {
        const state =
          task.phase === 'ended'
            ? (task.outcome ?? 'incomplete')
            : (task.phase ?? 'accepted');
        outcomeCounts.set(state, (outcomeCounts.get(state) ?? 0) + 1);
      }
      const status =
        summary?.message ??
        summary?.text?.slice(0, 160) ??
        (tasks
          ? tasks.length === 0
            ? 'No retained assignments.'
            : [...outcomeCounts]
                .map(([state, count]) => `${count} ${state}`)
                .join(' · ')
          : summary?.status) ??
        (options.isPartial ? 'Working...' : 'Operation completed.');
      return new Text(
        theme.fg(
          context.isError ? 'error' : 'muted',
          summary?.record !== undefined
            ? `${summary.record} · ${summary.total ?? summary.text?.length ?? 0} characters · Ctrl+O to expand`
            : `${oneLine(status)}${summary?.waitStatus === 'expired' ? ' · still working' : ''}`,
        ),
        0,
        0,
      );
    },
    async execute(_id, input, _signal, _update, ctx) {
      try {
        const owner = await ensure(ctx);
        if (caller === null) owner.setContext(ctx);
        const result = await owner.execute(input, caller, _id);
        return {
          content: [{type: 'text' as const, text: JSON.stringify(result)}],
          details: result,
        };
      } catch (error) {
        const result = {
          status: 'rejected',
          message:
            error instanceof Error
              ? error.message
              : 'Subagent operation failed.',
        };
        return {
          content: [{type: 'text' as const, text: JSON.stringify(result)}],
          details: result,
          isError: true,
        };
      }
    },
  });

  const ensure = (ctx: ExtensionContext): Promise<Coordinator> => {
    if (coordinator && initialized) return Promise.resolve(coordinator);
    opening ??= (
      coordinator
        ? Promise.resolve(coordinator)
        : Effect.runPromise(
            FleetStore.open(
              join(
                getAgentDir(),
                'pi-stuff',
                'subagents',
                ctx.sessionManager.getSessionId(),
              ),
              ctx.sessionManager.getSessionId(),
            ),
          ).then(
            store =>
              new Coordinator(
                store,
                {
                  context: ctx,
                  tools: () => pi.getActiveTools(),
                  childTool: taskId => tool(taskId),
                  notify: task => {
                    const full = task.report || task.reason;
                    const preview = full.slice(
                      0,
                      settings.previewCharacters ?? 2000,
                    );
                    const name =
                      coordinator?.snapshot.agents.find(
                        agent => agent.id === task.agentId,
                      )?.name ?? task.description;
                    pi.sendMessage(
                      {
                        customType: 'subagent',
                        content: `Subagent ${task.description}: ${task.outcome}.\nTask ${task.id} · agent ${task.agentId} · dispatch ${task.dispatchId}\n${preview}${preview.length < full.length ? '\nPreview; read the saved report for the complete result.' : ''}`,
                        display: true,
                        details: {
                          summary: `${name}: ${stateOf(task)}.\n${preview.split('\n')[0]?.slice(0, 160) ?? ''}${(preview.split('\n')[0]?.length ?? 0) > 160 ? '…' : ''}`,
                        },
                      },
                      {triggerTurn: false},
                    );
                  },
                  notifyCommunication: (task, text) => {
                    const preview = text.slice(
                      0,
                      settings.previewCharacters ?? 2000,
                    );
                    const settled = text.match(
                      /^Dispatch .+ with (\d+) assignments settled:/u,
                    );
                    const questionId = text.match(/^Question ([^:]+): /u)?.[1];
                    const question = coordinator?.snapshot.messages.find(
                      message => message.id === questionId,
                    );
                    const sourceTask = coordinator?.snapshot.tasks.find(
                      candidate => candidate.id === question?.fromTaskId,
                    );
                    const sourceName = coordinator?.snapshot.agents.find(
                      agent => agent.id === sourceTask?.agentId,
                    )?.name;
                    pi.sendMessage(
                      {
                        customType: 'subagent',
                        content: `${task ? `Subagent ${task.description}` : 'Subagent message'}: ${preview}${preview.length < text.length ? '\nPreview; inspect the associated communication for the complete message.' : ''}`,
                        display: true,
                        details: {
                          summary: settled
                            ? `${settled[1]} assignments settled. Open /agents for results.`
                            : question !== undefined
                              ? `${sourceName ?? 'A child'} needs an answer.\n${question.text.slice(0, 160)}${question.text.length > 160 ? '…' : ''}`
                              : `${task?.description ?? 'message'}: ${preview.split('\n')[0]?.slice(0, 160) ?? ''}`,
                        },
                      },
                      {triggerTurn: false},
                    );
                  },
                },
                settings,
              ),
          )
    )
      .then(async owner => {
        coordinator = owner;
        await owner.initialize();
        initialized = true;
        unsubscribe = owner.subscribe(() => {
          pi.events.emit('pi-stuff:subagent', {
            revision: owner.snapshot.revision,
            tasks: owner.snapshot.tasks,
          });
        });
        return owner;
      })
      .catch(error => {
        opening = undefined;
        throw error;
      });
    return opening;
  };

  registerTool(pi, switches, tool(null));
  const prepareUI = async (ctx: ExtensionContext) => {
    const owner = await ensure(ctx);
    owner.setContext(ctx);
    ui ??= installSubagentUI(pi, ctx, owner, settings);
    return ui;
  };
  pi.on('session_start', async (_event, ctx) => {
    try {
      await prepareUI(ctx);
    } catch (error) {
      ctx.ui.notify(`Subagents unavailable: ${String(error)}`, 'error');
    }
  });
  pi.registerCommand('agents', {
    description: 'Inspect subagents. Use /agents fleet for the compact list.',
    handler: async (args, ctx) => {
      const view = args.trim();
      if (view && view !== 'fleet') {
        ctx.ui.notify('Usage: /agents [fleet]', 'error');
        return;
      }
      try {
        (await prepareUI(ctx)).open(view === 'fleet' ? 'fleet' : 'overview');
      } catch (error) {
        ctx.ui.notify(`Subagents unavailable: ${String(error)}`, 'error');
      }
    },
  });
  pi.on('session_before_switch', async (_event, ctx) => {
    try {
      await coordinator?.close();
      ui?.dispose();
      ui = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
      coordinator = undefined;
      initialized = false;
      opening = undefined;
      return undefined;
    } catch (error) {
      ctx.ui.notify(
        `Subagents could not stop and save: ${String(error)}`,
        'error',
      );
      return {cancel: true};
    }
  });
  pi.on('session_shutdown', async () => {
    // Pi catches errors from this hook and then exits. Keep the departure
    // barrier pending on a core save failure, so throwing cannot falsely signal
    // a successful stop/save. A later filesystem repair allows departure.
    for (;;) {
      try {
        await coordinator?.close();
        break;
      } catch (error) {
        process.stderr.write(
          `Subagents have not stopped and saved. Departure is waiting: ${String(error)}\n`,
        );
        await new Promise<void>(resolve => setTimeout(resolve, 1000));
      }
    }
    unsubscribe?.();
    ui?.dispose();
  });
}
