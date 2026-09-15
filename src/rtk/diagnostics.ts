import type {Theme} from '@earendil-works/pi-coding-agent';
import {
  matchesKey,
  truncateToWidth,
  type Component,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import {stripVTControlCharacters} from 'node:util';
import {dataRow, ReportPager, RTK_BODY_ROWS} from './display';
import {
  isRtkCancellation,
  type RtkProbeResult,
  type RtkRuntime,
} from './runtime';

type DiagnosticsState = 'idle' | 'loading' | 'ready' | 'failure';

interface DiagnosticsSnapshot {
  readonly probe: RtkProbeResult | undefined;
  readonly config: string | undefined;
  readonly integrationFailure: string | undefined;
}

const MAX_CONFIG_CHARS = 32 * 1024;
const MAX_ERROR_CHARS = 2 * 1024;

function clean(text: string): string {
  return stripVTControlCharacters(text);
}

function bounded(text: string, limit: number, marker: string): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n${marker}`;
}

function errorText(error: Error): string {
  const message = clean(error.message).trim();
  return message === '' ? 'RTK diagnostics read failed.' : message;
}

export class DiagnosticsView implements Component {
  private state: DiagnosticsState = 'idle';
  private snapshot: DiagnosticsSnapshot | undefined;
  private errorMessage = '';
  private pending: AbortController | undefined;
  private stateBeforeLoading: DiagnosticsState = 'idle';
  private readonly pager = new ReportPager();

  constructor(
    private readonly theme: Theme,
    private readonly runtime: RtkRuntime,
    private readonly cwd: string,
    private readonly onCancel: () => void,
    private readonly requestRender: () => void,
    private readonly notifyError: (message: string) => void,
  ) {}

  refresh(): Promise<void> {
    this.cancelPending();
    const controller = new AbortController();
    const integrationFailure = this.runtime.lastFailure;
    this.pending = controller;
    this.stateBeforeLoading = this.state;
    this.state = 'loading';
    this.pager.reset();
    this.requestRender();
    return this.load(controller, integrationFailure);
  }

  cancelPending(): void {
    this.pending?.abort();
    this.pending = undefined;
    if (this.state === 'loading') this.state = this.stateBeforeLoading;
  }

  dispose(): void {
    this.cancelPending();
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape')) {
      this.cancelPending();
      this.onCancel();
      return;
    }
    if (matchesKey(data, 'r')) {
      void this.refresh();
      return;
    }
    if (this.pager.handleInput(data)) this.requestRender();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.floor(width));
    return [
      ...this.pager.render(
        this.bodyLines(safeWidth),
        safeWidth,
        RTK_BODY_ROWS - 1,
        this.theme,
      ),
      this.theme.fg('dim', 'r Refresh · Esc Back'),
    ];
  }

  invalidate(): void {}

  private async load(
    controller: AbortController,
    integrationFailure: string | undefined,
  ): Promise<void> {
    let probe: RtkProbeResult | undefined;
    try {
      probe = await this.runtime.probe(this.cwd, controller.signal);
      if (!this.isCurrent(controller)) return;
      const result = await this.runtime.execute(
        ['config'],
        this.cwd,
        controller.signal,
      );
      if (!this.isCurrent(controller)) return;
      const config = bounded(
        clean(result.stdout),
        MAX_CONFIG_CHARS,
        '[native config output truncated]',
      );
      this.snapshot = {probe, config, integrationFailure};
      if (result.code !== 0) {
        const stderr = bounded(
          clean(result.stderr).trim(),
          MAX_ERROR_CHARS,
          '[diagnostic error truncated]',
        );
        const detail =
          stderr === ''
            ? `RTK config exited with code ${result.code}.`
            : `RTK config exited with code ${result.code}: ${stderr}`;
        this.fail(`RTK config read failed: ${detail}`, controller);
        return;
      }
      this.state = 'ready';
      this.stateBeforeLoading = 'ready';
      this.errorMessage = '';
      this.pending = undefined;
      this.requestRender();
    } catch (error) {
      if (!this.isCurrent(controller)) return;
      if (error instanceof Error && isRtkCancellation(error)) {
        this.state = this.stateBeforeLoading;
        this.pending = undefined;
        this.requestRender();
        return;
      }
      this.snapshot = {probe, config: undefined, integrationFailure};
      const cause =
        error instanceof Error
          ? errorText(error)
          : 'RTK diagnostics read failed.';
      this.fail(`RTK diagnostics read failed: ${cause}`, controller);
    }
  }

  private fail(message: string, controller: AbortController): void {
    if (!this.isCurrent(controller)) return;
    this.state = 'failure';
    this.stateBeforeLoading = 'failure';
    this.errorMessage = bounded(
      clean(message),
      MAX_ERROR_CHARS,
      '[diagnostic error truncated]',
    );
    this.pending = undefined;
    this.notifyError(this.errorMessage);
    this.requestRender();
  }

  private isCurrent(controller: AbortController): boolean {
    return this.pending === controller && !controller.signal.aborted;
  }

  private bodyLines(width: number): string[] {
    if (this.state === 'loading')
      return [
        this.theme.bold('Refreshing diagnostics'),
        ...wrapTextWithAnsi(
          this.theme.fg(
            'muted',
            'Reading the resolved RTK executable and native config. Esc cancels this read.',
          ),
          width,
        ),
      ];
    if (this.state === 'idle')
      return [
        this.theme.fg('muted', 'No diagnostics loaded.'),
        ...wrapTextWithAnsi(
          this.theme.fg(
            'dim',
            'Press r to read the RTK probe and native config.',
          ),
          width,
        ),
      ];

    const lines: string[] = [];
    if (this.state === 'failure') {
      lines.push(this.theme.fg('error', 'Diagnostics unavailable'));
      lines.push(
        ...wrapTextWithAnsi(this.theme.fg('muted', this.errorMessage), width),
      );
      lines.push('');
    }
    lines.push(this.theme.bold('Resolution'));
    const probe = this.snapshot?.probe;
    lines.push(
      dataRow(
        this.theme,
        'Status',
        probe === undefined ? 'unavailable' : 'available',
        width,
      ),
    );
    if (probe === undefined) {
      lines.push(
        ...this.wrapValue('Probe', 'No executable was resolved.', width),
      );
    } else {
      lines.push(dataRow(this.theme, 'Version', probe.version, width));
      lines.push(dataRow(this.theme, 'Source', probe.source, width));
      lines.push(...this.wrapValue('Executable', probe.path, width));
    }
    lines.push('');
    lines.push(this.theme.bold('Last integration rewrite failure'));
    const failure = this.snapshot?.integrationFailure;
    lines.push(
      ...this.wrapValue(
        '',
        failure === undefined
          ? 'None recorded in this extension lifecycle.'
          : failure,
        width,
        failure === undefined ? 'muted' : 'error',
      ),
    );
    lines.push('');
    lines.push(this.theme.bold('Native RTK config · read only'));
    const config = this.snapshot?.config;
    if (config === undefined || config.trim() === '') {
      lines.push(
        ...this.wrapValue('', 'No native configuration output.', width),
      );
    } else {
      lines.push(...this.wrapValue('', config, width));
    }
    return lines;
  }

  private wrapValue(
    label: string,
    value: string,
    width: number,
    color: 'muted' | 'error' = 'muted',
  ): string[] {
    const prefix = label === '' ? '  ' : `  ${label}: `;
    const continuation =
      label === '' ? '  ' : `  ${' '.repeat(label.length + 2)}`;
    const valueWidth = Math.max(1, width - prefix.length);
    return wrapTextWithAnsi(this.theme.fg(color, value), valueWidth).map(
      (line, index) =>
        truncateToWidth(`${index === 0 ? prefix : continuation}${line}`, width),
    );
  }
}
