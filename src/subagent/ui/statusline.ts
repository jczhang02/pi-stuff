import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from '@earendil-works/pi-coding-agent';
import {truncateToWidth, visibleWidth} from '@earendil-works/pi-tui';
import {homedir} from 'node:os';
import {relative, isAbsolute, sep} from 'node:path';
import {icons, singleLine, tokens} from './rows';
import {sessionUsage} from '../runtime/usage';

// The public extension context supplies footer data without a main AgentSession.
// Compose these fields with Fleet in one footer; never inspect host internals.
export function mainStatusline(
  ctx: ExtensionContext,
  data: ReadonlyFooterDataProvider,
  width: number,
): string[] {
  const theme = ctx.ui.theme;
  const usage = sessionUsage(ctx.sessionManager.getEntries());
  const homeRelative = relative(homedir(), ctx.cwd);
  const insideHome =
    !isAbsolute(homeRelative) &&
    homeRelative !== '..' &&
    !homeRelative.startsWith(`..${sep}`);
  let cwd = insideHome ? `~${homeRelative ? sep + homeRelative : ''}` : ctx.cwd;
  const branch = data.getGitBranch();
  if (branch) cwd += ` (${singleLine(branch)})`;
  const name = ctx.sessionManager.getSessionName();
  if (name) cwd += ` · ${singleLine(name)}`;
  const context = ctx.getContextUsage();
  const contextText = `${context?.percent === null ? '?' : (context?.percent ?? 0).toFixed(1)}%/${tokens(context?.contextWindow ?? ctx.model?.contextWindow ?? 0)}`;
  const color =
    (context?.percent ?? 0) > 90
      ? 'error'
      : (context?.percent ?? 0) > 70
        ? 'warning'
        : 'dim';
  const stats = [
    `${icons.input}${tokens(usage.input)} ${icons.output}${tokens(usage.output)}`,
    ...(usage.cacheRead ? [`R${tokens(usage.cacheRead)}`] : []),
    ...(usage.cacheWrite ? [`W${tokens(usage.cacheWrite)}`] : []),
    `$${usage.cost.toFixed(3)}`,
    theme.fg(color, contextText),
  ].join(' ');
  const model = `${ctx.model?.id ?? 'no-model'}${ctx.model?.reasoning ? ` · ${ctx.thinkingLevel ?? 'off'}` : ''}`;
  const right = truncateToWidth(
    model,
    Math.max(0, width - visibleWidth(stats) - 2),
    '…',
  );
  const lines = [
    theme.fg('dim', truncateToWidth(singleLine(cwd), width, '…')),
    theme.fg(
      'dim',
      truncateToWidth(
        stats +
          ' '.repeat(
            Math.max(2, width - visibleWidth(stats) - visibleWidth(right)),
          ) +
          right,
        width,
        '…',
      ),
    ),
  ];
  const statuses = [...data.getExtensionStatuses()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => singleLine(text));
  if (statuses.length)
    lines.push(truncateToWidth(statuses.join(' '), width, '…'));
  return lines;
}
