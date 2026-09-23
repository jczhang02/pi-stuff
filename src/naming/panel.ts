import {
  type KeybindingsManager,
  keyHint,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  SelectList,
  truncateToWidth,
  wrapTextWithAnsi,
  Container,
  type Focusable,
  type TUI,
} from '@earendil-works/pi-tui';
import {Effect} from 'effect';
import {lstat} from 'node:fs/promises';
import {stripVTControlCharacters} from 'node:util';
import type {NamingSettings} from './settings';
import type {NamingRuntime} from './register';
import {NamingSettingsPanel} from './settings-panel';
import {PanelLayout, PanelPage, panelMenu} from '../pi/panel-layout';

type Page = 'home' | 'settings';

class NamingPanel extends Container implements Focusable {
  private readonly layout: PanelLayout;
  private readonly actions: SelectList;
  private readonly settings: NamingSettingsPanel;
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
    keys: KeybindingsManager,
    done: () => void,
    private readonly ctx: ExtensionContext,
    private readonly runtime: NamingRuntime,
    save: (settings: NamingSettings) => Promise<void>,
    notifyError: (message: string) => void,
  ) {
    super();
    this.layout = new PanelLayout(theme);
    this.actions = panelMenu([
      {
        value: 'settings',
        label: 'Settings',
        description: 'Automation, model and rules',
      },
      {
        value: 'generate',
        label: 'Generate name',
        description: 'Use the current conversation',
      },
    ]);
    this.actions.onCancel = done;
    this.actions.onSelect = item => {
      if (this.tooSmall()) return;
      if (item.value === 'generate') void this.generate();
      else this.changePage('settings');
    };
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
    void this.refresh();
  }

  get focused() {
    return this.active;
  }
  set focused(value: boolean) {
    this.active = value;
    this.settings.focused = value && this.page === 'settings';
  }

  private renderAgain() {
    if (!this.closed) this.tui.requestRender();
  }
  private changePage(page: Page) {
    if (this.closed) return;
    if (page === 'settings') {
      this.generation?.abort();
      this.generation = undefined;
    }
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
  private async generate() {
    if (this.generation || this.closed) return;
    const request = new AbortController();
    this.generation = request;
    this.error = '';
    const result = await this.runtime.request(this.ctx, '', request.signal);
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
    if (this.tooSmall()) {
      this.actions.handleInput(data);
      return;
    }
    if (this.page === 'home') {
      if (data === '[') this.namePage = Math.max(0, this.namePage - 1);
      else if (data === ']')
        this.namePage = Math.min(this.namePages - 1, this.namePage + 1);
      else this.actions.handleInput(data);
    } else if (this.page === 'settings') this.settings.handleInput(data);
    this.renderAgain();
  }
  private tooSmall() {
    return this.tui.terminal.columns < 56 || this.tui.terminal.rows < 24;
  }
  render(width: number) {
    this.clear();
    const inner = Math.max(12, width - 4);
    if (this.tooSmall())
      return this.layout.tooSmall(
        width,
        'AutoName',
        24,
        keyHint('tui.select.cancel', 'close'),
      );
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
        'Configure automatic naming and name this session.',
        '',
        this.theme.fg(
          'muted',
          `Current name${this.namePages > 1 ? ` · ${this.namePage + 1}/${this.namePages} · [ / ]` : ''}`,
        ),
        ...slice,
        ...Array<string>(Math.min(3, wrapped.length) - slice.length).fill(''),
        ...(this.ctx.sessionManager.getSessionName() && this.saved === false
          ? [
              this.theme.fg('warning', 'Not saved yet'),
              this.ctx.sessionManager.getSessionFile()
                ? 'Saved with the first assistant reply.'
                : 'Session storage is disabled for this session.',
            ]
          : []),
      ];
    } else {
      this.addChild(this.settings);
      return super.render(width);
    }
    if (this.page === 'home' && this.error)
      lines.push(truncateToWidth(this.theme.fg('error', this.error), inner));
    this.addChild(
      new PanelPage(this.theme, 'AutoName', this.actions, lines.join('\n')),
    );
    return super.render(width);
  }
  invalidate() {
    this.layout.invalidate();
    this.actions.invalidate();
    this.settings.invalidate();
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
  pi.registerCommand('autoname', {
    description: 'Generate a session name, or open the AutoName panel',
    handler: async (args, ctx) => {
      if (args.trim() !== 'panel') {
        const work = runtime.request(ctx, args);
        if (ctx.mode === 'print' || ctx.mode === 'json') await work;
        return;
      }
      if (ctx.mode !== 'tui') {
        if (ctx.mode === 'print' || ctx.mode === 'json')
          console.error('/autoname panel requires TUI mode.');
        else ctx.ui.notify('/autoname panel requires TUI mode.', 'error');
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
