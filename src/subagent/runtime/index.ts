/**
 * Runtime for independent Pi SDK agent sessions.
 *
 * The manager owns scheduling, task lifecycle, mailbox delivery, session
 * persistence, and worktree isolation. Presentation and command registration
 * belong to the parent extension.
 */
export {SubagentManager} from './manager';
export type {
  ParkedMsg,
  RuntimeListener,
  SubagentRuntimeOptions,
} from './manager';
export type {
  RunMode,
  RunSnapshot,
  RunStatus,
  TaskSnapshot,
  TaskStatus,
  UsageStats,
} from './types';
export type {SubagentInput, TaskInput} from './schemas';
