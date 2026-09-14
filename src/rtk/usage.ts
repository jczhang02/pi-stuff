import type {Theme} from '@earendil-works/pi-coding-agent';
import {getSettingsListTheme} from '@earendil-works/pi-coding-agent';
import {isRtkCancellation, type RtkRuntime} from './runtime';
import {dataRow} from './display';
import {
  boundedReportLines,
  clean,
  decodeGainReport,
  formatCount,
  formatDuration,
  formatPercent,
  formatTokens,
  GAIN_VIEWS,
  PERIOD_FIELDS,
  parseFailures,
  parseHistory,
  periodLabel,
  periodName,
  reportArgs,
  type DayStats,
  type HistoryEntry,
  type MonthStats,
  type PeriodView,
  type Summary,
  type UsageScope,
  type UsageViewKind,
  type WeekStats,
  validPeriod,
  validSummary,
} from './report';
import {
  Key,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  matchesKey,
  SettingsList,
  type Component,
  type SettingItem,
} from '@earendil-works/pi-tui';

export type {UsageScope, UsageViewKind} from './report';

type UsageSnapshot =
  | {readonly kind: 'summary'; readonly summary: Summary}
  | {
      readonly kind: 'period';
      readonly view: PeriodView;
      readonly summary: Summary;
      readonly periods: readonly (DayStats | WeekStats | MonthStats)[];
    }
  | {readonly kind: 'history'; readonly history: readonly HistoryEntry[]}
  | {readonly kind: 'failures'; readonly failuresText: string};

type LoadOutcome =
  | {readonly state: 'ready'; readonly snapshot: UsageSnapshot}
  | {readonly state: 'empty'}
  | {readonly state: 'unsupported'; readonly message: string}
  | {readonly state: 'failure'; readonly message: string};

type LoadState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'unsupported'
  | 'failure';

export class UsageView implements Component {
  private scope: UsageScope = 'Global';
  private view: UsageViewKind = 'Overview';
  private state: LoadState = 'idle';
  private snapshot: UsageSnapshot | undefined;
  private errorMessage = '';
  private pending: AbortController | undefined;
  private requestNumber = 0;
  private savedScope: UsageScope | undefined;
  private failureOffset = 0;
  private readonly settings: SettingsList;

  constructor(
    private readonly theme: Theme,
    private readonly runtime: RtkRuntime,
    private readonly cwd: string,
    private readonly onCancel: () => void,
    private readonly requestRender: () => void,
    private readonly notifyError: (message: string) => void,
    private readonly availableRows: () => number,
  ) {
    const items: SettingItem[] = [
      {
        id: 'scope',
        label: 'Scope',
        description: 'Global RTK statistics or the current working directory.',
        currentValue: this.scope,
        values: ['Global', 'Project'],
      },
      {
        id: 'view',
        label: 'View',
        description: 'Native RTK gain report.',
        currentValue: this.view,
        values: [...GAIN_VIEWS],
      },
    ];
    this.settings = new SettingsList(
      items,
      3,
      {
        ...getSettingsListTheme(),
        hint: () =>
          this.theme.fg(
            'dim',
            `  ↑↓ Navigate · Enter Change · r ${this.state === 'failure' ? 'Retry' : 'Refresh'} · Esc Back`,
          ),
      },
      (id, value) => this.changeSetting(id, value),
      this.onCancel,
    );
  }

  refresh(): Promise<void> {
    this.cancelPending();
    const requestNumber = ++this.requestNumber;
    const controller = new AbortController();
    this.pending = controller;
    this.state = 'loading';
    this.errorMessage = '';
    this.requestRender();
    return this.load(requestNumber, controller);
  }

  cancelPending(): void {
    this.requestNumber++;
    this.pending?.abort();
    this.pending = undefined;
    if (this.state === 'loading')
      this.state = this.snapshot === undefined ? 'idle' : 'ready';
  }

  dispose(): void {
    this.cancelPending();
  }

  resetSource(): void {
    this.cancelPending();
    this.clearSnapshot();
    this.requestRender();
  }

