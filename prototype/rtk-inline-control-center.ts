/**
 * Throwaway inline RTK control-center prototype refined for issue #83.
 *
 * Pi provides the host, theme, focus, lists, text input and notifications.
 * RTK discovery, statistics and persistence are intentionally simulated.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  Theme,
} from '@earendil-works/pi-coding-agent';
import {
  DynamicBorder,
  getSelectListTheme,
  getSettingsListTheme,
} from '@earendil-works/pi-coding-agent';
import {
  Input,
  matchesKey,
  SelectList,
  SettingsList,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type KeybindingsManager,
  type SelectItem,
  type SettingItem,
  type TUI,
} from '@earendil-works/pi-tui';

type Page = 'integration' | 'savings' | 'diagnostics';
type Scenario = 'normal' | 'loading' | 'empty' | 'failure';
type GainScope = 'Global' | 'Project';
type GainView =
  | 'Overview'
  | 'Daily'
  | 'Weekly'
  | 'Monthly'
  | 'History'
  | 'Failures';
type LoadState = 'ready' | 'loading' | 'failure';

const MIN_COLUMNS = 56;
const MIN_ROWS = 26;
const MAX_DATA_COLUMNS = 72;
const SAMPLE_RTK_PATH = '/opt/mise/installs/rtk/0.45.0/bin/rtk';
const PAGE_ORDER: readonly Page[] = ['integration', 'savings', 'diagnostics'];
const PAGE_LABELS: Readonly<Record<Page, string>> = {
  integration: 'Settings',
  savings: 'Usage',
  diagnostics: 'Diagnostics',
};
const GAIN_VIEWS: readonly GainView[] = [
  'Overview',
  'Daily',
  'Weekly',
  'Monthly',
  'History',
  'Failures',
];
const SAVINGS_SUMMARY = {
  commands: '195,196',
  inputTokens: '3.49B',
  outputTokens: '251.1M',
  savedTokens: '3.24B',
  reduction: '92.8%',
  averageTime: '5.7s',
} as const;

const PERIOD_LABELS: Readonly<
  Record<
    Exclude<GainView, 'Overview' | 'History' | 'Failures'>,
    readonly [string, string]
  >
> = {
  Daily: ['Today', 'Yesterday'],
  Weekly: ['This week', 'Last week'],
  Monthly: ['This month', 'Last month'],
};

function parsePage(value: string): Page | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'integration') return 'integration';
  if (normalized === 'gain' || normalized === 'savings') return 'savings';
  if (normalized === 'diagnostics') return 'diagnostics';
  return undefined;
}

function parseScenario(value: boolean | string | undefined): Scenario {
  if (value === 'loading' || value === 'empty' || value === 'failure') {
    return value;
  }
  return 'normal';
}

function parseGainView(value: string): GainView | undefined {
  if (
    value === 'Overview' ||
    value === 'Daily' ||
    value === 'Weekly' ||
    value === 'Monthly' ||
    value === 'History' ||
    value === 'Failures'
  ) {
    return value;
  }
  return undefined;
}

function wrapMuted(theme: Theme, text: string, width: number): string[] {
  return wrapTextWithAnsi(text, Math.max(12, width)).map(line =>
    theme.fg('muted', line),
  );
}

function alignEdges(left: string, right: string, width: number): string {
  const gap = Math.max(2, width - visibleWidth(left) - visibleWidth(right));
  return truncateToWidth(`${left}${' '.repeat(gap)}${right}`, width, '...');
}

function alignDataEdges(left: string, right: string, width: number): string {
  return alignEdges(left, right, Math.min(width, MAX_DATA_COLUMNS));
}

function dottedRow(
  theme: Theme,
  label: string,
  value: string,
  width: number,
): string {
  const rowWidth = Math.min(width, MAX_DATA_COLUMNS);
  const left = `  ${theme.fg('muted', label)}`;
  const gap = Math.max(2, rowWidth - visibleWidth(left) - visibleWidth(value));
  const leader = gap >= 5 ? ` ${'.'.repeat(gap - 2)} ` : ' '.repeat(gap);
  return truncateToWidth(
    `${left}${theme.fg('dim', leader)}${value}`,
    rowWidth,
    '...',
  );
}

function periodRow(
  theme: Theme,
  period: string,
  commands: string,
  saved: string,
  rate: string,
  width: number,
  highlighted = false,
): string {
  const compact = width < 64;
  const line = `  ${period.padEnd(compact ? 15 : 22)}${commands.padStart(compact ? 8 : 10)}${saved.padStart(compact ? 10 : 12)}${rate.padStart(compact ? 7 : 9)}`;
  const fitted = truncateToWidth(
    line,
    Math.min(width, MAX_DATA_COLUMNS),
    '...',
  );
  return highlighted ? theme.fg('success', fitted) : fitted;
}

class ExecutableEditor implements Component {
  private mode: 'choice' | 'input' = 'choice';
  private readonly choices: SelectList;
  private readonly input: Input;
  private error: string | undefined;

  constructor(
    private readonly theme: Theme,
    currentMode: string,
    currentPath: string,
    private readonly accept: (value: string) => void,
    cancel: () => void,
    private readonly requestRender: () => void,
  ) {
    this.choices = new SelectList(
      [
        {
          value: 'automatic',
          label: 'Automatic discovery',
          description: 'Check PATH, then mise.',
        },
        {
          value: 'custom',
          label: 'Custom executable',
          description: 'Use an absolute path.',
        },
      ],
      2,
      getSelectListTheme(),
      {minPrimaryColumnWidth: 22, maxPrimaryColumnWidth: 22},
    );
    this.choices.setSelectedIndex(currentMode === 'automatic' ? 0 : 1);
    this.choices.onCancel = cancel;
    this.choices.onSelect = item => {
      if (item.value === 'automatic') {
        this.accept('automatic');
        return;
      }
      this.mode = 'input';
      this.input.focused = true;
      this.requestRender();
    };

    this.input = new Input({
      prompt: '> ',
      placeholder: '/absolute/path/to/rtk',
      placeholderStyle: text => this.theme.fg('dim', text),
    });
    this.input.setValue(currentPath);
    this.input.handleInput('\x1b[F');
    this.input.onSubmit = value => this.submitPath(value);
    this.input.onEscape = () => {
      this.mode = 'choice';
      this.input.focused = false;
      this.error = undefined;
      this.requestRender();
    };
  }

  handleInput(data: string) {
    if (this.mode === 'input') {
      this.input.handleInput(data);
    } else {
      this.choices.handleInput(data);
    }
    this.requestRender();
  }

  render(width: number) {
    const lines = [
      this.theme.bold(this.theme.fg('accent', 'RTK executable')),
      '',
    ];
    if (this.mode === 'input') {
      lines.push(this.theme.fg('muted', 'Enter an absolute RTK path.'));
      lines.push(...this.input.render(Math.max(10, width - 2)));
      if (this.error !== undefined) {
        lines.push(this.theme.fg('error', this.error));
      }
      lines.push('', this.theme.fg('dim', 'Enter save · Esc choices'));
    } else {
      lines.push(...this.choices.render(width));
      lines.push(
        '',
        this.theme.fg('dim', '↑↓ Navigate · Enter Select · Esc Back'),
      );
    }
    return lines.map(line => truncateToWidth(line, width, '...'));
  }

  invalidate() {
    this.choices.invalidate();
    this.input.invalidate();
  }

  private submitPath(value: string) {
    const path = value.trim();
    if (!path.startsWith('/')) {
      this.error = 'Use an absolute path beginning with /.';
    } else if (!path.endsWith('/rtk')) {
      this.error = 'The selected file is not an RTK executable.';
    } else {
      this.accept(path);
      return;
    }
    this.requestRender();
  }
}

class IntegrationView implements Component {
  private readonly settings: SettingsList;
  private resolvedBy = 'mise';
  private executablePath = SAMPLE_RTK_PATH;
  editingExecutable = false;

  constructor(
    private readonly theme: Theme,
    onCancel: () => void,
    requestRender: () => void,
    notifySaved: () => void,
  ) {
    const items: SettingItem[] = [
      {
        id: 'rewrite',
        label: 'Command rewrite',
        description:
          'Rewrite supported model-originated Bash commands through RTK.',
        currentValue: 'enabled',
        values: ['enabled', 'disabled'],
      },
      {
        id: 'strip-ansi',
        label: 'ANSI cleanup',
        description:
          'Remove terminal control sequences from final Bash tool results.',
        currentValue: 'enabled',
        values: ['enabled', 'disabled'],
      },
      {
        id: 'executable',
        label: 'Executable',
        description:
          'Automatic discovery checks PATH, then mise. Custom paths must be absolute.',
        currentValue: 'automatic',
        submenu: (currentValue, done) => {
          this.editingExecutable = true;
          const close = (value?: string) => {
            this.editingExecutable = false;
            done(value);
          };
          return new ExecutableEditor(
            this.theme,
            currentValue,
            this.executablePath,
            value => {
              if (value === 'automatic') {
                close(value);
                return;
              }
              this.executablePath = value;
              close('custom');
            },
            () => close(),
            requestRender,
          );
        },
      },
    ];
    const settingsTheme = getSettingsListTheme();
    this.settings = new SettingsList(
      items,
      5,
      {
        ...settingsTheme,
        hint: () =>
          this.theme.fg('dim', '  ↑↓ Navigate · Enter Change · Esc Back'),
      },
      (id, value) => {
        if (id === 'executable') {
          this.resolvedBy = value === 'automatic' ? 'mise' : 'custom';
        }
        notifySaved();
        requestRender();
      },
      onCancel,
    );
  }

  handleInput(data: string) {
    this.settings.handleInput(data);
  }

  render(width: number) {
    if (this.editingExecutable) return this.settings.render(width);
    const lines = [
      alignDataEdges(
        this.theme.bold('Runtime'),
        this.theme.fg('success', 'available'),
        width,
      ),
      dottedRow(this.theme, 'Version', '0.45.0', width),
      dottedRow(this.theme, 'Minimum supported', '0.23.0', width),
      dottedRow(
        this.theme,
        'Resolved by',
        this.theme.fg('accent', this.resolvedBy),
        width,
      ),
      '',
      this.theme.bold('Behavior'),
      ...this.settings.render(width),
    ];
    return lines;
  }

  invalidate() {
    this.settings.invalidate();
  }
}

class SavingsView implements Component {
  private scope: GainScope = 'Global';
  private view: GainView = 'Overview';
  private load: LoadState;
  private readonly settings: SettingsList;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failureAnnounced = false;

  constructor(
    private readonly theme: Theme,
    private readonly scenario: Scenario,
    onCancel: () => void,
    private readonly requestRender: () => void,
    private readonly notifyFailure: () => void,
  ) {
    this.load =
      scenario === 'normal' || scenario === 'empty' ? 'ready' : scenario;
    const items: SettingItem[] = [
      {
        id: 'scope',
        label: 'Scope',
        currentValue: this.scope,
        values: ['Global', 'Project'],
      },
      {
        id: 'view',
        label: 'View',
        currentValue: this.view,
        values: [...GAIN_VIEWS],
      },
    ];
    const settingsTheme = getSettingsListTheme();
    this.settings = new SettingsList(
      items,
      3,
      {
        ...settingsTheme,
        hint: () =>
          this.theme.fg(
            'dim',
            `  ↑↓ Navigate · Enter Change · r ${this.load === 'failure' ? 'Retry' : 'Refresh'} · Esc Back`,
          ),
      },
      (id, value) => this.changeSetting(id, value),
      onCancel,
    );
  }

  handleInput(data: string) {
    this.settings.handleInput(data);
  }

  refresh() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.load = 'loading';
    this.failureAnnounced = false;
    this.requestRender();
    if (this.scenario === 'loading') return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.load = this.scenario === 'failure' ? 'failure' : 'ready';
      this.announceFailure();
      this.requestRender();
    }, 1400);
  }

  cancelPending() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.load === 'loading') this.load = 'ready';
  }

  dispose() {
    this.cancelPending();
  }

  render(width: number) {
    const lines: string[] = [];
    if (this.load === 'loading') {
      lines.push(
        alignDataEdges(
          this.theme.bold('Refreshing savings'),
          this.theme.fg('accent', 'rtk gain'),
          width,
        ),
      );
      lines.push(
        ...wrapMuted(
          this.theme,
          'Reading current savings. Esc cancels this refresh and returns to RTK.',
          width,
        ),
      );
    } else if (this.load === 'failure') {
      lines.push(this.theme.fg('error', 'Savings unavailable'));
      lines.push(
        ...wrapMuted(
          this.theme,
          'rtk gain timed out after 5 seconds. Command rewrite remains enabled.',
          width,
        ),
      );
    } else if (this.scenario === 'empty') {
      lines.push(this.theme.bold('No savings recorded'));
      lines.push(
        ...wrapMuted(
          this.theme,
          'No rewritten commands recorded. Run one, then refresh.',
          width,
        ),
      );
    } else {
      lines.push(...this.gainLines(width));
    }

    lines.push('', this.theme.bold('Display'), ...this.settings.render(width));
    return lines;
  }

  invalidate() {
    this.settings.invalidate();
  }

  announceFailure() {
    if (this.load !== 'failure' || this.failureAnnounced) return;
    this.failureAnnounced = true;
    this.notifyFailure();
  }

  titleStatus() {
    if (this.load === 'loading') return `${this.scope} · refreshing`;
    return `${this.scope} · ${this.view}`;
  }

  rootSummary(width: number) {
    if (this.scenario === 'empty') {
      return wrapMuted(
        this.theme,
        'No rewritten commands recorded yet.',
        width,
      );
    }
    if (this.load === 'loading') {
      return wrapMuted(
        this.theme,
        'Savings refresh pending · command rewrite remains enabled.',
        width,
      );
    }
    if (this.load === 'failure') {
      return wrapTextWithAnsi(
        `${this.theme.fg('error', 'Savings unavailable')} ${this.theme.fg('muted', '· command rewrite remains enabled')}`,
        width,
      );
    }
    return wrapTextWithAnsi(
      `${this.theme.fg('muted', `${SAVINGS_SUMMARY.commands} commands · `)}${this.theme.fg('success', `${SAVINGS_SUMMARY.savedTokens} tokens saved · ${SAVINGS_SUMMARY.reduction} reduction`)}`,
      width,
    );
  }

  private changeSetting(id: string, value: string) {
    if (id === 'scope' && (value === 'Global' || value === 'Project')) {
      this.scope = value;
    }
    const gainView = parseGainView(value);
    if (id === 'view' && gainView !== undefined) this.view = gainView;
    this.refresh();
  }

  private gainLines(width: number): string[] {
    if (this.view === 'History') {
      if (width < 72) {
        return [
          alignDataEdges(
            this.theme.bold('Recent commands'),
            this.theme.fg('muted', this.scope),
            width,
          ),
          '',
          dottedRow(this.theme, '17:51  bun run · fallback', '0%', width),
          dottedRow(this.theme, '16:42  cargo test', '94%', width),
          dottedRow(this.theme, '01:13  grep', '65%', width),
        ];
      }
      return [
        alignDataEdges(
          this.theme.bold('Recent commands'),
          this.theme.fg('muted', this.scope),
          width,
        ),
        '',
        this.theme.fg(
          'muted',
          '  Time   Command                       Input    Saved    Rate',
        ),
        '  17:51  bun run · fallback             18.2k        0      0%',
        '  16:42  cargo test                       170      160     94%',
        '  01:13  grep                            1.5k      965     65%',
      ];
    }
    if (this.view === 'Failures') {
      return [
        alignDataEdges(
          this.theme.bold('Parse failures'),
          this.theme.fg('muted', this.scope),
          width,
        ),
        '',
        dottedRow(this.theme, 'Total', '86,975', width),
        dottedRow(
          this.theme,
          'Recovered',
          this.theme.fg('success', '86,366  99.3%'),
          width,
        ),
        dottedRow(this.theme, 'Uncompressed fallback', '609  0.7%', width),
        '',
        this.theme.bold('Most frequent'),
        dottedRow(this.theme, 'bun run check:fast', '1,073', width),
        dottedRow(this.theme, 'bun run typecheck', '519', width),
      ];
    }
    if (this.view !== 'Overview') {
      const labels = PERIOD_LABELS[this.view];
      return [
        alignDataEdges(
          this.theme.bold(`${this.view} savings`),
          this.theme.fg('muted', this.scope),
          width,
        ),
        '',
        this.theme.fg(
          'muted',
          periodRow(this.theme, 'Period', 'Commands', 'Saved', 'Rate', width),
        ),
        periodRow(
          this.theme,
          labels[0],
          '12,411',
          '184.2M',
          '91.7%',
          width,
          true,
        ),
        periodRow(this.theme, labels[1], '11,908', '176.5M', '90.9%', width),
        this.theme.fg(
          'dim',
          periodRow(this.theme, 'Change', '+503', '+7.7M', '+0.8pp', width),
        ),
      ];
    }
    return [
      alignDataEdges(
        this.theme.bold('Token savings'),
        this.theme.fg('muted', `${SAVINGS_SUMMARY.commands} commands`),
        width,
      ),
      '',
      dottedRow(this.theme, 'Before RTK', SAVINGS_SUMMARY.inputTokens, width),
      dottedRow(this.theme, 'Returned', SAVINGS_SUMMARY.outputTokens, width),
      dottedRow(
        this.theme,
        'Saved',
        this.theme.fg(
          'success',
          `${SAVINGS_SUMMARY.savedTokens}  ${SAVINGS_SUMMARY.reduction}`,
        ),
        width,
      ),
      dottedRow(
        this.theme,
        'Average command',
        SAVINGS_SUMMARY.averageTime,
        width,
      ),
    ];
  }
}

class DiagnosticsView implements Component {
  constructor(private readonly theme: Theme) {}

  render(width: number) {
    return [
      alignDataEdges(
        this.theme.bold('Resolution'),
        this.theme.fg('success', 'available'),
        width,
      ),
      dottedRow(this.theme, 'Source', this.theme.fg('accent', 'mise'), width),
      dottedRow(this.theme, 'Version', '0.45.0', width),
      dottedRow(this.theme, 'Last probe', 'just now', width),
      '',
      this.theme.bold('Executable'),
      ...wrapMuted(this.theme, `  ${SAMPLE_RTK_PATH}`, width),
      '',
      this.theme.bold('Last rewrite failure'),
      this.theme.fg('muted', '  None in this extension lifecycle.'),
      '',
      this.theme.bold('Native RTK config · read only'),
      this.theme.fg('muted', '  $XDG_CONFIG_HOME/rtk/config.toml'),
      dottedRow(this.theme, 'tracking.enabled', 'true', width),
      dottedRow(this.theme, 'display.verbosity', '"normal"', width),
      dottedRow(this.theme, 'telemetry.enabled', 'false', width),
    ];
  }

  invalidate() {}
}

class RtkControlCenter implements Component, Focusable {
  private page: Page;
  private rootSelection: boolean;
  private readonly border: DynamicBorder;
  private readonly sectionList: SelectList;
  private readonly integration: IntegrationView;
  private readonly savings: SavingsView;
  private readonly diagnostics: DiagnosticsView;
  focused = false;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    private readonly done: () => void,
    private readonly notify: (
      message: string,
      type?: 'info' | 'warning' | 'error',
    ) => void,
    scenario: Scenario,
    initialPage: Page | undefined,
  ) {
    this.page = initialPage ?? 'integration';
    this.rootSelection = initialPage === undefined;
    this.border = new DynamicBorder(text =>
      this.theme.fg('borderAccent', text),
    );
    const back = () => this.back();
    const requestRender = () => this.tui.requestRender();
    this.integration = new IntegrationView(
      this.theme,
      back,
      requestRender,
      () => this.notify('RTK setting saved.', 'info'),
    );
    this.savings = new SavingsView(
      this.theme,
      scenario,
      back,
      requestRender,
      () =>
        this.notify(
          'RTK savings unavailable: rtk gain timed out after 5 seconds. Press r to retry.',
          'error',
        ),
    );
    this.diagnostics = new DiagnosticsView(this.theme);

    const sections: SelectItem[] = PAGE_ORDER.map(page => ({
      value: page,
      label: PAGE_LABELS[page],
      description: this.sectionDescription(page),
    }));
    this.sectionList = new SelectList(sections, 3, getSelectListTheme(), {
      minPrimaryColumnWidth: 18,
      maxPrimaryColumnWidth: 18,
    });
    this.sectionList.onSelect = item => {
      const selectedPage = parsePage(item.value);
      if (selectedPage === undefined) return;
      this.page = selectedPage;
      this.rootSelection = false;
      if (selectedPage === 'savings') this.savings.announceFailure();
      this.tui.requestRender();
    };
    this.sectionList.onCancel = this.done;

    if (initialPage === 'savings' && scenario === 'normal') {
      this.savings.refresh();
    }
    if (initialPage === 'savings') this.savings.announceFailure();
  }

  handleInput(data: string) {
    if (this.isTooSmall()) {
      if (this.keybindings.matches(data, 'tui.select.cancel')) this.done();
      return;
    }
    if (this.rootSelection) {
      this.sectionList.handleInput(data);
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, 'r') && this.page === 'savings') {
      this.savings.refresh();
      return;
    }
    if (this.page === 'integration') {
      this.integration.handleInput(data);
    } else if (this.page === 'savings') {
      this.savings.handleInput(data);
    } else if (this.keybindings.matches(data, 'tui.select.cancel')) {
      this.back();
    }
    this.tui.requestRender();
  }

  render(width: number) {
    if (this.isTooSmall()) return this.renderTooSmall(width);
    const innerWidth = Math.max(20, width - 4);
    const showDetailHint = this.page === 'diagnostics';
    const lines = this.rootSelection
      ? [
          this.titleLine('RTK', '✓ v0.45.0', innerWidth),
          '',
          'Configure RTK and inspect usage.',
          ...this.savings.rootSummary(innerWidth),
          '',
          ...this.sectionList.render(innerWidth),
          '',
          this.theme.fg('dim', '↑↓ Navigate · Enter Open · Esc Close'),
        ]
      : [
          this.titleLine(
            `RTK / ${PAGE_LABELS[this.page]}`,
            this.detailStatus(),
            innerWidth,
          ),
          '',
          ...this.renderPage(innerWidth),
          ...(showDetailHint ? ['', this.theme.fg('dim', 'Esc Back')] : []),
        ];
    const border = this.border.render(width)[0] ?? '';
    return [border, ...lines, border];
  }

  invalidate() {
    this.border.invalidate();
    this.sectionList.invalidate();
    this.integration.invalidate();
    this.savings.invalidate();
    this.diagnostics.invalidate();
  }

  dispose() {
    this.savings.dispose();
  }

  private renderPage(width: number) {
    if (this.page === 'integration') return this.integration.render(width);
    if (this.page === 'savings') return this.savings.render(width);
    return this.diagnostics.render(width);
  }

  private renderTooSmall(width: number) {
    const safeWidth = Math.max(12, width);
    const border = this.border.render(safeWidth)[0] ?? '';
    return [
      border,
      this.theme.bold(this.theme.fg('warning', 'RTK needs more room')),
      '',
      ...wrapMuted(
        this.theme,
        `Resize to at least ${MIN_COLUMNS} columns and ${MIN_ROWS} rows.`,
        safeWidth - 2,
      ),
      '',
      this.theme.fg('dim', 'Esc close'),
      border,
    ];
  }

  private titleLine(title: string, status: string, width: number) {
    const left = this.theme.bold(this.theme.fg('accent', title));
    const right = this.theme.fg('muted', status);
    if (width < MAX_DATA_COLUMNS) {
      return `${left}  ${right}`;
    }
    return alignEdges(left, right, width);
  }

  private detailStatus() {
    if (this.page === 'integration') return '✓ v0.45.0';
    if (this.page === 'savings') return this.savings.titleStatus();
    return 'checked just now';
  }

  private back() {
    this.savings.cancelPending();
    this.rootSelection = true;
    this.tui.requestRender();
  }

  private isTooSmall() {
    return (
      this.tui.terminal.columns < MIN_COLUMNS ||
      this.tui.terminal.rows < MIN_ROWS
    );
  }

  private sectionDescription(page: Page) {
    if (page === 'integration') return 'Rewrite, cleanup, executable';
    if (page === 'savings') {
      return 'Totals, periods and history';
    }
    return 'Resolution and configuration';
  }
}

async function openControlCenter(
  ctx: ExtensionCommandContext,
  scenario: Scenario,
  initialPage: Page | undefined,
) {
  if (ctx.mode !== 'tui') {
    ctx.ui.notify('/rtk requires TUI mode', 'error');
    return;
  }
  await ctx.ui.custom<void>(
    (tui, theme, keybindings, done) =>
      new RtkControlCenter(
        tui,
        theme,
        keybindings,
        done,
        (message, type) => ctx.ui.notify(message, type),
        scenario,
        initialPage,
      ),
  );
}

export default function rtkInlineControlCenterPrototype(pi: ExtensionAPI) {
  pi.registerFlag('rtk-prototype-state', {
    description: 'Prototype state: normal, loading, empty or failure',
    type: 'string',
    default: 'normal',
  });
  pi.registerCommand('rtk', {
    description: 'Open RTK settings and usage',
    getArgumentCompletions: prefix => {
      const options = ['integration', 'gain', 'diagnostics', 'refresh', 'help'];
      return options
        .filter(option => option.startsWith(prefix))
        .map(option => ({value: option, label: option}));
    },
    handler: async (args, ctx) => {
      const argument = args.trim().toLowerCase();
      if (argument === 'help') {
        ctx.ui.notify(
          'Usage: /rtk [integration|gain|diagnostics|refresh|help]',
          'info',
        );
        return;
      }
      const initialPage = parsePage(argument);
      if (
        argument !== '' &&
        initialPage === undefined &&
        argument !== 'refresh'
      ) {
        ctx.ui.notify(
          'Usage: /rtk [integration|gain|diagnostics|refresh|help]',
          'error',
        );
        return;
      }
      await openControlCenter(
        ctx,
        parseScenario(pi.getFlag('rtk-prototype-state')),
        argument === 'refresh' ? 'savings' : initialPage,
      );
    },
  });
}
