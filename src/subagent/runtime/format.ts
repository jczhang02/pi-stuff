import type {RunSnapshot, TaskSnapshot} from './types';

// Adapted from Arhen pi-core-subagent 1.3.54; see LICENSE.arhen.
export function truncateText(text: string, limit = 24_000): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[Truncated; full output remains in the child conversation.]`;
}

export function taskSummary(task: TaskSnapshot): string {
  return [
    `${task.id} (${task.agent}): ${task.status}`,
    task.error,
    task.finalText,
    task.branch
      ? `Worktree: ${task.cwd}\nBranch: ${task.branch}. Changes are retained for review; not automatically committed or merged.`
      : undefined,
    task.sessionFile ? `Session: ${task.sessionFile}` : undefined,
    `${task.toolCalls} tools · ${task.usage.turns} turns · input ${task.usage.input} · output ${task.usage.output} · $${task.usage.cost.toFixed(4)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatRun(run: RunSnapshot): string {
  return truncateText(
    `Run ${run.id}: ${run.status}\n\n${run.tasks.map(taskSummary).join('\n\n')}`,
  );
}
