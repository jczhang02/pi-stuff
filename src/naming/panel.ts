import {
  DynamicBorder,
  getSelectListTheme,
  keyText,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  Input,
  Key,
  matchesKey,
  SelectList,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type KeybindingsManager,
  type TUI,
} from '@earendil-works/pi-tui';
import {Effect} from 'effect';
import {lstat} from 'node:fs/promises';
import {stripVTControlCharacters} from 'node:util';
import type {NamingSettings} from './settings';
import type {NamingRuntime} from './register';
import {NamingSettingsPanel} from './settings-panel';
import {readablePanelLines} from '../pi/panel-style';

type Page = 'home' | 'settings' | 'hint';

class NamingPanel implements Component, Focusable {
  private readonly border: DynamicBorder;
  private readonly actions: SelectList;
  private readonly settings: NamingSettingsPanel;
  private readonly hint = new Input({placeholder: 'Optional task hint'});
  private page: Page = 'home';
  private saved: boolean | undefined;
  private observation = 0;
  private closed = false;
  private error = '';
  private generation: AbortController | undefined;
  private active = false;
  private namePage = 0;
  private namePages = 1;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keys: KeybindingsManager,
    private readonly done: () => void,
    private readonly ctx: ExtensionContext,
    private readonly runtime: NamingRuntime,
    save: (settings: NamingSettings) => Promise<void>,
    notifyError: (message: string) => void,
  ) {
    this.border = new DynamicBorder(text => theme.fg('borderAccent', text));
    this.actions = new SelectList(
      [
        {
          value: 'generate',
          label: 'Generate name',
          description: 'Use the task or supply a hint',
        },
        {
          value: 'settings',
          label: 'Settings',
          description: 'Automatic naming, model and rules',
        },
      ],
      2,
      getSelectListTheme(),
    );
    this.actions.onSelect = item =>
      this.changePage(item.value === 'generate' ? 'hint' : 'settings');
    this.settings = new NamingSettingsPanel(
      tui,
      theme,
      keys,
      ctx,
      runtime,
      save,
      () => this.changePage('home'),
      notifyError,
    );
    this.hint.onSubmit = value => {
      void this.generate(value);
    };
    void this.refresh();
  }

  get focused() {
    return this.active;
  }
  set focused(value: boolean) {
    this.active = value;
    this.hint.focused = value && this.page === 'hint';
    this.settings.focused = value && this.page === 'settings';
  }

  private renderAgain() {
    if (!this.closed) this.tui.requestRender();
  }
  private changePage(page: Page) {
    if (this.closed) return;
    this.page = page;
    this.error = '';
    this.focused = this.active;
    this.renderAgain();
  }
  async refresh() {
    const observation = ++this.observation;
    const file = this.ctx.sessionManager.getSessionFile();
    const saved = file
      ? await Effect.runPromise(
          Effect.tryPromise({
            try: () => lstat(file),
            catch: () => false,
          }).pipe(
            Effect.map(() => true),
            Effect.catch(() => Effect.succeed(false)),
          ),
        )
      : false;
    if (this.closed || observation !== this.observation) return;
    this.saved = saved;
    this.renderAgain();
  }
  private async generate(hint: string) {
    if (this.generation || this.closed) return;
    const request = new AbortController();
    this.generation = request;
    this.error = '';
    const result = await this.runtime.request(this.ctx, hint, request.signal);
    if (this.generation === request) this.generation = undefined;
    if (this.closed || request.signal.aborted) return;
    if (result.kind === 'failed') this.error = result.message;
    else if (result.kind === 'applied') {
      this.observation++;
      this.saved = result.saved;
      this.namePage = 0;
      this.changePage('home');
    }
    this.renderAgain();
  }
  handleInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      if (this.tooSmall() || this.page === 'home') this.done();
      else if (this.page === 'settings') this.settings.handleInput(data);
      else {
        this.generation?.abort();
        this.generation = undefined;
        this.changePage('home');
      }
      return;
    }
    if (this.keys.matches(data, 'tui.select.cancel') || this.tooSmall()) return;
    if (this.page === 'home') {
      if (data === '[') this.namePage = Math.max(0, this.namePage - 1);
      else if (data === ']')
        this.namePage = Math.min(this.namePages - 1, this.namePage + 1);
      else this.actions.handleInput(data);
    } else if (this.page === 'settings') this.settings.handleInput(data);
    else if (!this.generation) this.hint.handleInput(data);
    this.renderAgain();
  }
  private tooSmall() {
    return this.tui.terminal.columns < 56 || this.tui.terminal.rows < 24;
  }
  render(width: number) {
    const border = this.border.render(width)[0] ?? '';
    const inner = Math.max(12, width - 4);
    if (this.tooSmall())
      return [
        border,
        ...[
          'Naming needs more room',
          'Resize to at least 56 columns and 24 rows.',
          'Esc Close',
        ].flatMap(line => wrapTextWithAnsi(line, Math.max(1, width))),
        border,
      ];
    let lines: string[];
    if (this.page === 'home') {
      const name = stripVTControlCharacters(
        this.ctx.sessionManager.getSessionName() ?? 'No name yet',
      );
      const wrapped = wrapTextWithAnsi(name, inner);
      this.namePages = Math.max(1, Math.ceil(wrapped.length / 3));
      this.namePage = Math.min(this.namePage, this.namePages - 1);
      const slice = wrapped.slice(this.namePage * 3, this.namePage * 3 + 3);
      lines = [
        this.theme.fg(
          'muted',
          `Current name${this.namePages > 1 ? ` · ${this.namePage + 1}/${this.namePages} · [ / ]` : ''}`,
        ),
        ...slice,
        ...Array<string>(3 - slice.length).fill(''),
        this.ctx.sessionManager.getSessionName() && this.saved === false
          ? this.theme.fg('warning', 'Not saved yet')
          : '',
        this.ctx.sessionManager.getSessionName() && this.saved === false
          ? this.ctx.sessionManager.getSessionFile()
            ? 'Saved with the first assistant reply.'
            : 'Session storage is disabled for this session.'
          : '',
        '',
        ...this.actions.render(inner),
        '',
        this.theme.fg(
          'dim',
          `${keyText('tui.select.up')}/${keyText('tui.select.down')} Navigate · ${keyText('tui.select.confirm')} Open · Esc Close`,
        ),
      ];
    } else if (this.page === 'settings') lines = this.settings.render(inner);
    else
      lines = [
        'Use recent dialogue, or provide a task hint.',
        '',
        ...this.hint.render(inner),
        '',
        `${keyText('tui.input.submit')} Generate · Esc Back and cancel`,
      ];
    return readablePanelLines(
      [
        border,
        this.theme.bold(
          this.theme.fg(
            'accent',
            this.page === 'home'
              ? 'Naming'
              : `Naming / ${this.page === 'hint' ? 'Generate' : 'Settings'}`,
          ),
        ),
        '',
        ...lines,
        truncateToWidth(this.theme.fg('error', this.error), inner),
        border,
      ],
      this.theme,
    );
  }
  invalidate() {
    this.border.invalidate();
    this.actions.invalidate();
    this.settings.invalidate();
    this.hint.invalidate();
  }
  dispose() {
    this.closed = true;
    this.generation?.abort();
    this.settings.dispose();
  }
}

