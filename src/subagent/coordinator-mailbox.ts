import {randomUUID} from 'node:crypto';
import type {FleetRecord, TaskRecord} from './records';
import {ownsTask} from './authority';

export type MailboxMessage = FleetRecord['messages'][number];
export type MailboxKind = MailboxMessage['kind'];

export interface MailboxHost {
  snapshot: () => FleetRecord;
  update: (transform: (record: FleetRecord) => FleetRecord) => Promise<void>;
  notify: (task: TaskRecord | null, text: string) => void;
}

export interface QuestionDelivery {
  readonly id: string;
  readonly parent: TaskRecord | null;
}

export interface ReplyDelivery {
  readonly late: boolean;
  readonly question: MailboxMessage;
}

export interface MessageDelivery {
  readonly message: MailboxMessage;
  readonly target: TaskRecord | null;
}

/**
 * Return the stable question key used by both commands and UI projections.
 * Replies point at the original question id, while a projected question may
 * itself have been copied from another communication.
 */
export function questionKey(message: MailboxMessage): string {
  return message.questionId ?? message.id;
}

export function hasReply(
  snapshot: FleetRecord,
  question: MailboxMessage,
): boolean {
  const key = questionKey(question);
  return snapshot.messages.some(
    message => message.kind === 'reply' && message.questionId === key,
  );
}

/**
 * The one pending-question predicate used by command waits and projections.
 * Delivery receipt does not resolve the original question. A question remains
 * pending for reply/attention until it is answered or expires.
 */
export function isPendingQuestion(
  snapshot: FleetRecord,
  message: MailboxMessage,
  now = Date.now(),
): boolean {
  return (
    message.kind === 'question' &&
    (message.expiresAt === null || message.expiresAt > now) &&
    !hasReply(snapshot, message)
  );
}

function isDeliverable(
  snapshot: FleetRecord,
  message: MailboxMessage,
  now: number,
): boolean {
  return message.kind === 'question'
    ? message.consumedAt === null && isPendingQuestion(snapshot, message, now)
    : message.consumedAt === null;
}

/** Owns durable communication state and its pending/consumption semantics. */
export class CoordinatorMailbox {
  constructor(private readonly host: MailboxHost) {}

  pendingQuestions(taskId: string | null): readonly MailboxMessage[] {
    const snapshot = this.host.snapshot();
    return snapshot.messages.filter(
      message =>
        message.taskId === taskId && isPendingQuestion(snapshot, message),
    );
  }

  pendingMessages(taskId: string | null): readonly MailboxMessage[] {
    const snapshot = this.host.snapshot();
    const now = Date.now();
    return snapshot.messages.filter(
      message =>
        message.taskId === taskId && isDeliverable(snapshot, message, now),
    );
  }

  addressed(taskId: string | null): MailboxMessage | undefined {
    const snapshot = this.host.snapshot();
    const now = Date.now();
    return snapshot.messages.find(
      message =>
        message.taskId === taskId && isDeliverable(snapshot, message, now),
    );
  }

  answer(questionId: string): MailboxMessage | undefined {
    return this.host
      .snapshot()
      .messages.find(
        message =>
          message.kind === 'reply' && message.questionId === questionId,
      );
  }

  async ask(
    caller: TaskRecord,
    text: string,
    timeout: number,
  ): Promise<QuestionDelivery> {
    const id = randomUUID();
    const parent = caller.parentTaskId
      ? (this.host
          .snapshot()
          .tasks.find(task => task.id === caller.parentTaskId) ?? null)
      : null;
    await this.host.update(record => ({
      ...record,
      messages: [
        ...record.messages,
        {
          id,
          kind: 'question',
          fromTaskId: caller.id,
          taskId: caller.parentTaskId,
          questionId: null,
          text,
          receivedAt: Date.now(),
          consumedAt: null,
          expiresAt: Date.now() + timeout,
        },
      ],
      notices:
        parent?.phase === 'ended'
          ? [
              ...record.notices,
              {
                id: `message:${id}`,
                taskId: parent.id,
                text: `Unconsumed question ${id}: ${text}`,
                acknowledged: false,
              },
            ]
          : record.notices,
    }));
    this.host.notify(parent, `Question ${id}: ${text}`);
    return {id, parent};
  }

  async reply(
    caller: string | null,
    questionId: string,
    text: string,
  ): Promise<ReplyDelivery> {
    let late = false;
    let question: MailboxMessage | undefined;
    await this.host.update(record => {
      question = record.messages.find(
        message => message.id === questionId && message.kind === 'question',
      );
      if (!question) throw new Error('Unknown question.');
      if (caller !== null && caller !== question.taskId)
        throw new Error('Only the addressed parent or main can answer.');
      if (hasReply(record, question))
        throw new Error('Question already answered.');
      late = (question.expiresAt ?? 0) <= Date.now();
      return {
        ...record,
        messages: [
          ...record.messages,
          {
            id: randomUUID(),
            kind: 'reply' as const,
            fromTaskId: caller,
            taskId: question.fromTaskId,
            questionId: question.id,
            text,
            receivedAt: Date.now(),
            consumedAt: null,
            expiresAt: null,
          },
        ],
      };
    });
    if (!question) throw new Error('Question disappeared while replying.');
    return {late, question};
  }

  async deliver(
    kind: Exclude<MailboxKind, 'question' | 'reply'>,
    caller: string | null,
    targetId: string | null,
    text: string,
  ): Promise<MessageDelivery> {
    const id = randomUUID();
    let target: TaskRecord | null = null;
    let delivered: MailboxMessage | undefined;
    await this.host.update(record => {
      const source = caller
        ? record.tasks.find(task => task.id === caller)
        : undefined;
      target = targetId
        ? (record.tasks.find(task => task.id === targetId) ?? null)
        : null;
      if (kind === 'report' && !source)
        throw new Error('Only a child assignment can report to its parent.');
      if (targetId && !target) throw new Error('Unknown communication target.');
      if (source && target && source.dispatchId !== target.dispatchId)
        throw new Error('Cross-dispatch messages require a main-agent relay.');
      if (kind === 'steer') {
        if (!target || !ownsTask(record, caller, target.id))
          throw new Error('Steering requires current task ownership.');
        if (target.phase === 'ended' || target.phase === 'cancelling')
          throw new Error(
            'Task already ended or cancelling. Use explicit followup.',
          );
      }
      delivered = {
        id,
        kind,
        fromTaskId: caller,
        taskId: targetId,
        questionId: null,
        text,
        receivedAt: Date.now(),
        consumedAt: null,
        expiresAt: null,
      };
      const notice =
        target?.phase === 'ended'
          ? {
              id: `message:${id}`,
              taskId: target.id,
              text: `Unconsumed ${kind} ${id}: ${text}`,
              acknowledged: false,
            }
          : null;
      return {
        ...record,
        tasks: record.tasks.map(task =>
          kind === 'steer' && task.id === targetId
            ? {...task, outcome: null}
            : task,
        ),
        messages: [...record.messages, delivered],
        notices: notice ? [...record.notices, notice] : record.notices,
      };
    });
    if (!delivered) throw new Error('Communication was not recorded.');
    this.host.notify(target, text);
    return {message: delivered, target};
  }

  async consume(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    const consumedAt = Date.now();
    await this.host.update(record => ({
      ...record,
      messages: record.messages.map(message =>
        ids.includes(message.id) && message.consumedAt === null
          ? {...message, consumedAt}
          : message,
      ),
    }));
  }
}
