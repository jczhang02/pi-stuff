// Throwaway conversation prototype. No real tool or provider is executed.
export type DiffRow = {
  kind: 'context' | 'add' | 'remove';
  text: string;
  oldLine?: number;
  newLine?: number;
};
export type ToolBody =
  | {kind: 'text'; text: string}
  | {kind: 'code'; path: string; text: string; start: number}
  | {kind: 'diff'; path: string; rows: readonly DiffRow[]};
export type Tool = {
  kind: 'tool';
  name:
    | 'Read'
    | 'Grep'
    | 'Find'
    | 'Ls'
    | 'Edit'
    | 'Write'
    | 'Bash'
    | 'WebSearch'
    | 'WebFetch'
    | 'WebRead';
  target: string;
  summary: string;
  body: ToolBody;
  state: 'done' | 'running' | 'failed' | 'cancelled';
  warning?: string;
  metadata?: string;
};
export type Thoughts = {
  kind: 'thoughts';
  text: string;
  seconds: number;
  running?: boolean;
};
export type Entry =
  | Tool
  | {kind: 'user' | 'assistant'; text: string}
  | Thoughts
  | {kind: 'status'; text: string; error?: boolean}
  | {kind: 'explore'; tools: readonly Tool[]};

export function isExploration(entry: Entry): entry is Tool {
  return (
    entry.kind === 'tool' &&
    entry.state === 'done' &&
    !entry.warning &&
    ['Read', 'Grep', 'Find', 'Ls', 'WebSearch', 'WebFetch', 'WebRead'].includes(
      entry.name,
    )
  );
}
export function groupExploration(entries: readonly Entry[]): Entry[] {
  const result: Entry[] = [];
  let pending: Tool[] = [];
  const flush = () => {
    if (pending.length) result.push({kind: 'explore', tools: pending});
    pending = [];
  };
  for (const entry of entries) {
    if (entry.kind === 'assistant' && !entry.text.trim()) continue;
    if (isExploration(entry)) pending.push(entry);
    else {
      flush();
      result.push(entry);
    }
  }
  flush();
  return result;
}
