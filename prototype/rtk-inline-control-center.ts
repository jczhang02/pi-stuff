/**
 * Throwaway inline RTK control-center prototype for issue #82.
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
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type KeybindingsManager,
  type SelectItem,
  type SettingItem,
  type TUI,
} from '@earendil-works/pi-tui';

type Page = 'integration' | 'savings' | 'diagnostics';
type Scenario = 'normal' | 'loading' | 'failure';
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
const SAMPLE_RTK_PATH = '/opt/mise/installs/rtk/0.45.0/bin/rtk';
const PAGE_ORDER: readonly Page[] = ['integration', 'savings', 'diagnostics'];
const PAGE_LABELS: Readonly<Record<Page, string>> = {
  integration: 'Integration',
  savings: 'Savings',
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

function parsePage(value: string): Page | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'integration') return 'integration';
  if (normalized === 'gain' || normalized === 'savings') return 'savings';
  if (normalized === 'diagnostics') return 'diagnostics';
  return undefined;
}

function parseScenario(value: boolean | string | undefined): Scenario {
  if (value === 'loading' || value === 'failure') return value;
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

class ExecutableEditor implements Component {
  private mode: 'choice' | 'input' = 'choice';
  private readonly choices: SelectList;
  private readonly input: Input;
  private error: string | undefined;

  constructor(
    private readonly theme: Theme,
    currentValue: string,
    private readonly accept: (value: string) => void,
    cancel: () => void,
    private readonly requestRender: () => void,
  ) {
    this.choices = new SelectList(
      [
        {
          value: 'automatic',
          label: 'Automatic discovery',
          description: 'Resolve from PATH, then mise.',
        },
        {
          value: 'custom',
          label: 'Custom executable',
          description: 'Use an absolute path selected by the user.',
        },
      ],
      2,
      getSelectListTheme(),
    );
    this.choices.setSelectedIndex(currentValue === 'automatic' ? 0 : 1);
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
    this.input.setValue(
      currentValue === 'automatic' ? SAMPLE_RTK_PATH : currentValue,
    );
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
        description: 'Automatic discovery checks PATH first, then mise.',
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
            value => close(value),
            () => close(),
            requestRender,
          );
        },
      },
    ];
    this.settings = new SettingsList(
      items,
      5,
      getSettingsListTheme(),
      (_id, _value) => {
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
      this.theme.bold('Runtime'),
      `  Status       ${this.theme.fg('success', 'available')}`,
      `  Version      0.45.0 ${this.theme.fg('muted', '(minimum 0.23.0)')}`,
      `  Resolved by  ${this.theme.fg('accent', 'mise')}`,
      '',
      this.theme.bold('Settings'),
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
    this.load = scenario === 'normal' ? 'ready' : scenario;
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
    this.settings = new SettingsList(
      items,
      3,
      getSettingsListTheme(),
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
    const lines = [...this.settings.render(width), ''];
    if (this.load === 'loading') {
      lines.push(this.theme.fg('accent', 'Loading RTK savings...'));
      lines.push(
        ...wrapMuted(
          this.theme,
          `Reading ${this.scope.toLowerCase()} ${this.view.toLowerCase()} data. Esc cancels and returns.`,
          width,
        ),
      );
      return lines;
    }
    if (this.load === 'failure') {
      lines.push(this.theme.fg('error', 'Savings unavailable'));
      lines.push(
        ...wrapMuted(
          this.theme,
          'rtk gain exceeded the 5 second read timeout. Rewrite remains enabled.',
          width,
        ),
      );
      lines.push(this.theme.fg('dim', 'Press r to retry.'));
      return lines;
    }
    lines.push(...this.gainLines());
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

  private changeSetting(id: string, value: string) {
    if (id === 'scope' && (value === 'Global' || value === 'Project')) {
      this.scope = value;
    }
    const gainView = parseGainView(value);
    if (id === 'view' && gainView !== undefined) this.view = gainView;
    this.refresh();
  }

  private gainLines(): string[] {
    if (this.view === 'History') {
      return [
        this.theme.bold(`${this.scope} · Recent commands`),
        '',
        '  17:51  rtk fallback: bun run      0%       0',
        '  16:42  rtk cargo test            94%     160',
        '  01:13  rtk grep                  65%     965',
      ];
    }
    if (this.view === 'Failures') {
      return [
        this.theme.bold(`${this.scope} · Parse failures`),
        '',
        '  Total failures   86,975',
        `  Recovery rate    ${this.theme.fg('success', '99.3%')}`,
        '',
        '  1,073x  bun run check:fast',
        '    519x  bun run typecheck',
      ];
    }
    if (this.view !== 'Overview') {
      return [
        this.theme.bold(`${this.scope} · ${this.view}`),
        '',
        '  Period          Commands      Saved      Rate',
        '  ───────────────────────────────────────────',
        `  Current         12,411        184.2M     ${this.theme.fg('success', '91.7%')}`,
        '  Previous        11,908        176.5M     90.9%',
      ];
    }
    return [
      this.theme.bold(`${this.scope} savings`),
      '',
      `  Commands       ${this.theme.bold('195,196')}`,
      '  Input tokens   3.49B',
      '  Output tokens  251.1M',
      `  Tokens saved   ${this.theme.fg('success', '3.24B  92.8%')}`,
      '  Average time   5.7s',
      '',
      this.theme.fg('success', '  ██████████████████████░░  92.8%'),
    ];
  }
}

class DiagnosticsView implements Component {
  constructor(private readonly theme: Theme) {}

  render(width: number) {
    return [
      this.theme.bold('Resolution'),
      `  Status       ${this.theme.fg('success', 'available')}`,
      '  Source       mise',
      '  Version      0.45.0',
      '  Last probe   just now',
      '',
      this.theme.bold('Executable'),
      ...wrapMuted(this.theme, `  ${SAMPLE_RTK_PATH}`, width),
      '',
      this.theme.bold('Last rewrite failure'),
      this.theme.fg('muted', '  None in this extension lifecycle.'),
      '',
      this.theme.bold('Native RTK config · read only'),
      this.theme.fg('muted', '  $XDG_CONFIG_HOME/rtk/config.toml'),
      '  tracking.enabled = true',
      '  display.verbosity = "normal"',
      '  telemetry.enabled = false',
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
      () => this.notify('RTK integration setting saved.', 'info'),
    );
    this.savings = new SavingsView(
      this.theme,
      scenario,
      back,
      requestRender,
      () =>
        this.notify(
          'RTK savings unavailable: rtk gain exceeded the 5 second read timeout. Press r to retry.',
          'error',
        ),
    );
    this.diagnostics = new DiagnosticsView(this.theme);

    const sections: SelectItem[] = PAGE_ORDER.map(page => ({
      value: page,
      label: PAGE_LABELS[page],
      description: this.sectionDescription(page),
    }));
    this.sectionList = new SelectList(sections, 3, getSelectListTheme());
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
    const showDetailHint = !(
      this.page === 'integration' && this.integration.editingExecutable
    );
    const lines = this.rootSelection
      ? [
          this.titleLine('RTK control center', 'available · 0.45.0'),
          '',
          'Manage Pi Stuff integration and inspect RTK savings.',
          '',
          ...this.sectionList.render(innerWidth),
          '',
          this.theme.fg('dim', '↑↓ select · Enter open · Esc close'),
        ]
      : [
          this.theme.bold(
            `${this.theme.fg('muted', 'RTK /')} ${PAGE_LABELS[this.page]}`,
          ),
          '',
          ...this.renderPage(innerWidth),
          ...(showDetailHint
            ? [
                '',
                this.theme.fg(
                  'dim',
                  this.page === 'savings'
                    ? '↑↓ select · Enter change · r refresh · Esc back'
                    : this.page === 'integration'
                      ? '↑↓ select · Enter change · Esc back'
                      : 'Esc back',
                ),
              ]
            : []),
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

  private titleLine(title: string, status: string) {
    return `${this.theme.bold(this.theme.fg('accent', title))}  ${this.theme.fg(
      'success',
      status,
    )}`;
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
    if (page === 'integration') return 'Settings, executable and runtime state';
    if (page === 'savings') {
      return 'Gain overview, periods, history and failures';
    }
    return 'Resolution, failures and native RTK config';
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
    description: 'Prototype state: normal, loading or failure',
    type: 'string',
    default: 'normal',
  });
  pi.registerCommand('rtk', {
    description: 'Open RTK integration controls and savings',
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
