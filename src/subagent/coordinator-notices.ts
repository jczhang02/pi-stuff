import type {FleetRecord, TaskRecord} from './records';

export interface DispatchNoticeHost {
  snapshot: () => FleetRecord;
  update: (transform: (record: FleetRecord) => FleetRecord) => Promise<void>;
  notify: (task: TaskRecord | null, text: string) => void;
}

/** Publishes one durable notice when a dispatch cohort has fully settled. */
export class DispatchSettlementNotifier {
  constructor(private readonly host: DispatchNoticeHost) {}

  async announce(dispatchId: string): Promise<void> {
    const initial = this.host.snapshot();
    const dispatch = initial.dispatches.find(
      candidate => candidate.id === dispatchId,
    );
    if (!dispatch) return;
    const tasks = initial.tasks.filter(task => task.dispatchId === dispatchId);
    if (
      tasks.length < dispatch.admitted ||
      tasks.some(task => task.phase !== 'ended')
    )
      return;
    const noticeId = `settled:${dispatchId}:${dispatch.admitted}`;
    if (initial.notices.some(notice => notice.id === noticeId)) return;
    const identities = tasks
      .map(
        task =>
          `${task.id} (agent ${task.agentId}${task.commit ? `, fixed ${task.commit}` : ''})`,
      )
      .join('; ');
    const text = `Dispatch ${dispatchId} with ${dispatch.admitted} assignments settled: ${identities}.`;
    let created = false;
    await this.host.update(record => {
      const currentDispatch = record.dispatches.find(
        candidate => candidate.id === dispatchId,
      );
      const currentTasks = record.tasks.filter(
        task => task.dispatchId === dispatchId,
      );
      if (
        !currentDispatch ||
        currentTasks.length < currentDispatch.admitted ||
        currentTasks.some(task => task.phase !== 'ended') ||
        record.notices.some(notice => notice.id === noticeId)
      )
        return record;
      const anchor = currentTasks[0];
      if (!anchor) return record;
      created = true;
      return {
        ...record,
        notices: [
          ...record.notices,
          {id: noticeId, taskId: anchor.id, text, acknowledged: false},
        ],
      };
    });
    if (created) this.host.notify(null, text);
  }
}