  titleStatus(): string {
    const scope = this.view === 'Failures' ? 'Global' : this.scope;
    if (this.state === 'loading') return `${scope} · refreshing`;
    if (this.state === 'failure') return `${scope} · unavailable`;
    if (this.state === 'unsupported') return `${scope} · unsupported`;
    if (this.state === 'empty') return `${scope} · empty`;
    return `${scope} · ${this.view}`;
  }

  rootSummary(width: number): string[] {
    if (this.state === 'loading')
      return wrapTextWithAnsi(
        this.theme.fg(
          'muted',
          'Reading native RTK usage. Command rewrite remains independent.',
        ),
        width,
      );
    if (this.state === 'failure')
      return wrapTextWithAnsi(
        `${this.theme.fg('error', 'Usage unavailable')} ${this.theme.fg('muted', '· retry with r')}`,
        width,
      );
    if (this.state === 'unsupported')
      return wrapTextWithAnsi(
        `${this.theme.fg('warning', 'Usage report unsupported')} ${this.theme.fg('muted', '· retry with r')}`,
        width,
      );
    if (this.state === 'empty')
      return wrapTextWithAnsi(
        this.theme.fg('muted', 'No native RTK usage recorded for this view.'),
        width,
      );
    const snapshot = this.snapshot;
    if (snapshot?.kind === 'summary' || snapshot?.kind === 'period') {
      const summary = snapshot.summary;
      return wrapTextWithAnsi(
        `${this.theme.fg('muted', `${formatCount(summary.total_commands)} commands · `)}${this.theme.fg('success', `${formatTokens(summary.total_saved)} tokens saved · ${formatPercent(summary.avg_savings_pct)} reduction`)}`,
        width,
      );
    }
    if (snapshot?.kind === 'history')
      return wrapTextWithAnsi(
        this.theme.fg(
          'muted',
          `${snapshot.history.length} recent native commands · ${this.view}`,
        ),
        width,
      );
    if (snapshot?.kind === 'failures')
      return wrapTextWithAnsi(
        this.theme.fg(
          'muted',
          'Native parse-failure report loaded · Global scope',
        ),
        width,
      );
    return wrapTextWithAnsi(
      this.theme.fg('muted', 'No native RTK usage report loaded.'),
      width,
    );
  }

  handleInput(data: string): void {
    if (data === 'r') {
      void this.refresh();
      return;
    }
    if (this.view === 'Failures' && this.scrollFailures(data)) return;
    this.settings.handleInput(data);
  }

  render(width: number): string[] {
    const lines: string[] = [];
    if (this.state === 'loading') {
      lines.push(this.theme.bold('Refreshing usage'));
      lines.push(
        ...wrapTextWithAnsi(
          'Reading a bounded native RTK report. Esc cancels this refresh and returns to RTK.',
          width,
        ),
      );
    } else if (this.state === 'failure') {
      lines.push(this.theme.fg('error', 'Usage unavailable'));
      lines.push(...wrapTextWithAnsi(this.errorMessage, width));
    } else if (this.state === 'unsupported') {
      lines.push(this.theme.fg('warning', 'Usage report unsupported'));
      lines.push(...wrapTextWithAnsi(this.errorMessage, width));
    } else if (this.state === 'empty') {
      lines.push(this.theme.bold(this.emptyTitle()));
      lines.push(...wrapTextWithAnsi(this.emptyDescription(), width));
    } else if (this.snapshot !== undefined) {
      lines.push(...this.snapshotLines(width));
    } else {
      lines.push(this.theme.fg('muted', 'No native RTK usage report loaded.'));
    }
    lines.push('', this.theme.bold('Display'), ...this.settings.render(width));
    return lines;
  }

  invalidate(): void {
    this.settings.invalidate();
  }

