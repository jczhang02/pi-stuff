import type {FleetRecord} from './records';

export function ownsTask(
  record: FleetRecord,
  caller: string | null,
  target: string,
) {
  if (caller === null) return true;
  const seen = new Set<string>();
  let current = record.tasks.find(task => task.id === target);
  while (current) {
    if (current.id === caller) return true;
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    current = record.tasks.find(task => task.id === current?.parentTaskId);
  }
  return false;
}

export function ownedBranch(record: FleetRecord, id: string) {
  return record.tasks.filter(task => ownsTask(record, id, task.id));
}

export function canReuseAgent(
  record: FleetRecord,
  caller: string | null,
  agentId: string,
) {
  if (caller === null) return true;
  const parent = record.tasks.find(task => task.id === caller);
  if (!parent) return false;
  let current = record.agents.find(agent => agent.id === agentId);
  const seen = new Set<string>();
  while (current) {
    if (current.parentAgentId === parent.agentId) return true;
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    current = record.agents.find(agent => agent.id === current?.parentAgentId);
  }
  return false;
}
