import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from '@earendil-works/pi-coding-agent';
import {Schema} from 'effect';
import {truncateToWidth, visibleWidth} from '@earendil-works/pi-tui';
import {compactCount} from './fleet';

const UsageEntry = Schema.Struct({
  type: Schema.Literal('usage'),
  usage: Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
    cacheRead: Schema.Number,
    cacheWrite: Schema.Number,
    cost: Schema.Struct({total: Schema.Number}),
  }),
});

// The public footer hook exposes context and footer data, not AgentSession.
export function mainFooter(
  ctx: ExtensionContext,
  data: ReadonlyFooterDataProvider,
  theme: Theme,
  width: number,
): string[] {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  for (const entry of ctx.sessionManager.getEntries()) {
    const usageEntry = Schema.decodeUnknownOption(UsageEntry)(entry);
    const usage =
      usageEntry._tag === 'Some'
        ? usageEntry.value.usage
        : entry.type === 'message'
          ? entry.message.role === 'assistant' ||
            entry.message.role === 'toolResult'
            ? entry.message.usage
            : undefined
          : entry.type === 'compaction' || entry.type === 'branch_summary'
            ? entry.usage
            : undefined;
    if (!usage) continue;
    input += usage.input;
    output += usage.output;
    cacheRead += usage.cacheRead;
    cacheWrite += usage.cacheWrite;
    cost += usage.cost.total;
  }
  const branch = data.getGitBranch();
  const name = ctx.sessionManager.getSessionName();
  const cwd = `${ctx.cwd}${branch ? ` (${branch})` : ''}${name ? ` · ${name}` : ''}`;
  const context = ctx.getContextUsage();
  const usage = [
    ...(input ? [`↑${compactCount(input)}`] : []),
    ...(output ? [`↓${compactCount(output)}`] : []),
    ...(cacheRead ? [`R${compactCount(cacheRead)}`] : []),
    ...(cacheWrite ? [`W${compactCount(cacheWrite)}`] : []),
    ...(cost ? [`$${cost.toFixed(3)}`] : []),
    context
      ? `${context.percent === null ? '?' : context.percent.toFixed(1) + '%'}/${compactCount(context.contextWindow)}`
      : 'Context unavailable',
  ].join(' ');
  const model = ctx.model
    ? `${ctx.model.id}${ctx.thinkingLevel ? ` · ${ctx.thinkingLevel}` : ''}`
    : 'No model';
  const right = truncateToWidth(model, Math.max(0, Math.floor(width / 2)), '…');
  const left = truncateToWidth(
    usage,
    Math.max(0, width - visibleWidth(right) - 2),
    '…',
  );
  const lines = [
    cwd,
    left +
      ' '.repeat(
        Math.max(0, width - visibleWidth(left) - visibleWidth(right)),
      ) +
      right,
  ];
  const statuses = [...data.getExtensionStatuses()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value.replace(/[\r\n\t]/g, ' '));
  if (statuses.length) lines.push(statuses.join(' '));
  return lines.map(line => theme.fg('dim', truncateToWidth(line, width, '…')));
}
