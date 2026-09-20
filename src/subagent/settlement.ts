import type {FleetRecord, TaskRecord} from './records';

// Terminal publication, queue holding and its durable notice are one transition.
// A listener cannot observe eligibility before those facts agree.
export function settleTask(
  record: FleetRecord,
  id: string,
  outcome: NonNullable<TaskRecord['outcome']>,
  reason?: string,
): FleetRecord {
  const task = record.tasks.find(task => task.id === id);
  if (!task || task.phase === 'ended') return record;
  if (
    record.tasks.some(
      child => child.parentTaskId === id && child.phase !== 'ended',
    )
  )
    throw new Error('Owned children have not stopped.');
  const effective = task.stopOutcome ?? outcome;
  return {
    ...record,
    agents: record.agents.map(agent =>
      agent.id === task.agentId &&
      (effective !== 'fulfilled' || task.artifactError !== null)
        ? {...agent, held: true}
        : agent,
    ),
    tasks: record.tasks.map(candidate =>
      candidate.id === id
        ? {
            ...candidate,
            phase: 'ended',
            endedAt: Date.now(),
            stage: 'ended',
            outcome: effective,
            durability: task.artifactError === null ? 'saved' : 'failed',
            reason: reason ?? candidate.reason,
          }
        : candidate,
    ),
    notices: [
      ...record.notices,
      {
        id: `ended:${id}`,
        taskId: id,
        text: `${task.description}: ${effective}.`,
        acknowledged: false,
      },
    ],
  };
}
