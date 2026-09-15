import type {Theme} from '@earendil-works/pi-coding-agent';
import {getSettingsListTheme} from '@earendil-works/pi-coding-agent';
import {isRtkCancellation, type RtkRuntime} from './runtime';
import {dataRow, ReportPager, RTK_BODY_ROWS} from './display';
import {
  boundedReportLines,
  clean,
  decodeUsageReport,
  formatCount,
  formatDuration,
  formatPercent,
  formatTokens,
  GAIN_VIEWS,
  reportArgs,
  type HistoryEntry,
  type PeriodView,
  type Summary,
  type UsageScope,
  type UsageLoadOutcome,
  type UsageSnapshot,
  type UsageViewKind,
  type PeriodRow,
} from './report';
import {
  visibleWidth,
  wrapTextWithAnsi,
  SettingsList,
  type Component,
  type SettingItem,
} from '@earendil-works/pi-tui';

export type {UsageScope, UsageViewKind} from './report';

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
  private readonly pager = new ReportPager();
  private readonly settings: SettingsList;

  constructor(
    private readonly theme: Theme,
    private readonly runtime: RtkRuntime,
    private readonly cwd: string,
    private readonly onCancel: () => void,
    private readonly requestRender: () => void,
    private readonly notifyError: (message: string) => void,
  ) {
    const items: SettingItem[] = [
      {
        id: 'scope',
        label: 'Scope',
        description: 'Global statistics or this working directory.',
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
    this.pager.reset();
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
    if (this.pager.handleInput(data)) {
      this.requestRender();
      return;
    }
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
    const controls = [
      '',
      this.theme.bold('Display'),
      ...this.settings.render(width),
    ];
    return [
      ...this.pager.render(
        lines,
        width,
        RTK_BODY_ROWS - controls.length,
        this.theme,
      ),
      ...controls,
    ];
  }

  invalidate(): void {
    this.settings.invalidate();
  }

  private async load(
    requestNumber: number,
    controller: AbortController,
  ): Promise<void> {
    try {
      const result = await this.runtime.execute(
        reportArgs(this.view, this.scope),
        this.cwd,
        controller.signal,
      );
      if (!this.isCurrent(requestNumber, controller)) return;
      const outcome: UsageLoadOutcome = await decodeUsageReport(
        this.view,
        result.stdout,
        result.stderr,
        result.code,
      );
      if (!this.isCurrent(requestNumber, controller)) return;
      this.applyOutcome(outcome, requestNumber, controller);
    } catch (error) {
      if (!this.isCurrent(requestNumber, controller)) return;
      if (error instanceof Error && isRtkCancellation(error)) return;
      this.applyOutcome(
        {
          state: 'failure',
          message:
            error instanceof Error
              ? clean(error.message)
              : 'RTK usage read failed.',
        },
        requestNumber,
        controller,
      );
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
    outcome: UsageLoadOutcome,
    requestNumber: number,
    controller: AbortController,
  ): void {
    if (!this.isCurrent(requestNumber, controller)) return;
    this.state = outcome.state;
    this.snapshot = outcome.state === 'ready' ? outcome.snapshot : undefined;
    this.pager.reset();
    this.errorMessage =
      outcome.state === 'unsupported' || outcome.state === 'failure'
        ? outcome.message
        : '';
    this.pending = undefined;
    if (outcome.state === 'unsupported' || outcome.state === 'failure')
      this.notifyError(outcome.message);
    this.requestRender();
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
        'Before RTK',
        formatTokens(summary.total_input),
        width,
      ),
      dataRow(
        this.theme,
        'After RTK',
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
          'Estimated output tokens. Excludes ANSI cleanup, billing and Pi session usage.',
        ),
        width,
      ),
    ];
  }

  private periodLines(
    view: PeriodView,
    periods: readonly PeriodRow[],
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
    const lines = [
      this.theme.bold(`${view} savings`),
      this.theme.fg(
        'muted',
        `${prefix}${labelHeader.padEnd(labelWidth)}${separator}${rightHeader}`,
      ),
    ];
    for (const period of periods) {
      const right = `${formatCount(period.commands).padStart(8)}  ${formatTokens(period.saved_tokens).padStart(7)}  ${formatPercent(period.savings_pct).padStart(6)}`;
      const labels = wrapTextWithAnsi(period.label, labelWidth);
      for (const [index, label] of labels.entries())
        lines.push(
          `${prefix}${label.padEnd(labelWidth)}${separator}${index === 0 ? right : ''}`,
        );
    }
    return lines;
  }

  private historyLines(
    entries: readonly HistoryEntry[],
    width: number,
  ): string[] {
    const timeWidth = Math.max(
      4,
      ...entries.map(entry => visibleWidth(entry.time)),
    );
    const prefix = `  ${'Time'.padEnd(timeWidth)}  `;
    const separator = '  ';
    const rightHeader = `${'Saved'.padStart(7)}  ${'Rate'.padStart(6)}`;
    const commandWidth = Math.max(
      1,
      width -
        visibleWidth(prefix) -
        visibleWidth(rightHeader) -
        visibleWidth(separator),
    );
    const lines = [
      this.theme.bold('Recent commands'),
      this.theme.fg(
        'muted',
        `${prefix}${'Command'.padEnd(commandWidth)}${separator}${rightHeader}`,
      ),
    ];
    for (const entry of entries) {
      const right = `${entry.saved.padStart(7)}  ${formatPercent(entry.rate).padStart(6)}`;
      const prefix = `  ${entry.time.padEnd(timeWidth)}  `;
      const separator = '  ';
      const entryCommandWidth = Math.max(
        1,
        width -
          visibleWidth(prefix) -
          visibleWidth(right) -
          visibleWidth(separator),
      );
      const commandLines = wrapTextWithAnsi(entry.command, entryCommandWidth);
      for (const [index, command] of commandLines.entries())
        lines.push(
          `${index === 0 ? prefix : ' '.repeat(visibleWidth(prefix))}${command}${' '.repeat(Math.max(0, entryCommandWidth - visibleWidth(command)))}${separator}${index === 0 ? right : ''}`,
        );
    }
    return lines;
  }

  private failureLines(text: string, width: number): string[] {
    return [
      this.theme.bold('Parse failures'),
      this.theme.fg('muted', 'Global · native RTK report · scope fixed'),
      ...boundedReportLines(text).flatMap(line =>
        wrapTextWithAnsi(this.theme.fg('muted', line), width - 2).map(
          part => `  ${part}`,
        ),
      ),
    ];
  }

  private clearSnapshot(): void {
    this.snapshot = undefined;
    this.state = 'idle';
    this.errorMessage = '';
    this.pager.reset();
  }
}
