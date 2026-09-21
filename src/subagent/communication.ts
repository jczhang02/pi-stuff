import type {ToolDefinition} from '@earendil-works/pi-coding-agent';
import {StringEnum} from '@earendil-works/pi-ai';
import {randomUUID} from 'node:crypto';
import {Effect} from 'effect';
import {Type, type Static} from 'typebox';
import {SubagentError} from './session';

export interface Question {
  id: string;
  text: string;
  expiresAt: number;
}

interface PendingQuestion {
  question: Question;
  answer: (text: string) => void;
}

export interface AgentMessage {
  from: string;
  text: string;
  at: number;
}

const askParameters = Type.Object({question: Type.String({minLength: 1})});
const notifyParameters = Type.Object({
  message: Type.String({minLength: 1}),
  level: Type.Optional(StringEnum(['info', 'warning', 'error'] as const)),
});
const sendParameters = Type.Object({
  to: Type.String({minLength: 1}),
  message: Type.String({minLength: 1}),
});

function boundedText(text: string, limit: number): string {
  return text.length <= limit
    ? text
    : text.slice(0, limit).replace(/[\uD800-\uDBFF]$/, '');
}

export class Communication {
  private readonly questions = new Map<string, PendingQuestion>();
  private readonly mailboxes: Map<string, AgentMessage[]>;

  constructor(
    private readonly tasks: readonly {id: string; agent: string}[],
    private readonly questionChanged: (
      taskId: string,
      question: Question | undefined,
    ) => void,
    private readonly notice: (
      taskId: string,
      text: string,
      level: 'info' | 'warning' | 'error',
    ) => void,
  ) {
    this.mailboxes = new Map(tasks.map(task => [task.id, []]));
  }

  private async ask(
    taskId: string,
    text: string,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    signal?.throwIfAborted();
    if (this.questions.has(taskId))
      throw new SubagentError({
        message: 'This child already has a pending question.',
      });
    const question: Question = {
      id: randomUUID(),
      text,
      expiresAt: Date.now() + 600_000,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      return await new Promise<string>(resolve => {
        this.questions.set(taskId, {question, answer: resolve});
        cancel = () => resolve('(Your task was cancelled.)');
        signal?.addEventListener('abort', cancel, {once: true});
        timer = setTimeout(
          () =>
            resolve(
              '(The parent did not reply within 10 minutes. Proceed with your best judgment.)',
            ),
          600_000,
        );
        this.questionChanged(taskId, question);
        if (signal?.aborted) cancel();
      });
    } finally {
      clearTimeout(timer);
      if (cancel) signal?.removeEventListener('abort', cancel);
      this.questions.delete(taskId);
      this.questionChanged(taskId, undefined);
    }
  }

  reply(taskId: string, questionId: string, message: string): void {
    const pending = this.questions.get(taskId);
    if (
      !pending ||
      pending.question.id !== questionId ||
      pending.question.expiresAt <= Date.now()
    )
      throw new SubagentError({
        message: 'This question is no longer awaiting a reply.',
      });
    this.questions.delete(taskId);
    pending.answer(message);
  }

  tools(taskId: string): ToolDefinition[] {
    return [
      {
        name: 'ask_parent',
        label: 'Ask parent',
        description:
          'Ask one focused question when blocked. Waits up to 10 minutes for the parent to reply.',
        parameters: askParameters,
        execute: async (
          _id: string,
          input: Static<typeof askParameters>,
          signal: AbortSignal | undefined,
        ) => {
          const text = await Effect.runPromise(
            Effect.tryPromise({
              try: () => this.ask(taskId, input.question, signal),
              catch: error =>
                new SubagentError({
                  message:
                    error instanceof Error ? error.message : String(error),
                }),
            }),
          );
          return {content: [{type: 'text', text}], details: undefined};
        },
      },
      {
        name: 'notify_parent',
        label: 'Notify parent',
        description: 'Send a non-blocking finding or risk to the parent.',
        parameters: notifyParameters,
        execute: async (
          _id: string,
          input: Static<typeof notifyParameters>,
        ) => {
          this.notice(taskId, input.message, input.level ?? 'info');
          return {content: [{type: 'text', text: 'Sent.'}], details: undefined};
        },
      },
      {
        name: 'send_agent_message',
        label: 'Message sibling',
        description:
          'Send a short message to a sibling task id in this run, or leader for the parent. ' +
          `Available siblings: ${
            this.tasks
              .filter(task => task.id !== taskId)
              .map(task => `${task.id} (${task.agent})`)
              .join(', ') || 'none'
          }.`,
        parameters: sendParameters,
        execute: async (_id: string, input: Static<typeof sendParameters>) => {
          const text = boundedText(input.message, 500);
          if (input.to === 'leader') this.notice(taskId, text, 'info');
          else {
            const mailbox = this.mailboxes.get(input.to);
            if (!mailbox)
              throw new SubagentError({
                message: `Unknown sibling: ${input.to}`,
              });
            mailbox.push({from: taskId, text, at: Date.now()});
          }
          return {content: [{type: 'text', text: 'Sent.'}], details: undefined};
        },
      },
      {
        name: 'poll_agent_messages',
        label: 'Read mailbox',
        description: 'Read and clear pending sibling messages.',
        parameters: Type.Object({}),
        execute: async () => {
          const messages = this.mailboxes.get(taskId)?.splice(0) ?? [];
          const text = boundedText(
            messages
              .map(message => `from ${message.from}: ${message.text}`)
              .join('\n'),
            4000,
          );
          return {
            content: [{type: 'text', text: text || 'No messages.'}],
            details: {messages},
          };
        },
      },
    ];
  }
}
