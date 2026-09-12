import type {SessionEntry} from '@earendil-works/pi-coding-agent';

export function sessionUsage(entries: readonly SessionEntry[]) {
  const total = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    turns: 0,
  };
  for (const entry of entries) {
    const usage =
      entry.type === 'message' &&
      (entry.message.role === 'assistant' ||
        entry.message.role === 'toolResult')
        ? entry.message.usage
        : entry.type === 'compaction' || entry.type === 'branch_summary'
          ? entry.usage
          : undefined;
    if (entry.type === 'message' && entry.message.role === 'assistant')
      total.turns++;
    if (!usage) continue;
    total.input += usage.input;
    total.output += usage.output;
    total.cacheRead += usage.cacheRead;
    total.cacheWrite += usage.cacheWrite;
    total.cost += usage.cost.total;
  }
  return total;
}
