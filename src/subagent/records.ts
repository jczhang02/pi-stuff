import type {Dispatch, TaskInput} from './protocol';
import type {Question} from './communication';
import type {Workspace, WorkspaceSaveResult} from './workspace';

export interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  turns: number;
}

export interface RequestRecord extends TaskInput {
  requestId: string;
  startEntryId?: string;
  endEntryId?: string;
  usage?: Usage;
  status:
    | 'queued'
    | 'starting'
    | 'running'
    | 'awaiting_parent'
    | 'stopping'
    | 'completed'
    | 'failed'
    | 'stopped'
    | 'skipped';
  finalText: string;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  sessionId?: string;
  sessionFile?: string;
  question?: Question;
  pendingInstructions: string[];
  workspace?: Workspace;
  git?: WorkspaceSaveResult;
  preservationError?: string;
  cleanupError?: string;
  notificationError?: string;
  finalizing?: boolean;
  roleSource?: string;
  configurationNotes: string[];
  provider?: string;
}

export interface TaskSnapshot extends RequestRecord {
  history: RequestRecord[];
  cumulativeUsage?: Usage;
}

export interface RunSnapshot {
  id: string;
  mode: Dispatch['mode'];
  status: 'running' | 'completed' | 'failed' | 'stopped';
  tasks: TaskSnapshot[];
  intercom: {
    taskId: string;
    text: string;
    level: 'info' | 'warning' | 'error';
  }[];
}
