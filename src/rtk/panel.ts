import type {ExtensionAPI, Theme} from '@earendil-works/pi-coding-agent';
import {
  DynamicBorder,
  getSelectListTheme,
  getSettingsListTheme,
} from '@earendil-works/pi-coding-agent';
import {
  SelectList,
  SettingsList,
  Key,
  matchesKey,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type KeybindingsManager,
  type TUI,
} from '@earendil-works/pi-tui';
import {stripVTControlCharacters} from 'node:util';
import type {RtkSettings} from './settings';
import type {RtkRuntime} from './runtime';
import {ExecutableEditor} from './executable-editor';
import {UsageView} from './usage';
import {dataRow, fillRows, readablePanelLines, RTK_BODY_ROWS} from './display';
import {DiagnosticsView} from './diagnostics';

type Page = 'Settings' | 'Usage' | 'Diagnostics';

class RtkPanel implements Component, Focusable {
  focused = false;
  private page: Page | undefined;
  private readonly sections: SelectList;
  private readonly settings: SettingsList;
  private readonly border: DynamicBorder;
  private readonly controller = new AbortController();
  private probeController: AbortController | undefined;
  private status = 'checking';
  private runtimeInfo: Awaited<ReturnType<RtkRuntime['probe']>> | undefined;
  private error = '';
  private saving = false;
  private editor: ExecutableEditor | undefined;
  private readonly usage: UsageView;
  private readonly diagnostics: DiagnosticsView;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keys: KeybindingsManager,
    private readonly done: () => void,
    private readonly runtime: RtkRuntime,
    private readonly cwd: string,
    private readonly save: (settings: RtkSettings) => Promise<void>,
    private readonly notify: (message: string, type: 'info' | 'error') => void,
    initialPage: Page | undefined,
  ) {
    this.page = initialPage;
    this.diagnostics = new DiagnosticsView(
      theme,
      runtime,
      cwd,
      () => this.back(),
      () => tui.requestRender(),
      message => notify(message, 'error'),
    );
    this.usage = new UsageView(
      theme,
      runtime,
      cwd,
      () => this.back(),
      () => tui.requestRender(),
      message => notify(message, 'error'),
    );
    this.border = new DynamicBorder(text => theme.fg('borderAccent', text));
    this.sections = new SelectList(
      [
        {
          value: 'Settings',
          label: 'Settings',
          description: 'Rewrite, cleanup, executable',
        },
        {
          value: 'Usage',
          label: 'Usage',
          description: 'Totals, periods and history',
        },
        {
          value: 'Diagnostics',
          label: 'Diagnostics',
          description: 'Resolution and configuration',
        },
      ],
      3,
      getSelectListTheme(),
      {minPrimaryColumnWidth: 18, maxPrimaryColumnWidth: 18},
    );
    this.sections.onSelect = item => {
      this.usage.cancelPending();
      this.diagnostics.cancelPending();
      if (
        item.value === 'Settings' ||
        item.value === 'Usage' ||
        item.value === 'Diagnostics'
      )
        this.page = item.value;
      if (this.page === 'Usage') void this.usage.refresh();
      if (this.page === 'Diagnostics') void this.diagnostics.refresh();
      tui.requestRender();
    };
    this.sections.onCancel = done;
    this.settings = new SettingsList(
      [
        {
          id: 'rewrite',
          label: 'Command rewrite',
          description:
            'Rewrite supported model-originated Bash commands through RTK.',
          currentValue:
            runtime.settings.rewrite === false ? 'disabled' : 'enabled',
          values: ['enabled', 'disabled'],
        },
        {
          id: 'ansi',
          label: 'ANSI cleanup',
          description:
            'Remove terminal control sequences from final tool results.',
          currentValue:
            runtime.settings.ansi === false ? 'disabled' : 'enabled',
          values: ['enabled', 'disabled'],
        },
        {
          id: 'executable',
          label: 'Executable',
          description: 'Automatic discovery or a validated absolute path.',
          currentValue:
            runtime.settings.executable === undefined ? 'automatic' : 'custom',
          submenu: (_value, close) => {
            this.editor = new ExecutableEditor(
              theme,
              runtime.settings.executable,
              runtime.settings.executable ?? this.runtimeInfo?.path ?? '',
              cwd,
              async path => {
                const next = {...runtime.settings};
                if (path === undefined) delete next.executable;
                else next.executable = path;
                await save(next);
                this.usage.resetSource();
                this.notify('RTK setting saved.', 'info');
                this.runtimeInfo = undefined;
                this.status = 'checking';
                void this.probe();
              },
              value => {
                this.editor?.dispose();
                this.editor = undefined;
                close(value);
              },
              () => tui.requestRender(),
              message => notify(message, 'error'),
            );
            return this.editor;
          },
        },
      ],
      5,
      {
        ...getSettingsListTheme(),
        hint: () => theme.fg('dim', '  ↑↓ Navigate · Enter Change · Esc Back'),
      },
      (id, value) => {
        void this.change(id, value);
      },
      () => this.back(),
    );
    void this.probe();
    if (initialPage === 'Diagnostics') void this.diagnostics.refresh();
    if (initialPage === 'Usage' || initialPage === undefined)
      void this.usage.refresh();
  }

  private async probe() {
    if (this.controller.signal.aborted) return;
    this.probeController?.abort();
    const pending = new AbortController();
    this.probeController = pending;
    try {
      const info = await this.runtime.probe(this.cwd, pending.signal);
      if (pending.signal.aborted) return;
      this.runtimeInfo = info;
      this.status = `✓ v${info.version}`;
    } catch {
      if (pending.signal.aborted) return;
      this.status = 'unavailable';
    }
    this.tui.requestRender();
  }

  private async change(id: string, value: string) {
    if (id !== 'rewrite' && id !== 'ansi') return;
    this.saving = true;
    this.error = '';
    this.tui.requestRender();
    try {
      const next = {...this.runtime.settings, [id]: value === 'enabled'};
      await this.save(next);
      this.notify('RTK setting saved.', 'info');
    } catch (error) {
      this.error = stripVTControlCharacters(String(error));
      this.notify(this.error, 'error');
      this.settings.updateValue(
        id,
        (id === 'ansi'
          ? this.runtime.settings.ansi
          : this.runtime.settings.rewrite) === false
          ? 'disabled'
          : 'enabled',
      );
    } finally {
      this.saving = false;
      if (!this.controller.signal.aborted) this.tui.requestRender();
    }
  }

  private back() {
    const previous = this.page;
    this.usage.cancelPending();
    this.diagnostics.cancelPending();
    this.page = undefined;
    if (previous !== 'Usage') void this.usage.refresh();
    this.tui.requestRender();
  }

  handleInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      if (this.tooSmall() || this.page === undefined) this.done();
      else if (this.editor) this.editor.handleInput(data);
      else this.back();
      this.tui.requestRender();
      return;
    }
    if (this.keys.matches(data, 'tui.select.cancel')) return;
    if (this.tooSmall() || this.saving) return;
    if (this.page === undefined) {
      if (data === 'r') void this.usage.refresh();
      else this.sections.handleInput(data);
    } else if (this.page === 'Settings') this.settings.handleInput(data);
    else if (this.page === 'Usage') this.usage.handleInput(data);
    else if (this.page === 'Diagnostics') this.diagnostics.handleInput(data);
    this.tui.requestRender();
  }

  render(width: number) {
    const border = this.border.render(width)[0] ?? '';
    const inner = Math.max(12, width - 4);
    if (this.tooSmall())
      return readablePanelLines(
        [
          border,
          this.theme.fg('warning', 'RTK needs more room'),
          ...wrapTextWithAnsi(
            'Resize to at least 56 columns and 26 rows.',
            inner,
          ),
          '',
          'Esc close',
          border,
        ],
        this.theme,
      );
    const title = this.theme.bold(
      this.theme.fg('accent', this.page ? `RTK / ${this.page}` : 'RTK'),
    );
    const gap =
      width < 76
        ? 2
        : Math.max(2, inner - visibleWidth(title) - visibleWidth(this.status));
    const lines =
      this.page === undefined
        ? [
            'Configure RTK and inspect usage.',
            '',
            this.theme.fg('muted', this.usage.titleStatus()),
            ...fillRows(this.usage.rootSummary(inner), 2),
            '',
            ...this.sections.render(inner),
            '',
            this.theme.fg('dim', '↑↓ Navigate · Enter Open · Esc Close'),
          ]
        : this.page === 'Settings'
          ? this.settingsLines(inner)
          : this.page === 'Usage'
            ? this.usage.render(inner)
            : this.diagnostics.render(inner);
    return readablePanelLines(
      [
        border,
        `${title}${' '.repeat(gap)}${this.theme.fg('muted', this.status)}`,
        '',
        ...fillRows(lines.slice(0, -1), RTK_BODY_ROWS - 1),
        lines.at(-1) ?? '',
        border,
      ],
      this.theme,
    );
  }

  private settingsLines(width: number): string[] {
    const settings = this.settings.render(width);
    if (this.editor) return settings;
    return [
      this.theme.bold('Runtime'),
      dataRow(
        this.theme,
        'Status',
        this.runtimeInfo ? 'available' : this.status,
        width,
      ),
      dataRow(this.theme, 'Version', this.runtimeInfo?.version ?? '-', width),
      dataRow(
        this.theme,
        'Resolved by',
        this.runtimeInfo?.source ?? '-',
        width,
      ),
      '',
      this.theme.bold('Behavior'),
      ...settings.slice(0, -1),
      ...fillRows(
        wrapTextWithAnsi(
          this.saving ? 'Saving settings...' : this.error,
          width,
        ).slice(0, 3),
        3,
      ),
      settings.at(-1) ?? '',
    ];
  }

  private tooSmall() {
    return this.tui.terminal.columns < 56 || this.tui.terminal.rows < 26;
  }
  invalidate() {
    this.border.invalidate();
    this.sections.invalidate();
    this.settings.invalidate();
    this.usage.invalidate();
    this.diagnostics.invalidate();
  }
  dispose() {
    this.controller.abort();
    this.probeController?.abort();
    this.editor?.dispose();
    this.usage.dispose();
    this.diagnostics.dispose();
  }
}