  private async load(
    requestNumber: number,
    controller: AbortController,
  ): Promise<void> {
    let outcome: LoadOutcome | undefined;
    try {
      const result = await this.runtime.execute(
        reportArgs(this.view, this.scope),
        this.cwd,
        controller.signal,
      );
      if (!this.isCurrent(requestNumber, controller)) return;
      const stdout = clean(result.stdout);
      const stderr = clean(result.stderr);
      if (result.code !== 0) {
        outcome = {
          state: 'failure',
          message: `RTK ${this.view.toLowerCase()} read failed${stderr.trim() === '' ? '.' : `: ${stderr.trim().replace(/\s+/gu, ' ').slice(0, 200)}`}`,
        };
        return;
      }
      if (this.view === 'History') {
        const parsed = parseHistory(stdout);
        if (parsed === 'empty') {
          outcome = {state: 'empty'};
          return;
        }
        if (parsed === undefined) {
          outcome = {
            state: 'unsupported',
            message: 'RTK returned an unsupported history report.',
          };
          return;
        }
        outcome = {
          state: 'ready',
          snapshot: {kind: 'history', history: parsed},
        };
        return;
      }
      if (this.view === 'Failures') {
        const parsed = parseFailures(stdout);
        if (parsed === 'empty') {
          outcome = {state: 'empty'};
          return;
        }
        if (parsed === undefined) {
          outcome = {
            state: 'unsupported',
            message: 'RTK returned an unsupported parse-failure report.',
          };
          return;
        }
        outcome = {
          state: 'ready',
          snapshot: {kind: 'failures', failuresText: parsed},
        };
        return;
      }
      const report = await decodeGainReport(stdout);
      if (!this.isCurrent(requestNumber, controller)) return;
      if (report === undefined || !validSummary(report.summary)) {
        outcome = {
          state: 'unsupported',
          message: 'RTK returned an unsupported JSON usage report.',
        };
        return;
      }
      const period = periodName(this.view);
      const periods =
        period === undefined ? undefined : report[PERIOD_FIELDS[period]];
      if (period !== undefined && periods === undefined) {
        outcome = {
          state: 'unsupported',
          message: `RTK did not provide a native ${this.view.toLowerCase()} JSON report.`,
        };
        return;
      }
      if (periods !== undefined && periods.some(stats => !validPeriod(stats))) {
        outcome = {
          state: 'unsupported',
          message: `RTK returned malformed ${this.view.toLowerCase()} statistics.`,
        };
        return;
      }
      if (
        (periods !== undefined && periods.length === 0) ||
        (period === undefined && report.summary.total_commands === 0)
      ) {
        outcome = {state: 'empty'};
        return;
      }
      if (period === undefined) {
        outcome = {
          state: 'ready',
          snapshot: {kind: 'summary', summary: report.summary},
        };
      } else if (periods !== undefined) {
        outcome = {
          state: 'ready',
          snapshot: {
            kind: 'period',
            view: period,
            summary: report.summary,
            periods,
          },
        };
      } else {
        outcome = {
          state: 'unsupported',
          message: `RTK did not provide a native ${this.view.toLowerCase()} JSON report.`,
        };
        return;
      }
    } catch (error) {
      if (!this.isCurrent(requestNumber, controller)) return;
      if (error instanceof Error && isRtkCancellation(error)) return;
      outcome = {
        state: 'failure',
        message: clean(
          error instanceof Error ? error.message : 'RTK usage read failed.',
        ),
      };
    } finally {
      if (outcome !== undefined)
        this.applyOutcome(outcome, requestNumber, controller);
    }
  }

  private isCurrent(
    requestNumber: number,
    controller: AbortController,
  ): boolean {
    return (
      this.requestNumber === requestNumber &&
      this.pending === controller &&
      !controller.signal.aborted
    );
  }

  private applyOutcome(
    outcome: LoadOutcome,
    requestNumber: number,
    controller: AbortController,
  ): void {
    if (!this.isCurrent(requestNumber, controller)) return;
    this.state = outcome.state;
    this.snapshot = outcome.state === 'ready' ? outcome.snapshot : undefined;
    if (outcome.state === 'ready' && outcome.snapshot.kind === 'failures')
      this.failureOffset = 0;
    this.errorMessage =
      outcome.state === 'unsupported' || outcome.state === 'failure'
        ? outcome.message
        : '';
    this.pending = undefined;
    if (outcome.state === 'unsupported' || outcome.state === 'failure')
      this.notifyError(outcome.message);
    this.requestRender();
  }

