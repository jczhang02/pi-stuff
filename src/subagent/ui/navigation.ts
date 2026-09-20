import type {FleetRecord, TaskRecord} from '../records';
import type {GraphNode, OverviewModel} from './types';
import {oneLine} from './format';

export function compactTaskLabel(task: TaskRecord): string {
  const description = oneLine(task.description);
  if (description.length > 0) return description;
  const prompt = oneLine(task.prompt);
  const firstSentence = prompt.split(/(?<=[.!?])\s+/u)[0] ?? prompt;
  return firstSentence.length > 72
    ? `${firstSentence.slice(0, 69).trimEnd()}...`
    : firstSentence;
}

export function retainedAgents(snapshot: FleetRecord) {
  return snapshot.agents.toSorted(
    (left, right) => left.createdAt - right.createdAt,
  );
}

export function dispatchOrder(snapshot: FleetRecord): readonly string[] {
  const known = new Set(snapshot.dispatches.map(dispatch => dispatch.id));
  const listed = snapshot.dispatches.map(dispatch => dispatch.id);
  const extras = snapshot.tasks
    .map(task => task.dispatchId)
    .filter(dispatchId => !known.has(dispatchId))
    .filter((dispatchId, index, all) => all.indexOf(dispatchId) === index);
  return [...listed, ...extras];
}

export function tasksForDispatch(
  snapshot: FleetRecord,
  dispatchId: string,
): readonly TaskRecord[] {
  return snapshot.tasks
    .filter(task => task.dispatchId === dispatchId)
    .toSorted((left, right) => left.admittedAt - right.admittedAt);
}

function graphNodes(
  tasks: readonly TaskRecord[],
  snapshot: FleetRecord,
): readonly GraphNode[] {
  const taskMap = new Map(tasks.map(task => [task.id, task]));
  const ordered = dependencyOrder(tasks);
  const levels = new Map<string, number>();
  for (const task of ordered) {
    const level = task.needs.reduce((maximum, dependency) => {
      const dependencyLevel = levels.get(dependency);
      return dependencyLevel === undefined
        ? maximum
        : Math.max(maximum, dependencyLevel + 1);
    }, 0);
    levels.set(task.id, level);
  }
  const references = ordered.flatMap(task =>
    task.needs
      .filter(id => !taskMap.has(id))
      .map(id => {
        const source = snapshot.tasks.find(candidate => candidate.id === id);
        const agent = snapshot.agents.find(
          candidate => candidate.id === source?.agentId,
        );
        return {
          id: `reference:${id}`,
          task: undefined,
          reference: true,
          label:
            source === undefined
              ? `Unavailable saved input ${id.slice(0, 12)}`
              : `Saved ${agent?.name ?? 'agent'} · ${compactTaskLabel(source)}`,
          level: Math.max(0, levels.get(task.id) ?? 0) - 1,
        };
      }),
  );
  const uniqueReferences = references
    .filter(
      (node, index, all) =>
        all.findIndex(candidate => candidate.id === node.id) === index,
    )
    .map(node => ({
      ...node,
      level: Math.min(
        ...references
          .filter(candidate => candidate.id === node.id)
          .map(candidate => candidate.level),
      ),
    }));
  return [
    ...ordered.map(task => ({
      id: task.id,
      task,
      reference: false,
      label: compactTaskLabel(task),
      level: levels.get(task.id) ?? 0,
    })),
    ...uniqueReferences,
  ];
}