export function registerRtkPanel(
  pi: ExtensionAPI,
  runtime: RtkRuntime,
  save: (settings: RtkSettings) => Promise<void>,
) {
  pi.registerCommand('rtk', {
    description: 'Open RTK settings and usage',
    getArgumentCompletions: prefix =>
      ['integration', 'gain', 'diagnostics', 'refresh', 'help']
        .filter(value => value.startsWith(prefix))
        .map(value => ({value, label: value})),
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (
        arg === 'help' ||
        !['', 'integration', 'gain', 'diagnostics', 'refresh'].includes(arg)
      ) {
        ctx.ui.notify(
          'Usage: /rtk [integration|gain|diagnostics|refresh|help]',
          arg === 'help' ? 'info' : 'error',
        );
        return;
      }
      if (ctx.mode !== 'tui') {
        ctx.ui.notify('/rtk requires TUI mode', 'error');
        return;
      }
      const page =
        arg === 'integration'
          ? 'Settings'
          : arg === 'diagnostics'
            ? 'Diagnostics'
            : arg
              ? 'Usage'
              : undefined;
      await ctx.ui.custom<void>(
        (tui, theme, keys, done) =>
          new RtkPanel(
            tui,
            theme,
            keys,
            done,
            runtime,
            ctx.cwd,
            save,
            (message, type) => ctx.ui.notify(message, type),
            page,
          ),
      );
    },
  });
}
