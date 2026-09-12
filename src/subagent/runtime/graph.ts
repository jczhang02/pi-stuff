import type {RunMode} from './types';

// Dependency validation and prompt propagation adapted from Arhen 1.3.54.
export function resolveNeeds(
  inputs: {id?: string | undefined; needs?: string[] | undefined}[],
  mode: RunMode,
): string[][] {
  const ids = inputs.map((input, index) => input.id ?? `task_${index + 1}`);
  if (new Set(ids).size !== ids.length)
    throw new Error('Duplicate task ids (including generated task ids).');
  const known = new Set(ids);
  const edges = inputs.map((input, index) => {
    const previous = ids[index - 1];
    const needs =
      mode === 'chain'
        ? previous
          ? [previous]
          : []
        : [...new Set(input.needs ?? [])];
    for (const need of needs) {
      if (!known.has(need))
        throw new Error(`Task ${ids[index]} needs unknown task ${need}.`);
      if (need === ids[index])
        throw new Error(`Task ${need} cannot depend on itself.`);
    }
    return needs;
  });
  const pending = ids.map((id, index) => ({id, needs: edges[index] ?? []}));
  const done = new Set<string>();
  while (done.size < ids.length) {
    const ready = pending.filter(
      task => !done.has(task.id) && task.needs.every(id => done.has(id)),
    );
    if (!ready.length) throw new Error('Cycle in subagent dependencies.');
    for (const task of ready) done.add(task.id);
  }
  return edges;
}

export function applyUpstream(
  task: string,
  needs: string[],
  outputs: Map<string, string>,
): string {
  const previous = outputs.get(needs[0] ?? '') ?? '';
  const prompt = task.replaceAll('{previous}', () => previous);
  if (!needs.length) return prompt;
  return `${needs.map(id => `## Output of ${id}\n${outputs.get(id) ?? '(no output)'}`).join('\n\n')}\n\n---\n\n${prompt}`;
}
