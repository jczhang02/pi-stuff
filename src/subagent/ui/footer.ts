import type {ExtensionContext, Theme} from '@earendil-works/pi-coding-agent';
import {
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from '@earendil-works/pi-tui';
import type {ReadonlyFooterDataProvider} from '@earendil-works/pi-coding-agent';
import {stripVTControlCharacters} from 'node:util';
import type {FleetRecord} from '../records';
import {
  computeFleetColumns,
  countAttention,
  formatRange,
  MAIN_ID,
  renderFleetRow,
  taskForAgent,
} from './format';
import {retainedAgents} from './navigation';

export interface FleetFooterState {
  snapshot(): FleetRecord;
  selectedAgentId(): string | undefined;
  inspecting(): boolean;
  now(): number;
  footerContext(): ExtensionContext;
  sessionManager(): ExtensionContext['sessionManager'];
}

export class FleetFooter implements Component {
  private readonly unsubscribeBranch: () => void;
  private readonly elapsedTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly footerData: ReadonlyFooterDataProvider,
    private readonly state: FleetFooterState,
    private readonly requestRender: () => void,
  ) {
    this.unsubscribeBranch = footerData.onBranchChange(() =>
      this.requestRender(),
    );
    this.elapsedTimer = setInterval(() => {
      if (this.state.snapshot().tasks.some(task => task.phase !== 'ended'))
        this.requestRender();
    }, 1000);
  }

  render(width: number): string[] {
    if (this.state.inspecting()) return [];
    const snapshot = this.state.snapshot();
    const now = this.state.now();
    const lines = this.renderNativeFooter(width);
    const agents = retainedAgents(snapshot);
    if (agents.length === 0) return lines;
    const columns = computeFleetColumns(snapshot, width, now);
    const maxChildren = Math.min(6, Math.max(0, this.tui.terminal.rows - 18));
    const visibleChildren = agents.slice(0, maxChildren);
    lines.push(
      renderCompactRow(
        this.state.selectedAgentId() === MAIN_ID,
        columns.width,
        this.theme,
      ),
    );
    for (const agent of visibleChildren)
      lines.push(
        renderFleetRow(
          snapshot,
          agent,
          this.state.selectedAgentId() === agent.id,
          columns,
          this.theme,
          now,
        ),
      );
    const total = agents.length;
    const attention = countAttention(snapshot);
    const range =
      visibleChildren.length === 0
        ? `0 of ${total}`
        : formatRange(0, visibleChildren.length - 1, total);
    const hidden = Math.max(0, total - visibleChildren.length);
    const suffix = hidden > 0 ? ` · ${hidden} offscreen` : '';
    const attentionSuffix = attention > 0 ? ` · ${attention} attention` : '';
    const activeOffscreen = agents
      .slice(visibleChildren.length)
      .filter(agent => {
        const task = taskForAgent(snapshot, agent.id);
        return task !== undefined && task.phase !== 'ended';
      }).length;
    const activeSuffix =
      activeOffscreen > 0 ? ` · ${activeOffscreen} active offscreen` : '';
    if (snapshot.storageError !== null)
      lines.push(
        this.theme.fg(
          'error',
          `Save failed: ${stripVTControlCharacters(snapshot.storageError)}`,
        ),
      );
    lines.push(
      this.theme.fg(
        'dim',
        `${range}${suffix}${activeSuffix}${attentionSuffix} · /agents`,
      ),
    );
    return lines;
  }

  invalidate(): void {}

  dispose(): void {
    this.unsubscribeBranch();
    clearInterval(this.elapsedTimer);
  }

  private renderNativeFooter(width: number): string[] {
    const context = this.state.footerContext();
    const usage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    };
    let latestCacheHitRate: number | undefined;
    for (const entry of context.sessionManager.getEntries()) {
      if (entry.type === 'message' && entry.message.role === 'assistant') {
        usage.input += entry.message.usage.input;
        usage.output += entry.message.usage.output;
        usage.cacheRead += entry.message.usage.cacheRead;
        usage.cacheWrite += entry.message.usage.cacheWrite;
        usage.cost += entry.message.usage.cost.total;
        const promptTokens =
          entry.message.usage.input +
          entry.message.usage.cacheRead +
          entry.message.usage.cacheWrite;
        latestCacheHitRate =
          promptTokens > 0
            ? (entry.message.usage.cacheRead / promptTokens) * 100
            : undefined;
      } else if (
        entry.type === 'message' &&
        entry.message.role === 'toolResult' &&
        entry.message.usage !== undefined
      ) {
        usage.input += entry.message.usage.input;
        usage.output += entry.message.usage.output;
        usage.cacheRead += entry.message.usage.cacheRead;
        usage.cacheWrite += entry.message.usage.cacheWrite;
        usage.cost += entry.message.usage.cost.total;
      } else if (
        (entry.type === 'branch_summary' || entry.type === 'compaction') &&
        entry.usage !== undefined
      ) {
        usage.input += entry.usage.input;
        usage.output += entry.usage.output;
        usage.cacheRead += entry.usage.cacheRead;
        usage.cacheWrite += entry.usage.cacheWrite;
        usage.cost += entry.usage.cost.total;
      }
    }
    const contextUsage = context.getContextUsage();
    const contextWindow =
      contextUsage?.contextWindow ?? context.model?.contextWindow ?? 0;
    const contextPercent = contextUsage?.percent;
    const stats: string[] = [];
    if (usage.input > 0) stats.push(`↑${nativeTokenCount(usage.input)}`);
    if (usage.output > 0) stats.push(`↓${nativeTokenCount(usage.output)}`);
    if (usage.cacheRead > 0)
      stats.push(`R${nativeTokenCount(usage.cacheRead)}`);
    if (usage.cacheWrite > 0)
      stats.push(`W${nativeTokenCount(usage.cacheWrite)}`);
    if (
      (usage.cacheRead > 0 || usage.cacheWrite > 0) &&
      latestCacheHitRate !== undefined
    )
      stats.push(`CH${latestCacheHitRate.toFixed(1)}%`);
    if (usage.cost > 0) stats.push(`$${usage.cost.toFixed(3)}`);
    const contextLabel =
      contextPercent === null || contextPercent === undefined
        ? `?/${nativeTokenCount(contextWindow)}`
        : `${contextPercent.toFixed(1)}%/${nativeTokenCount(contextWindow)}`;
    const contextColor =
      contextPercent !== null &&
      contextPercent !== undefined &&
      contextPercent > 90
        ? 'error'
        : contextPercent !== null &&
            contextPercent !== undefined &&
            contextPercent > 70
          ? 'warning'
          : 'dim';
    stats.push(this.theme.fg(contextColor, contextLabel));
    const cwd = compactCwd(context.sessionManager.getCwd());
    const branch = this.footerDataBranch();
    const cwdWithSession = [
      branch ? `${cwd} (${branch})` : cwd,
      context.sessionManager.getSessionName(),
    ]
      .filter((part): part is string => part !== undefined)
      .join(' · ');
    const modelName = context.model?.id ?? 'no-model';
    const thinking = context.thinkingLevel ?? 'off';
    const modelText = context.model?.reasoning
      ? `${modelName} · ${thinking}`
      : modelName;
    const rightText =
      this.footerDataProviderCount() > 1 && context.model
        ? `(${context.model.provider}) ${modelText}`
        : modelText;
    const left = this.theme.fg('dim', stats.join(' '));
    const right = this.theme.fg('dim', rightText);
    const statsWidth = visibleWidth(left);
    const rightWidth = visibleWidth(right);
    const available = width - statsWidth - rightWidth;
    let statsLine: string;
    if (available >= 2) statsLine = `${left}${' '.repeat(available)}${right}`;
    else if (width > statsWidth + 1) {
      const truncatedRight = truncateToWidth(right, width - statsWidth - 1, '');
      statsLine = `${left}${' '.repeat(Math.max(1, width - statsWidth - visibleWidth(truncatedRight)))}${truncatedRight}`;
    } else statsLine = truncateToWidth(left, width, '');
    const lines = [
      truncateToWidth(this.theme.fg('dim', cwdWithSession), width, '...'),
      truncateToWidth(statsLine, width, ''),
    ];
    const statuses = [...this.footerDataStatuses()]
      .map(text =>
        stripVTControlCharacters(text)
          .replace(/[\r\n\t]/gu, ' ')
          .replace(/ +/gu, ' ')
          .trim(),
      )
      .filter(text => text.length > 0);
    if (statuses.length > 0)
      lines.push(
        truncateToWidth(this.theme.fg('dim', statuses.join(' ')), width, ''),
      );
    return lines;
  }

  private footerDataBranch(): string | null {
    return this.footerData.getGitBranch();
  }

  private footerDataProviderCount(): number {
    return this.footerData.getAvailableProviderCount();
  }

  private footerDataStatuses(): readonly string[] {
    return [...this.footerData.getExtensionStatuses().values()];
  }
}

function nativeTokenCount(value: number): string {
  if (value < 1000) return `${Math.round(value)}`;
  if (value < 10000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1000000) return `${Math.round(value / 1000)}k`;
  if (value < 10000000) return `${(value / 1000000).toFixed(1)}M`;
  return `${Math.round(value / 1000000)}M`;
}

function compactCwd(cwd: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home === undefined) return cwd;
  if (cwd === home) return '~';
  if (cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

function renderCompactRow(
  selected: boolean,
  width: number,
  theme: Theme,
): string {
  const marker = selected ? theme.fg('accent', '●') : theme.fg('muted', '○');
  return truncateToWidth(`${marker} ${MAIN_ID}`, width, '');
}
