import type {AgentSessionEvent} from '@earendil-works/pi-coding-agent';
import {Option, Schema} from 'effect';
import type {TaskRecord} from './records';
import type {PersistedSessionEntry} from './session-records';

const TextResult = Schema.Struct({
  content: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      text: Schema.optional(Schema.String),
    }),
  ),
});

export type ChildActivity =
  | AgentSessionEvent
  | {
      type: 'entry_appended';
      entry: Extract<PersistedSessionEntry, {type: 'usage'}>;
    }
  | {
      type: 'resources_loaded';
      rules: readonly string[];
      skills: readonly string[];
    };

type ActivityUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {total: number};
};

function addUsage(
  task: TaskRecord,
  usage: ActivityUsage | undefined,
): TaskRecord {
  if (usage === undefined) return task;
  const previous = task.usage ?? {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  };
  return {
    ...task,
    usage: {
      input: previous.input + usage.input,
      output: previous.output + usage.output,
      cacheRead: previous.cacheRead + usage.cacheRead,
      cacheWrite: previous.cacheWrite + usage.cacheWrite,
      cost: previous.cost + usage.cost.total,
    },
  };
}

export function observeActivity(
  task: TaskRecord,
  event: ChildActivity,
): TaskRecord {
  const at = Date.now();
  const append = (kind: string, text: string, stage = task.stage) => ({
    ...task,
    stage,
    lastEventAt: at,
    events: [...task.events, {at, kind, text}],
  });
  switch (event.type) {
    case 'resources_loaded':
      return append(
        'resources',
        `Rules: ${event.rules.join(', ') || 'none'}\nSkills available: ${event.skills.join(', ') || 'none'}`,
      );
    case 'message_start':
      return event.message.role === 'assistant'
        ? {...task, liveText: '', stage: 'model', lastEventAt: at}
        : task;
    case 'message_update':
      return event.message.role === 'assistant'
        ? {
            ...task,
            lastEventAt: at,
            liveText: event.message.content
              .filter(block => block.type === 'text')
              .map(block => block.text)
              .join('\n'),
          }
        : task;
    case 'message_end': {
      if (event.message.role === 'user' || event.message.role === 'custom') {
        const content = event.message.content;
        return append(
          event.message.role === 'custom'
            ? `message:${event.message.customType}`
            : 'prompt',
          Schema.is(Schema.String)(content)
            ? content
            : content
                .map(block =>
                  block.type === 'text'
                    ? block.text
                    : `[${block.type} content]`,
                )
                .join('\n'),
        );
      }
      if (
        event.message.role === 'compactionSummary' ||
        event.message.role === 'branchSummary'
      )
        return append(event.message.role, event.message.summary);
      if (event.message.role === 'toolResult')
        return addUsage(task, event.message.usage);
      if (event.message.role !== 'assistant') return task;
      const message = event.message;
      const text = message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
      const next = {
        ...append('assistant', text),
        liveText: '',
        turns: task.turns + 1,
      };
      return addUsage(next, message.usage);
    }
    case 'compaction_end':
      return addUsage(task, event.result?.usage);
    case 'entry_appended':
      return event.entry.type === 'usage'
        ? addUsage(task, event.entry.usage)
        : task;
    case 'tool_execution_start':
      return {
        ...append(
          `tool:${event.toolName}`,
          JSON.stringify(event.args),
          `tool ${event.toolName}`,
        ),
        activeTools: [
          ...task.activeTools,
          {
            id: event.toolCallId,
            name: event.toolName,
            startedAt: at,
            progress: '',
          },
        ],
      };
    case 'tool_execution_update': {
      const decoded = Schema.decodeUnknownOption(TextResult)(
        event.partialResult,
      );
      if (Option.isNone(decoded)) return task;
      const progress = decoded.value.content
        .flatMap(block =>
          block.type === 'text' && block.text !== undefined ? [block.text] : [],
        )
        .join('\n');
      return {
        ...task,
        lastEventAt: at,
        activeTools: task.activeTools.map(tool =>
          tool.id === event.toolCallId ? {...tool, progress} : tool,
        ),
      };
    }
    case 'tool_execution_end': {
      // The following message_end event persists the same tool result and is the
      // usage source. Counting event.result here would charge the tool twice.
      const decoded = Schema.decodeUnknownOption(TextResult)(event.result);
      const result = Option.isSome(decoded)
        ? decoded.value.content
            .flatMap(block =>
              block.type === 'text' && block.text !== undefined
                ? [block.text]
                : [],
            )
            .join('\n')
        : 'Tool result is not available as text.';
      return {
        ...append(
          event.isError
            ? `tool-error:${event.toolName}`
            : `tool-result:${event.toolName}`,
          result,
        ),
        activeTools: task.activeTools.filter(
          tool => tool.id !== event.toolCallId,
        ),
      };
    }
    case 'auto_retry_start':
      return {
        ...append(
          'retry',
          `${event.attempt}/${event.maxAttempts}, ${event.delayMs}ms: ${event.errorMessage}`,
          'provider retry',
        ),
        retries: task.retries + 1,
      };
    case 'auto_retry_end':
      return append(
        'retry-ended',
        event.success
          ? 'Provider retry completed.'
          : (event.finalError ?? 'Provider retry failed.'),
      );
    default:
      return task;
  }
}
