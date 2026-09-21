import type {RunSnapshot, TaskSnapshot, Usage} from './records';

const STATUS_TEXT_LIMIT = 240;

export interface QuestionStatus {
  id: string;
  expiresAt: number;
  excerpt: string;
}

export interface TaskStatus {
  id: string;
  agent: string;
  status: TaskSnapshot['status'];
  pendingInstructionCount: number;
  historyCount: number;
  extensionErrorCount: number;
  startedAt?: number;
  endedAt?: number;
  usage?: Usage;
  cumulativeUsage?: Usage;
  question?: QuestionStatus;
  error?: string;
  preservationError?: string;
  cleanupError?: string;
  notificationError?: string;
  finalizing?: boolean;
}

export interface RunStatus {
  id: string;
  mode: RunSnapshot['mode'];
  status: RunSnapshot['status'];
  tasks: TaskStatus[];
  persistenceError?: string;
}

function boundedText(value: string): string {
  return value.length <= STATUS_TEXT_LIMIT
    ? value
    : `${value.slice(0, STATUS_TEXT_LIMIT - 3)}...`;
}

function copyUsage(usage: Usage | undefined): Usage | undefined {
  return usage === undefined ? undefined : {...usage};
}

export function projectTaskStatus(task: TaskSnapshot): TaskStatus {
  const status: TaskStatus = {
    id: task.id,
    agent: task.agent,
    status: task.status,
    pendingInstructionCount: task.pendingInstructions.length,
    historyCount: task.history.length,
    extensionErrorCount: task.extensionErrors?.length ?? 0,
  };
  if (task.startedAt !== undefined) status.startedAt = task.startedAt;
  if (task.endedAt !== undefined) status.endedAt = task.endedAt;
  const usage = copyUsage(task.usage);
  if (usage !== undefined) status.usage = usage;
  const cumulativeUsage = copyUsage(task.cumulativeUsage);
  if (cumulativeUsage !== undefined) status.cumulativeUsage = cumulativeUsage;
  if (task.question !== undefined) {
    status.question = {
      id: task.question.id,
      expiresAt: task.question.expiresAt,
      excerpt: boundedText(task.question.text),
    };
  }
  if (task.error !== undefined) status.error = boundedText(task.error);
  if (task.preservationError !== undefined)
    status.preservationError = boundedText(task.preservationError);
  if (task.cleanupError !== undefined)
    status.cleanupError = boundedText(task.cleanupError);
  if (task.notificationError !== undefined)
    status.notificationError = boundedText(task.notificationError);
  if (task.finalizing !== undefined) status.finalizing = task.finalizing;
  return status;
}

export function projectRunStatus(run: RunSnapshot): RunStatus {
  const status: RunStatus = {
    id: run.id,
    mode: run.mode,
    status: run.status,
    tasks: run.tasks.map(projectTaskStatus),
  };
  if (run.persistenceError !== undefined)
    status.persistenceError = boundedText(run.persistenceError);
  return status;
}
