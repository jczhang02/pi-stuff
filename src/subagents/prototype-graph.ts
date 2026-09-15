// Adapted from @arhen/pi-core-subagent 1.3.54, src/graph.ts, commit
// de1c8783c2a39b1cbb0f86b412307193de9774c1. The prototype keeps the
// dependency prompt handoff while leaving rendering and task ownership to the
// FleetView runtime.

export function applyUpstream(
  task: string,
  needs: readonly string[],
  outputs: ReadonlyMap<string, string>,
  names?: ReadonlyMap<string, string>,
): string {
  if (needs.length === 0) {
    return task.includes('{previous}')
      ? `${task.replace(/\{previous\}/g, '')}\n\n(Note: {previous} was empty - no prior step output existed yet.)`
      : task;
  }

  const first = outputs.get(needs[0] ?? '') ?? '';
  const body = task.replace(/\{previous\}/g, () => first);
  const blocks = needs.map(
    need =>
      `## Output of ${names?.get(need) ?? need}\n${outputs.get(need) ?? '(no output)'}`,
  );
  return `${blocks.join('\n\n')}\n\n---\n\n${body}`;
}

export function resolveNeeds(
  taskIds: readonly string[],
  needs: ReadonlyMap<string, readonly string[]>,
): void {
  const known = new Set(taskIds);
  for (const taskId of taskIds) {
    const dependencies = needs.get(taskId) ?? [];
    for (const dependency of dependencies) {
      if (!known.has(dependency))
        throw new Error(`Task ${taskId} needs unknown task id: ${dependency}`);
      if (dependency === taskId)
        throw new Error(`Task ${taskId} cannot need itself.`);
    }
  }

  const settled = new Set<string>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const taskId of taskIds) {
      if (settled.has(taskId)) continue;
      if (
        (needs.get(taskId) ?? []).every(dependency => settled.has(dependency))
      ) {
        settled.add(taskId);
        progress = true;
      }
    }
  }
  if (settled.size !== taskIds.length) {
    throw new Error(
      `Cycle in subagent needs: ${taskIds.filter(taskId => !settled.has(taskId)).join(', ')}`,
    );
  }
}
