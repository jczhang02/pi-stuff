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
export type Entry =
  | Tool
  | {kind: 'user' | 'assistant'; text: string}
  | {kind: 'thoughts'; text: string; seconds: number; running?: boolean}
  | {kind: 'status'; text: string; error?: boolean}
  | {kind: 'explore'; tools: readonly Tool[]};

export function isExploration(entry: Entry): entry is Tool {
  return (
    entry.kind === 'tool' &&
    entry.state === 'done' &&
    !entry.warning &&
    ['Read', 'Grep', 'Find', 'Ls'].includes(entry.name)
  );
}
export function groupExploration(entries: readonly Entry[]): Entry[] {
  const result: Entry[] = [];
  let pending: Tool[] = [];
  const flush = () => {
    if (pending.length >= 2) result.push({kind: 'explore', tools: pending});
    else result.push(...pending);
    pending = [];
  };
  for (const entry of entries) {
    if (isExploration(entry)) pending.push(entry);
    else {
      flush();
      result.push(entry);
    }
  }
  flush();
  return result;
}