export function registerNamingPanel(
  pi: ExtensionAPI,
  runtime: NamingRuntime,
  save: (settings: NamingSettings) => Promise<void>,
) {
  let close: (() => void) | undefined;
  let refresh: (() => Promise<void>) | undefined;
  let lifetime = 0;
  const saves = new Set<Promise<void>>();
  async function persist(settings: NamingSettings) {
    const pending = save(settings);
    saves.add(pending);
    try {
      await pending;
    } finally {
      saves.delete(pending);
    }
  }
  pi.on('session_info_changed', () => refresh?.());
  pi.on('agent_settled', () => refresh?.());
  pi.on('session_shutdown', async () => {
    lifetime++;
    close?.();
    // Replacement must load the result of every already-confirmed save.
    await Promise.allSettled(saves);
  });
  pi.on('session_before_switch', () => close?.());
  pi.on('session_before_fork', () => close?.());
  pi.on('session_before_tree', () => close?.());
  pi.registerCommand('naming', {
    description: 'Open naming settings and session actions',
    handler: async (_args, ctx) => {
      if (ctx.mode !== 'tui') {
        if (ctx.mode === 'print' || ctx.mode === 'json')
          console.error('/naming requires TUI mode.');
        else ctx.ui.notify('/naming requires TUI mode.', 'error');
        return;
      }
      const origin = lifetime;
      try {
        await ctx.ui.custom<void>((tui, theme, keys, done) => {
          const panel = new NamingPanel(
            tui,
            theme,
            keys,
            () => close?.(),
            ctx,
            runtime,
            persist,
            message => {
              if (origin === lifetime) ctx.ui.notify(message, 'error');
            },
          );
          close = () => {
            panel.dispose();
            done();
          };
          refresh = () => panel.refresh();
          return panel;
        });
      } finally {
        close = undefined;
        refresh = undefined;
      }
    },
  });
}
