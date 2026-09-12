import type {ToolDefinition} from '@earendil-works/pi-coding-agent';
import {Type} from 'typebox';
import type {MailboxMessage} from './mailbox';

// Talk-tool contract adapted from Arhen pi-core-subagent 1.3.54.
export const CHILD_TALK_TOOLS = [
  'ask_parent',
  'notify_parent',
  'send_agent_message',
  'poll_agent_messages',
];
export interface ChildHandlers {
  onAskParent(
    taskId: string,
    question: string,
    signal: AbortSignal | undefined,
  ): Promise<string>;
  onNotifyParent(
    taskId: string,
    message: string,
    level: 'info' | 'warning' | 'error',
  ): void;
  onSendMessage(taskId: string, to: string, text: string): boolean;
  onPollMailbox(taskId: string): MailboxMessage[];
}
const Ask = Type.Object({
  question: Type.String({minLength: 1, maxLength: 4000}),
});
const Notify = Type.Object({
  message: Type.String({minLength: 1, maxLength: 4000}),
  level: Type.Optional(
    Type.Union([
      Type.Literal('info'),
      Type.Literal('warning'),
      Type.Literal('error'),
    ]),
  ),
});
const Send = Type.Object({
  to: Type.String({minLength: 1}),
  message: Type.String({minLength: 1, maxLength: 4000}),
});
const Poll = Type.Object({});

export function createChildTools(
  taskId: string,
  handlers: ChildHandlers,
): ToolDefinition[] {
  const ask: ToolDefinition<typeof Ask> = {
    name: 'ask_parent',
    label: 'Ask Parent',
    description:
      'Ask the parent one focused question when blocked. Waits for a parent or user reply, cancellation, or a 10 minute timeout.',
    parameters: Ask,
    async execute(_id, params, signal) {
      const answer = await handlers.onAskParent(
        taskId,
        params.question,
        signal,
      );
      return {content: [{type: 'text', text: answer}], details: {}};
    },
  };
  const notify: ToolDefinition<typeof Notify> = {
    name: 'notify_parent',
    label: 'Notify Parent',
    description:
      'Send a short finding to the parent without waiting. Final results are delivered automatically; avoid repeating them here.',
    parameters: Notify,
    async execute(_id, params) {
      handlers.onNotifyParent(taskId, params.message, params.level ?? 'info');
      return {content: [{type: 'text', text: 'Sent.'}], details: {}};
    },
  };
  const send: ToolDefinition<typeof Send> = {
    name: 'send_agent_message',
    label: 'Send Agent Message',
    description:
      'Send a bounded message to a sibling task id in this run, or leader for the parent. Siblings read messages with poll_agent_messages.',
    parameters: Send,
    async execute(_id, params) {
      const accepted = handlers.onSendMessage(
        taskId,
        params.to,
        params.message,
      );
      return {
        content: [
          {
            type: 'text',
            text: accepted ? 'Sent.' : `Unavailable target: ${params.to}.`,
          },
        ],
        isError: !accepted,
        details: {},
      };
    },
  };
  const poll: ToolDefinition<typeof Poll> = {
    name: 'poll_agent_messages',
    label: 'Poll Agent Messages',
    description:
      'Read and clear messages in your sibling mailbox. Do not poll repeatedly while idle.',
    parameters: Poll,
    async execute() {
      const messages = handlers.onPollMailbox(taskId);
      return {
        content: [
          {
            type: 'text',
            text: messages.length
              ? messages
                  .map(message => `from ${message.from}: ${message.text}`)
                  .join('\n')
              : 'No messages.',
          },
        ],
        details: {messages},
      };
    },
  };
  return [ask, notify, send, poll];
}