  private scrollFailures(data: string): boolean {
    const snapshot = this.snapshot;
    if (snapshot?.kind !== 'failures') return false;
    const report = snapshot.failuresText;
    const lineCount = boundedReportLines(report).length;
    const visibleRows = this.reportRows();
    const maxOffset = Math.max(0, lineCount - visibleRows);
    if (maxOffset === 0) return false;
    if (
      matchesKey(data, Key.pageUp) ||
      matchesKey(data, Key.ctrl('u')) ||
      matchesKey(data, Key.leftbracket)
    ) {
      this.failureOffset = Math.max(0, this.failureOffset - visibleRows);
      this.requestRender();
      return true;
    }
    if (
      matchesKey(data, Key.pageDown) ||
      matchesKey(data, Key.ctrl('d')) ||
      matchesKey(data, Key.rightbracket)
    ) {
      this.failureOffset = Math.min(
        maxOffset,
        this.failureOffset + visibleRows,
      );
      this.requestRender();
      return true;
    }
    return false;
  }

  private changeSetting(id: string, value: string): void {
    let changed = false;
    if (id === 'scope') {
      if (this.view === 'Failures') {
        this.settings.updateValue('scope', 'Global');
        return;
      }
      if ((value === 'Global' || value === 'Project') && value !== this.scope) {
        this.scope = value;
        changed = true;
      }
    }
    const nextView = GAIN_VIEWS.find(candidate => candidate === value);
    if (id === 'view' && nextView !== undefined && nextView !== this.view) {
      if (nextView === 'Failures' && this.view !== 'Failures') {
        this.savedScope = this.scope;
        this.scope = 'Global';
        this.failureOffset = 0;
        this.settings.updateValue('scope', 'Global');
      } else if (this.view === 'Failures' && nextView !== 'Failures') {
        this.scope = this.savedScope ?? 'Global';
        this.savedScope = undefined;
        this.settings.updateValue('scope', this.scope);
      }
      this.view = nextView;
      changed = true;
    }
    if (changed) this.clearSnapshot();
    void this.refresh();
  }

  private emptyTitle(): string {
    if (this.view === 'Failures') return 'No parse failures recorded';
    if (this.view === 'History') return 'No recent commands recorded';
    if (this.view === 'Overview') return 'No usage recorded';
    return `No ${this.view.toLowerCase()} usage recorded`;
  }

  private emptyDescription(): string {
    if (this.view === 'Failures')
      return 'Global RTK reports no parser or fallback failures.';
    return `RTK returned no native data for ${this.view.toLowerCase()} in ${this.scope} scope. This is an empty report, not zeroed statistics.`;
  }

  private snapshotLines(width: number): string[] {
    const snapshot = this.snapshot;
    if (snapshot === undefined) return [];
    switch (snapshot.kind) {
      case 'summary':
        return this.summaryLines(snapshot.summary, width);
      case 'period':
        return this.periodLines(snapshot.view, snapshot.periods, width);
      case 'history':
        return this.historyLines(snapshot.history, width);
      case 'failures':
        return this.failureLines(snapshot.failuresText, width);
    }
  }

  private summaryLines(summary: Summary, width: number): string[] {
    return [
      dataRow(
        this.theme,
        'Total commands',
        formatCount(summary.total_commands),
        width,
      ),
      dataRow(
        this.theme,
        'Input tokens',
        formatTokens(summary.total_input),
        width,
      ),
      dataRow(
        this.theme,
        'Output tokens',
        formatTokens(summary.total_output),
        width,
      ),
      dataRow(
        this.theme,
        'Tokens saved',
        this.theme.fg(
          'success',
          `${formatTokens(summary.total_saved)}  ${formatPercent(summary.avg_savings_pct)}`,
        ),
        width,
      ),
      dataRow(
        this.theme,
        'Total exec time',
        `${formatDuration(summary.total_time_ms)} (avg ${formatDuration(summary.avg_time_ms)})`,
        width,
      ),
      '',
      ...wrapTextWithAnsi(
        this.theme.fg(
          'dim',
          'Estimated RTK token savings only; excludes ANSI-cleanup savings, billing, and Pi usage.',
        ),
        width,
      ),
    ];
  }

