import type {Assignment} from './protocol';
import type {TaskRecord} from './records';

// Dependency edges carry fixed results. Task ownership is a separate relation.
export function dependencyPlan(assignments: readonly Assignment[]) {
  const keys = new Map<string, number>();
  assignments.forEach((assignment, index) => {
    if (assignment.key === undefined) return;
    if (keys.has(assignment.key)) throw new Error('Duplicate dependency key.');
    keys.set(assignment.key, index);
  });
  const edges = assignments.map(assignment =>
    (assignment.needs ?? []).map(key => {
      const index = keys.get(key);
      if (index === undefined)
        throw new Error(`Unknown dependency key: ${key}`);
      return index;
    }),
  );
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (index: number) => {
    if (visiting.has(index))
      throw new Error('Dependency graph contains a cycle.');
    if (visited.has(index)) return;
    visiting.add(index);
    for (const dependency of edges[index] ?? []) visit(dependency);
    visiting.delete(index);
    visited.add(index);
  };
  edges.forEach((_edge, index) => visit(index));
  return edges;
}

export function dependencyReadiness(
  task: TaskRecord,
  tasks: readonly TaskRecord[],
) {
  const inputs = task.needs.map(id =>
    tasks.find(candidate => candidate.id === id),
  );
  if (inputs.some(input => input === undefined)) return 'unavailable';
  if (
    inputs.some(
      input =>
        input?.phase === 'ended' &&
        (input.outcome !== 'fulfilled' || input.durability !== 'saved'),
    )
  )
    return 'failed';
  if (inputs.some(input => input?.phase !== 'ended')) return 'waiting';
  return 'ready';
}
