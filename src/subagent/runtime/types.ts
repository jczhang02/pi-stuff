export type RunMode = 'single' | 'parallel' | 'chain';
export type TaskStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'awaiting_parent'
  | 'completed'
  | 'failed'
  | 'aborted';
export type RunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_parent'
  | 'completed'
  | 'failed'
  | 'aborted';

export const TERMINAL: TaskStatus[] = ['completed', 'failed', 'aborted'];

export const MAX_TASKS = 16;

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  turns: number;
}

export interface TaskSnapshot {
  id: string;
  runId: string;
  agent: string;
  task: string;
  cwd: string;
  originCwd?: string | undefined;
  prompt?: string | undefined;
  maxRuntimeMs?: number | undefined;
  write?: boolean | undefined;
  elapsedMs?: number | undefined;
  status: TaskStatus;
  needs?: string[] | undefined;
  sessionId?: string | undefined;
  sessionFile?: string | undefined;
  startedAt?: number | undefined;
  endedAt?: number | undefined;
  toolCalls: number;
  lastActivity?: string | undefined;
  finalText?: string | undefined;
  error?: string | undefined;
  model?: string | undefined;
  thinking?: string | undefined;
  tools?: string[] | undefined;
  usage: UsageStats;
  roster?: string | undefined;
  agentFile?: string | undefined;
  branch?: string | undefined;
  isolation?: 'worktree' | undefined;
}

export interface RunSnapshot {
  id: string;
  mode: RunMode;
  status: RunStatus;
  notifyPerTask: boolean;
  createdAt: number;
  startedAt?: number | undefined;
  endedAt?: number | undefined;
  concurrency: number;
  tasks: TaskSnapshot[];
  aggregateUsage: UsageStats;
}