  private periodLines(
    view: PeriodView,
    periods: readonly (DayStats | WeekStats | MonthStats)[],
    width: number,
  ): string[] {
    const prefix = '  ';
    const separator = '  ';
    const rightHeader = `${'Commands'.padStart(8)}  ${'Saved'.padStart(7)}  ${'Rate'.padStart(6)}`;
    const labelWidth = Math.max(
      1,
      width -
        visibleWidth(prefix) -
        visibleWidth(rightHeader) -
        visibleWidth(separator),
    );
    const labelHeader =
      view === 'Daily' ? 'Date' : view === 'Weekly' ? 'Week' : 'Month';
    const visiblePeriods = periods.slice(-this.reportRows());
    const title =
      visiblePeriods.length === periods.length
        ? `${view} savings`
        : `${view} savings (showing ${visiblePeriods.length} of ${periods.length})`;
    const lines = [
      this.theme.bold(title),
      this.theme.fg(
        'muted',
        `${prefix}${labelHeader.padEnd(labelWidth)}${separator}${rightHeader}`,
      ),
    ];
    for (const period of visiblePeriods) {
      const right = `${formatCount(period.commands).padStart(8)}  ${formatTokens(period.saved_tokens).padStart(7)}  ${formatPercent(period.savings_pct).padStart(6)}`;
      const label = truncateToWidth(
        periodLabel(view, period),
        labelWidth,
        '...',
      ).padEnd(labelWidth);
      lines.push(`${prefix}${label}${separator}${right}`);
    }
    return lines;
  }

  private historyLines(
    entries: readonly HistoryEntry[],
    width: number,
  ): string[] {
    const prefix = `  ${'Time'.padEnd(21)}`;
    const separator = '  ';
    const rightHeader = `${'Saved'.padStart(7)}  ${'Rate'.padStart(6)}`;
    const commandWidth = Math.max(
      1,
      width -
        visibleWidth(prefix) -
        visibleWidth(rightHeader) -
        visibleWidth(separator),
    );
    const visibleEntries = entries.slice(0, this.reportRows());
    const title =
      visibleEntries.length === entries.length
        ? 'Recent commands'
        : `Recent commands (showing ${visibleEntries.length} of ${entries.length})`;
    const lines = [
      this.theme.bold(title),
      this.theme.fg(
        'muted',
        `${prefix}${'Command'.padEnd(commandWidth)}${separator}${rightHeader}`,
      ),
    ];
    for (const entry of visibleEntries) {
      const right = `${entry.saved.padStart(7)}  ${formatPercent(entry.rate).padStart(6)}`;
      const prefix = `  ${entry.time.padEnd(21)}`;
      const separator = '  ';
      const entryCommandWidth = Math.max(
        1,
        width -
          visibleWidth(prefix) -
          visibleWidth(right) -
          visibleWidth(separator),
      );
      const command = truncateToWidth(
        entry.command,
        entryCommandWidth,
        '...',
      ).padEnd(entryCommandWidth);
      lines.push(`${prefix}${command}${separator}${right}`);
    }
    return lines;
  }

  private failureLines(text: string, width: number): string[] {
    const reportLines = boundedReportLines(text);
    const visibleRows = this.reportRows();
    const maxOffset = Math.max(0, reportLines.length - visibleRows);
    this.failureOffset = Math.min(this.failureOffset, maxOffset);
    const window = reportLines.slice(
      this.failureOffset,
      this.failureOffset + visibleRows,
    );
    const indicators: string[] = [];
    if (this.failureOffset > 0)
      indicators.push(
        this.theme.fg('dim', '  ↑ PageUp for earlier report lines · [ also'),
      );
    if (this.failureOffset < maxOffset)
      indicators.push(
        this.theme.fg('dim', '  ↓ PageDown for later report lines · ] also'),
      );
    return [
      this.theme.bold('Parse failures'),
      this.theme.fg('muted', 'Global · native RTK report · scope fixed'),
      ...indicators,
      ...window.map(line =>
        truncateToWidth(this.theme.fg('muted', `  ${line}`), width, '...'),
      ),
    ];
  }

  private reportRows(): number {
    return Math.max(1, Math.floor(this.availableRows()) - 8);
  }

  private clearSnapshot(): void {
    this.snapshot = undefined;
    this.state = 'idle';
    this.errorMessage = '';
    this.failureOffset = 0;
  }
}
