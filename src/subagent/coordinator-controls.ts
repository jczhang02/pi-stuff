import {join} from 'node:path';
import {Effect} from 'effect';
import type {AgentSession} from '@earendil-works/pi-coding-agent';
import type {FleetRecord, TaskRecord} from './records';
import type {SubagentInput} from './protocol';
import {canReuseAgent, ownedBranch, ownsTask} from './authority';
import {releaseWorkspace} from './workspace';
import {withExecutionTracking} from './processes';

export interface CoordinatorControlRuntime {
  session: (id: string) => AgentSession | undefined;
  setActiveTools: (id: string, tools: readonly string[]) => void;
  activeToolNames: (id: string) => readonly string[];
}

export interface CoordinatorControlHost {
  readonly storeDirectory: string;
  snapshot: () => FleetRecord;
  task: (id: string) => TaskRecord;
  update: (transform: (record: FleetRecord) => FleetRecord) => Promise<void>;
  effectiveTools: (id: string) => readonly string[];
  cancelTask: (id: string, caller: string | null) => Promise<void>;
  schedule: () => void;
  waitForAgent: (agentId: string) => Promise<void>;
  workspaceOperation: <T>(operation: () => Promise<T>) => Promise<T>;
  runtime: CoordinatorControlRuntime;
}

/** Owns retained-agent controls that must be serialized against admission. */
export class CoordinatorControls {
  private readonly releasing = new Set<string>();

  constructor(private readonly host: CoordinatorControlHost) {}

  isReleasing(agentId: string): boolean {
    return this.releasing.has(agentId);
  }

  async queue(input: SubagentInput, caller: string | null) {
    if (!input.agentId) throw new Error('Queue operation requires agentId.');
    if (!this.host.snapshot().agents.some(agent => agent.id === input.agentId))
      throw new Error('Unknown retained agent.');
    if (!canReuseAgent(this.host.snapshot(), caller, input.agentId))
      throw new Error('Queue operation requires retained-agent authority.');
    if (!input.queueAction)
      throw new Error('Choose queueAction continue or cancel.');
    const queued = this.host
      .snapshot()
      .tasks.filter(
        task => task.agentId === input.agentId && task.phase === 'queued',
      );
    if (queued.some(task => !ownsTask(this.host.snapshot(), caller, task.id)))
      throw new Error('Queued work belongs to another assignment.');
    if (input.queueAction === 'cancel') {
      for (const task of queued) await this.host.cancelTask(task.id, caller);
    } else {
      await this.host.update(record => ({
        ...record,
        agents: record.agents.map(agent =>
          agent.id === input.agentId ? {...agent, held: false} : agent,
        ),
      }));
      this.host.schedule();
    }
    return {status: 'accepted'};
  }

  async restrict(input: SubagentInput, caller: string | null) {
    if (
      !input.taskId ||
      !input.tools ||
      !ownsTask(this.host.snapshot(), caller, input.taskId)
    )
      throw new Error(
        'restrict requires taskId, tools and current task ownership.',
      );
    if (
      input.tools.some(
        tool => !this.host.task(input.taskId ?? '').currentTools.includes(tool),
      )
    )
      throw new Error('Restrictions can only narrow tools.');
    let affected: readonly TaskRecord[] = [];
    await this.host.update(record => {
      const currentTargets = ownedBranch(record, input.taskId ?? '');
      const targetAgentIds = new Set(currentTargets.map(task => task.agentId));
      const roots =
        caller === null
          ? record.tasks.filter(task => targetAgentIds.has(task.agentId))
          : currentTargets;
      // A retained agent may now own a different assignment and new children.
      // Its ceiling constrains that whole current branch, not just the branch
      // containing the historical assignment used to request the restriction.
      const affectedIds = new Set(
        roots.flatMap(task =>
          ownedBranch(record, task.id).map(descendant => descendant.id),
        ),
      );
      affected = record.tasks.filter(
        task => affectedIds.has(task.id) && task.phase !== 'ended',
      );
      return {
        ...record,
        agents: record.agents.map(agent =>
          caller === null && targetAgentIds.has(agent.id)
            ? {
                ...agent,
                currentTools: agent.currentTools.filter(tool =>
                  input.tools?.includes(tool),
                ),
              }
            : agent,
        ),
        tasks: record.tasks.map(task =>
          affectedIds.has(task.id)
            ? {
                ...task,
                currentTools: task.currentTools.filter(tool =>
                  input.tools?.includes(tool),
                ),
                events: [
                  ...task.events,
                  {
                    at: Date.now(),
                    kind: 'restriction',
                    text: `Effective tools narrowed to ${(input.tools ?? []).join(', ')}.`,
                  },
                ],
              }
            : task,
        ),
      };
    });
    for (const task of affected) {
      const session = this.host.runtime.session(task.id);
      this.host.runtime.setActiveTools(
        task.id,
        this.host.effectiveTools(task.id),
      );
      if (
        session &&
        this.host.runtime
          .activeToolNames(task.id)
          .some(tool => !this.host.effectiveTools(task.id).includes(tool))
      )
        await this.host.cancelTask(task.id, caller);
    }
    return {status: 'accepted'};
  }

  async release(input: SubagentInput, caller: string | null) {
    if (caller !== null || !input.agentId)
      throw new Error('Workspace release requires main and agentId.');
    const agent = this.host
      .snapshot()
      .agents.find(candidate => candidate.id === input.agentId);
    if (!agent) throw new Error('Unknown retained agent.');
    if (agent.released) return {status: 'already-released'};
    if (
      this.host
        .snapshot()
        .tasks.some(task => task.agentId === agent.id && task.phase !== 'ended')
    )
      throw new Error(
        'Agent still has active or queued work. Stop it before release.',
      );
    if (this.releasing.has(agent.id))
      throw new Error('Workspace release is already in progress.');
    this.releasing.add(agent.id);
    try {
      // Ended results can precede notification and session cleanup. Reserve
      // the agent against admission, then drain cleanup outside either lock.
      await this.host.waitForAgent(agent.id);
      await this.host.update(record => {
        this.assertReleaseSaved(record);
        if (
          record.tasks.some(
            task => task.agentId === agent.id && task.phase !== 'ended',
          )
        )
          throw new Error('New work arrived before workspace release.');
        return {
          ...record,
          agents: record.agents.map(candidate =>
            candidate.id === agent.id ? {...candidate, held: true} : candidate,
          ),
        };
      });
      const workspace = agent.workspace;
      if (workspace)
        await this.host.workspaceOperation(() => {
          this.assertReleaseSaved(this.host.snapshot());
          return withExecutionTracking(
            join(this.host.storeDirectory, 'sessions', agent.id, 'processes'),
            () => Effect.runPromise(releaseWorkspace({...workspace})),
          );
        });
      await this.host.update(record => {
        this.assertReleaseSaved(record);
        return {
          ...record,
          agents: record.agents.map(candidate =>
            candidate.id === agent.id
              ? {
                  ...candidate,
                  released: true,
                  workspace: candidate.workspace
                    ? {...candidate.workspace, released: true}
                    : null,
                }
              : candidate,
          ),
        };
      });
    } finally {
      this.releasing.delete(agent.id);
      this.host.schedule();
    }
    return {status: 'released', agentId: agent.id};
  }

  private assertReleaseSaved(record: FleetRecord): void {
    if (record.storageError !== null)
      throw new Error(
        `Workspace remains reserved because saving failed: ${record.storageError}`,
      );
  }
}
