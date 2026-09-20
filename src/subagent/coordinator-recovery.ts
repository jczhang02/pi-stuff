import type {ExtensionContext} from '@earendil-works/pi-coding-agent';
import type {FleetRecord} from './records';
import type {FleetJournal} from './coordinator-journal';
import type {FleetStore} from './store';

export interface CoordinatorRecoveryHost {
  readonly store: FleetStore;
  readonly journal: FleetJournal;
  readonly context: () => ExtensionContext;
  readonly abortAll: () => Promise<void>;
  readonly stopAdmission: () => void;
  readonly wakeWaiters: () => void;
}

/** Owns startup reconciliation and the fail-closed persistence transition. */
export class CoordinatorRecovery {
  constructor(private readonly host: CoordinatorRecoveryHost) {}

  async initialize(): Promise<FleetRecord> {
    if (!this.host.store.writable) {
      await this.host.journal.refresh();
      if (this.host.store.recovery.ownerStatus !== 'active') {
        this.host.journal.replaceSnapshot({
          ...this.host.journal.snapshot,
          tasks: this.host.journal.snapshot.tasks.map(task =>
            task.phase === 'ended'
              ? task
              : {
                  ...task,
                  phase: 'unknown',
                  reason:
                    task.reason ||
                    'Another executor or retained process may still own this task.',
                },
          ),
        });
      }
      this.host.journal.startWatching();
      return this.host.journal.snapshot;
    }

    if (
      !this.host.journal.snapshot.tasks.some(task => task.phase !== 'ended')
    ) {
      this.host.journal.startWatching();
      return this.host.journal.snapshot;
    }
    const interruptedAt = Date.now();
    await this.host.journal.update(record => {
      const unfinished = record.tasks.filter(task => task.phase !== 'ended');
      const unfinishedIds = new Set(unfinished.map(task => task.id));
      const heldAgents = new Set(unfinished.map(task => task.agentId));
      const notices = [...record.notices];
      for (const task of unfinished) {
        if (notices.some(notice => notice.id === `ended:${task.id}`)) continue;
        notices.push({
          id: `ended:${task.id}`,
          taskId: task.id,
          text: `${task.description}: interrupted during parent-session recovery.`,
          acknowledged: false,
        });
      }
      return {
        ...record,
        agents: record.agents.map(agent =>
          heldAgents.has(agent.id) ? {...agent, held: true} : agent,
        ),
        tasks: record.tasks.map(task =>
          unfinishedIds.has(task.id)
            ? {
                ...task,
                phase: 'ended',
                stopOutcome: 'interrupted',
                outcome: 'interrupted',
                endedAt: interruptedAt,
                stage: 'ended',
                activeTools: [],
                durability: task.durability === 'failed' ? 'failed' : 'saved',
                reason: 'Interrupted during parent-session recovery.',
              }
            : task,
        ),
        notices,
      };
    });
    this.host.journal.startWatching();
    return this.host.journal.snapshot;
  }

  fail(error: Error | string): void {
    if (this.host.journal.snapshot.storageError !== null) return;
    const message = String(error);
    this.host.stopAdmission();
    this.host.journal.close();
    this.host.wakeWaiters();
    const heldAgents = new Set(
      this.host.journal.snapshot.tasks
        .filter(task => task.phase !== 'ended')
        .map(task => task.agentId),
    );
    this.host.journal.replaceSnapshot({
      ...this.host.journal.snapshot,
      storageError: message,
      agents: this.host.journal.snapshot.agents.map(agent =>
        heldAgents.has(agent.id) ? {...agent, held: true} : agent,
      ),
      tasks: this.host.journal.snapshot.tasks.map(task =>
        task.phase === 'ended'
          ? task
          : {
              ...task,
              phase: 'cancelling',
              stopOutcome: task.stopOutcome ?? 'interrupted',
              durability: 'failed',
              reason: `Saving failed: ${message}`,
            },
      ),
    });
    try {
      this.host
        .context()
        .ui.notify(
          `Subagent save failed. Execution is stopping; records and workspaces remain reserved. ${message}`,
          'error',
        );
    } catch {
      /* The failed persistence state remains authoritative. */
    }
    void this.host.abortAll().catch(stopError => {
      try {
        this.host
          .context()
          .ui.notify(`Subagent could not stop: ${String(stopError)}`, 'error');
      } catch {
        /* The durable failure remains authoritative. */
      }
    });
  }
}