export function overviewModels(
  snapshot: FleetRecord,
  rootTaskId?: string,
): readonly OverviewModel[] {
  const scopedTaskIds = rootTaskId
    ? childTaskIds(snapshot, rootTaskId)
    : undefined;
  const root = rootTaskId
    ? snapshot.tasks.find(task => task.id === rootTaskId)
    : undefined;
  const rootAgent = snapshot.agents.find(agent => agent.id === root?.agentId);
  const rootLabel =
    root === undefined
      ? undefined
      : oneLine(rootAgent?.name ?? compactTaskLabel(root));
  const models: OverviewModel[] = [];
  for (const dispatchId of dispatchOrder(snapshot)) {
    const allTasks = tasksForDispatch(snapshot, dispatchId);
    const tasks =
      scopedTaskIds === undefined
        ? allTasks.filter(task => task.parentTaskId === null)
        : allTasks.filter(task => scopedTaskIds.has(task.id));
    if (tasks.length === 0) continue;
    models.push({
      dispatchId,
      title: rootLabel
        ? `Children of ${rootLabel}`
        : `Dispatch ${dispatchId.slice(0, 12)}`,
      taskIds: tasks.map(task => task.id),
      hasDependencies: tasks.some(task => task.needs.length > 0),
      nodes: graphNodes(tasks, snapshot),
    });
  }
  return models;
}

function childTaskIds(
  snapshot: FleetRecord,
  rootTaskId: string,
): ReadonlySet<string> {
  return new Set(
    snapshot.tasks
      .filter(task => task.parentTaskId === rootTaskId)
      .map(task => task.id),
  );
}

export function stableTaskOrder(
  snapshot: FleetRecord,
  dispatchId: string,
): readonly TaskRecord[] {
  return dependencyOrder(tasksForDispatch(snapshot, dispatchId));
}

function dependencyOrder(tasks: readonly TaskRecord[]): readonly TaskRecord[] {
  const pending = tasks.toSorted(
    (left, right) => left.admittedAt - right.admittedAt,
  );
  const ids = new Set(tasks.map(task => task.id));
  const emitted = new Set<string>();
  const ordered: TaskRecord[] = [];
  while (pending.length > 0) {
    const ready = pending.findIndex(task =>
      task.needs.every(id => !ids.has(id) || emitted.has(id)),
    );
    // Admission rejects cycles. Keep any unreadable retained cycle visible
    // rather than dropping its records or recursing indefinitely.
    if (ready < 0) return [...ordered, ...pending];
    const task = pending.splice(ready, 1)[0]!;
    ordered.push(task);
    emitted.add(task.id);
  }
  return ordered;
}

export function descendants(
  snapshot: FleetRecord,
  rootTaskId: string,
): readonly TaskRecord[] {
  const result: TaskRecord[] = [];
  const pending = [rootTaskId];
  const seen = new Set<string>(pending);
  while (pending.length > 0) {
    const parent = pending.shift();
    if (parent === undefined) continue;
    const children = snapshot.tasks.filter(
      task => task.parentTaskId === parent,
    );
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child);
      pending.push(child.id);
    }
  }
  return result;
}

export function childrenOf(
  snapshot: FleetRecord,
  taskId: string,
): readonly TaskRecord[] {
  return snapshot.tasks
    .filter(task => task.parentTaskId === taskId)
    .toSorted((left, right) => left.admittedAt - right.admittedAt);
}

export function prerequisiteNames(
  snapshot: FleetRecord,
  task: TaskRecord,
): readonly string[] {
  return task.needs.map(id => {
    const source = snapshot.tasks.find(candidate => candidate.id === id);
    return source?.description || source?.prompt || `Reference ${id}`;
  });
}

export function missingPrerequisites(
  snapshot: FleetRecord,
  task: TaskRecord,
): readonly string[] {
  return task.needs.filter(
    id => !snapshot.tasks.some(candidate => candidate.id === id),
  );
}

export function graphEdges(
  model: OverviewModel,
): readonly {readonly from: string; readonly to: string}[] {
  const ids = new Set(model.nodes.map(node => node.id));
  return model.nodes.flatMap(node => {
    if (node.reference || node.task === undefined) return [];
    return node.task.needs.map(need => ({
      from: ids.has(need) ? need : `reference:${need}`,
      to: node.id,
    }));
  });
}
