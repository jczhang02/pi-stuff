import {
  getSettingsListTheme,
  keyHint,
  type ExtensionAPI,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  SelectList,
  Container,
  Text,
  Spacer,
  SettingsList,
  Key,
  matchesKey,
  type Focusable,
  type KeybindingsManager,
  type TUI,
} from '@earendil-works/pi-tui';
import {stripVTControlCharacters} from 'node:util';
import type {RtkSettings} from './settings';
import type {RtkRuntime} from './runtime';
import {ExecutableEditor} from './executable-editor';
import {UsageView} from './usage';
import {fillRows} from './display';
import {PanelLayout, PanelPage, panelMenu} from '../pi/panel-layout';
import {DiagnosticsView} from './diagnostics';

type Page = 'Settings' | 'Usage' | 'Diagnostics';

const SETTINGS_DESCRIPTIONS = {
  rewrite: 'Rewrite supported model-originated Bash commands through RTK.',
  ansi: 'Remove terminal control sequences from final tool results.',
  executable: 'Automatic discovery or a validated absolute path.',
};

class RtkPanel extends Container implements Focusable {
  focused = false;
  private page: Page | undefined;
  private readonly sections: SelectList;
  private readonly settings: SettingsList;
  private readonly layout: PanelLayout;
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
    done: () => void,
    private readonly runtime: RtkRuntime,
    private readonly cwd: string,
    private readonly save: (settings: RtkSettings) => Promise<void>,
    private readonly notify: (message: string, type: 'info' | 'error') => void,
    initialPage: Page | undefined,
  ) {
    super();
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
    this.layout = new PanelLayout(theme);
    this.sections = panelMenu([
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
    ]);
    this.sections.onSelect = item => {
      if (this.tooSmall()) return;
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
          description: SETTINGS_DESCRIPTIONS.rewrite,
          currentValue:
            runtime.settings.rewrite === false ? 'disabled' : 'enabled',
          values: ['enabled', 'disabled'],
        },
        {
          id: 'ansi',
          label: 'ANSI cleanup',
          description: SETTINGS_DESCRIPTIONS.ansi,
          currentValue:
            runtime.settings.ansi === false ? 'disabled' : 'enabled',
          values: ['enabled', 'disabled'],
        },
        {
          id: 'executable',
          label: 'Executable',
          description: SETTINGS_DESCRIPTIONS.executable,
          currentValue:
            runtime.settings.executable === undefined ? 'automatic' : 'custom',
          submenu: (_value, close) => {
            this.editor = new ExecutableEditor(
              theme,
              this.layout,
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
      getSettingsListTheme(),
      (id, value) => {
        if (this.saving) {
          this.settings.updateValue(
            id,
            (id === 'ansi'
              ? this.runtime.settings.ansi
              : this.runtime.settings.rewrite) === false
              ? 'disabled'
              : 'enabled',
          );
          return;
        }
        void this.change(id, value);
      },
      () => this.back(),
      {enableSearch: true},
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
    } finally {
      this.saving = false;
      this.settings.updateValue(
        id,
        (id === 'ansi'
          ? this.runtime.settings.ansi
          : this.runtime.settings.rewrite) === false
          ? 'disabled'
          : 'enabled',
      );
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
    if (this.tooSmall()) {
      this.sections.handleInput(data);
      return;
    }
    if (!this.editor && (this.page === undefined || this.page === 'Settings')) {
      if (this.page === undefined) {
        if (data === 'r') void this.usage.refresh();
        else this.sections.handleInput(data);
      } else this.settings.handleInput(data);
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      if (this.editor) this.editor.handleInput(data);
      else this.back();
      this.tui.requestRender();
      return;
    }
    if (this.keys.matches(data, 'tui.select.cancel')) return;
    if (this.saving) return;
    if (this.editor) this.editor.handleInput(data);
    else if (this.page === 'Usage') this.usage.handleInput(data);
    else if (this.page === 'Diagnostics') this.diagnostics.handleInput(data);
    this.tui.requestRender();
  }

  render(width: number) {
    this.clear();
    const inner = Math.max(12, width - 4);
    if (this.tooSmall())
      return this.layout.tooSmall(
        width,
        'RTK',
        26,
        keyHint('tui.select.cancel', 'close'),
      );
    if (this.page === undefined) {
      this.addChild(
        new PanelPage(
          this.theme,
          `RTK  ${this.status}`,
          this.sections,
          [
            'Configure RTK and inspect usage.',
            '',
            this.theme.fg('muted', this.usage.titleStatus()),
            ...fillRows(this.usage.rootSummary(inner), 2),
          ].join('\n'),
        ),
      );
      return super.render(width);
    }
    if (this.page === 'Settings' && !this.editor) {
      const body = new Container();
      body.addChild(
        new Text(
          `Runtime: ${this.runtimeInfo ? 'available' : this.status} · ${this.runtimeInfo?.version ?? '-'} · ${this.runtimeInfo?.source ?? '-'}`,
          1,
          0,
        ),
      );
      body.addChild(new Spacer(1));
      body.addChild(this.settings);
      if (this.error)
        body.addChild(new Text(this.theme.fg('error', this.error), 1, 0));
      this.addChild(new PanelPage(this.theme, 'RTK / Settings', body));
      return super.render(width);
    }
    const lines =
      this.page === 'Settings'
        ? this.settings.render(inner)
        : this.page === 'Usage'
          ? this.usage.render(inner)
          : this.diagnostics.render(inner);
    return this.layout.frame(
      width,
      this.page ? `RTK / ${this.page}` : 'RTK',
      lines,
      this.status,
    );
  }

  private tooSmall() {
    return this.tui.terminal.columns < 56 || this.tui.terminal.rows < 26;
  }
  invalidate() {
    this.layout.invalidate();
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
