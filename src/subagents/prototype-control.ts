// Main-agent access to the same task controls used by the inline tree.
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {StringEnum} from '@earendil-works/pi-ai';
import {Text} from '@earendil-works/pi-tui';
import {Type} from 'typebox';
import type {FleetController} from './prototype-model';

function required(value: string | undefined, field: string): string {
  if (!value?.trim()) throw new Error(`${field} is required for this action.`);
  return value;
}

export function registerPrototypeControl(
  pi: ExtensionAPI,
  getFleet: () => FleetController | undefined,
): void {
  pi.registerTool({
    name: 'subagent',
    label: 'Subagent',
    description:
      'Inspect assigned subagents and their actual results, or steer, answer, follow up and cancel tasks. Use list to obtain internal task and question identifiers before acting, and check available actions. Refer to agents by name and task description in user-facing text; never expose internal task identifiers. Follow-up requires a completed agent. This workspace already has two investigations and a dependent reviewer.',
    parameters: Type.Object({
      action: StringEnum([
        'list',
        'steer',
        'reply',
        'followUp',
        'cancel',
      ] as const),
      taskId: Type.Optional(Type.String()),
      questionId: Type.Optional(Type.String()),
      agentName: Type.Optional(Type.String()),
      message: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      const fleet = getFleet();
      if (!fleet) throw new Error('Subagents are not ready.');
      switch (params.action) {
        case 'steer':
          fleet.steer(
            required(params.taskId, 'taskId'),
            required(params.message, 'message'),
          );
          break;
        case 'reply':
          fleet.reply(
            required(params.taskId, 'taskId'),
            required(params.questionId, 'questionId'),
            required(params.message, 'message'),
          );
          break;
        case 'followUp':
          fleet.followUp(
            required(params.agentName, 'agentName'),
            required(params.message, 'message'),
          );
          break;
        case 'cancel':
          fleet.cancel(required(params.taskId, 'taskId'));
          break;
        case 'list':
          break;
        default:
          throw new Error('Unknown subagent action.');
      }
      const agents = fleet.agents();
      return {
        content: [{type: 'text', text: JSON.stringify(agents)}],
        details: {
          summary: agents
            .map(agent => {
              const task = agent.tasks.at(-1);
              const state = task?.actions.includes('reply')
                ? 'needs reply'
                : (task?.status ?? 'idle');
              return `${agent.name} · ${state}`;
            })
            .join('\n'),
          expanded: agents
            .map(agent =>
              [
                agent.name,
                ...agent.tasks.map((task, index) =>
                  [
                    `${index === agent.tasks.length - 1 ? 'Current' : 'Previous'} · ${task.description}`,
                    task.detail,
                    task.model,
                    task.question
                      ? `Question: ${task.question.text}\nAnswer: ${task.question.answer ?? 'No answer received.'}`
                      : '',
                    task.result ?? task.progress,
                  ]
                    .filter(Boolean)
                    .join('\n'),
                ),
              ].join('\n'),
            )
            .join('\n\n'),
        },
      };
    },
    renderCall(args, theme) {
      return new Text(
        theme.fg('toolTitle', theme.bold(`subagent ${args.action ?? ''}`)),
        0,
        0,
      );
    },
    renderResult(result, options, theme, context) {
      const fullText = result.content
        .map(block => (block.type === 'text' ? block.text : ''))
        .join('\n');
      return new Text(
        theme.fg(
          context.isError ? 'error' : 'text',
          context.isError
            ? fullText
            : options.expanded
              ? (result.details?.expanded ?? '')
              : (result.details?.summary ?? ''),
        ),
        0,
        0,
      );
    },
  });
}
