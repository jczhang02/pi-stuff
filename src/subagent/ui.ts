import {
  CustomEditor,
  keyHint,
  type ExtensionContext,
  type KeybindingsManager,
} from '@earendil-works/pi-coding-agent';
import {
  matchesKey,
  wrapTextWithAnsi,
  type EditorTheme,
  type TUI,
} from '@earendil-works/pi-tui';
import {fleetLines, type FleetRow} from './fleet';
import {mainFooter} from './main-footer';
import {Inspection} from './inspection';
import {GraphView} from './graph-view';
import {Intervention, type InterventionAction} from './intervention';
import {DocumentView} from './document-view';
import {HistoryView} from './history-view';
import {TranscriptView} from './transcript-view';
import type {Runs} from './runs';

class SubagentEditor extends CustomEditor {
  constructor(
    tui: TUI,
    theme: EditorTheme,
    private readonly bindings: KeybindingsManager,
    private readonly inspector: SubagentUI,
  ) {
    super(tui, theme, bindings, {embedWorkingStatus: true});
  }

  override handleInput(data: string): void {
    if (this.inspector.handleInput(data, this.bindings)) return;
    const cursor = this.getCursor();
    const text = this.getText();
    const completion = this.isShowingAutocomplete();
    const vertical =
      this.bindings.matches(data, 'tui.editor.cursorUp') ||
      this.bindings.matches(data, 'tui.editor.cursorDown');
    let handled = false;
    const change = this.onChange;
    const shortcut = this.onExtensionShortcut;
    this.onChange = value => {
      handled = true;
      change?.(value);
    };
    this.onExtensionShortcut = value => {
      const result = shortcut?.(value) ?? false;
      handled ||= result;
      return result;
    };
    try {
      super.handleInput(data);
    } finally {
      if (change) this.onChange = change;
      else delete this.onChange;
      if (shortcut) this.onExtensionShortcut = shortcut;
      else delete this.onExtensionShortcut;
    }
    const conflict = this.bindings
      .getConflicts()
      .some(
        item =>
          matchesKey(data, item.key) &&
          item.keybindings.some(
            name =>
              name.startsWith('app.') ||
              name.startsWith('tui.input.') ||
              (name.startsWith('tui.editor.') &&
                name !== 'tui.editor.cursorUp' &&
                name !== 'tui.editor.cursorDown'),
          ),
      );
    const after = this.getCursor();
    if (
      vertical &&
      !handled &&
      !conflict &&
      !completion &&
      !this.isShowingAutocomplete() &&
      text === this.getText() &&
      cursor.line === after.line &&
      cursor.col === after.col
    )
      this.inspector.open(false);
  }

  override render(width: number): string[] {
    return this.inspector.renderInspection(width) ?? super.render(width);
  }
}

export class SubagentUI {
  private ctx: ExtensionContext | undefined;
  private editor: SubagentEditor | undefined;
  private tui: TUI | undefined;
  private keys: KeybindingsManager | undefined;
  private readonly input = {
    render: () => [],
    invalidate() {},
    handleInput: (data: string) => {
      if (this.keys) this.handleInput(data, this.keys);
    },
  };
  private previousEditor: ReturnType<
    ExtensionContext['ui']['getEditorComponent']
  >;
  private unsubscribe: (() => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private footer = false;
  private focus: 'editor' | 'fleet' | 'panel' = 'editor';
  private selected = 0;
  private readonly panels: (
    | Inspection
    | GraphView
    | DocumentView
    | HistoryView
    | TranscriptView
  )[] = [];
  private intervention: Intervention | undefined;

  constructor(private readonly runs: Runs) {}

  private rows(): FleetRow[] {
    return this.runs
      .list()
      .flatMap(run => run.tasks.map(task => ({run, task})));
  }

  mount(ctx: ExtensionContext): void {
    this.dispose();
    if (ctx.mode !== 'tui') return;
    this.ctx = ctx;
    this.previousEditor = ctx.ui.getEditorComponent();
    ctx.ui.setEditorComponent((tui, theme, keys) => {
      this.tui = tui;
      this.keys = keys;
      this.intervention = new Intervention(
        tui,
        theme,
        keys,
        this.runs,
        ctx,
        accepted => {
          if (this.ctx !== ctx) return;
          const panel = this.panels.at(-1);
          if (accepted && panel instanceof Inspection) panel.handleInput('f');
          tui.setFocus(this.input);
          this.refresh();
        },
      );
      this.editor = new SubagentEditor(tui, theme, keys, this);
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== 'message' || entry.message.role !== 'user') continue;
        const content = entry.message.content;
        this.editor.addToHistory(
          Array.isArray(content)
            ? content
                .filter(part => part.type === 'text')
                .map(part => part.text)
                .join('\n')
            : content,
        );
      }
      return this.editor;
    });
    this.unsubscribe = this.runs.subscribe(() => this.refresh());
    this.timer = setInterval(() => {
      if (this.rows().some(row => !row.task.endedAt)) this.tui?.requestRender();
    }, 1000);
    this.refresh();
  }

  private refresh(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const panel = this.panels.at(-1);
    if (panel instanceof TranscriptView || panel instanceof Inspection)
      panel.refresh();
    if (!this.footer && this.rows().length) {
      this.footer = true;
      ctx.ui.setFooter((tui, _theme, data) => {
        const off = data.onBranchChange(() => tui.requestRender());
        return {
          invalidate() {},
          dispose: off,
          render: width => {
            if (this.focus === 'panel') return [];
            const theme = ctx.ui.theme;
            const all = this.rows();
            const budget = Math.max(
              1,
              Math.min(8, Math.floor(tui.terminal.rows / 4)),
            );
            this.selected = Math.min(this.selected, all.length);
            const start = Math.max(0, this.selected - budget);
            const visible = all.slice(start, start + budget);
            const selected = this.selected === 0 ? 0 : this.selected - start;
            const help =
              this.focus === 'fleet'
                ? wrapTextWithAnsi(
                    theme.fg(
                      'dim',
                      `${keyHint('tui.select.up', '')}/${keyHint('tui.select.down', 'select')} · ${keyHint('tui.select.confirm', 'view')}${all[this.selected - 1]?.run.tasks.some(task => task.needs.length) ? ' · g graph' : ''} · esc back`,
                    ),
                    width,
                  )
                : [];
            const range =
              all.length > budget
                ? [
                    theme.fg(
                      'dim',
                      `${start + 1}–${Math.min(start + budget, all.length)} / ${all.length} agents`,
                    ),
                  ]
                : [];
            return [
              ...mainFooter(ctx, data, theme, width),
              ...help,
              ...fleetLines(
                visible,
                selected,
                this.focus === 'fleet',
                width,
                theme,
                Date.now(),
              ),
              ...range,
            ];
          },
        };
      });
    }
    this.tui?.requestRender();
  }

  open(notifyEmpty = true): void {
    if (!this.rows().length) {
      if (notifyEmpty) this.ctx?.ui.notify('No retained subagents.', 'info');
      return;
    }
    this.focus = 'fleet';
    this.tui?.setFocus(this.input);
    this.ctx?.ui.setWorkingVisible(true);
    this.refresh();
  }

  handleInput(data: string, keys: KeybindingsManager): boolean {
    if (this.focus === 'editor') return false;
    if (matchesKey(data, 'escape')) {
      if (this.focus === 'panel') {
        const closed = this.panels.pop();
        if (closed instanceof TranscriptView || closed instanceof Inspection)
          closed.dispose();
        if (!this.panels.length) this.open();
      } else {
        this.focus = 'editor';
        if (this.editor) this.tui?.setFocus(this.editor);
      }
      this.refresh();
      return true;
    }
    const panel = this.panels.at(-1);
    if (this.focus === 'panel' && panel) {
      if (panel instanceof TranscriptView) {
        panel.handleInput(data);
      } else if (panel instanceof DocumentView) {
        if (data === 'h' && !panel.request)
          this.panels.push(new HistoryView(panel.row));
        else if (
          data === 't' &&
          this.tui &&
          (panel.request ?? panel.row.task).sessionFile
        )
          this.panels.push(
            new TranscriptView(panel.row, this.runs, this.tui, panel.request),
          );
        else panel.handleInput(data);
      } else if (panel instanceof HistoryView) {
        const request = panel.selectedRecord();
        if (request && keys.matches(data, 'tui.select.confirm'))
          this.panels.push(new DocumentView(panel.row, request));
        else panel.handleInput(data);
      } else if (panel instanceof GraphView) {
        const task = panel.selectedTask();
        if (task && keys.matches(data, 'tui.select.confirm'))
          this.panels.push(this.inspect({run: panel.run, task}));
        else panel.handleInput(data, keys);
      } else if (
        data === 'g' &&
        panel.row.run.tasks.some(task => task.needs.length)
      ) {
        if (this.panels.at(-2) instanceof GraphView) {
          this.panels.pop();
          panel.dispose();
        } else
          this.panels.push(
            new GraphView(panel.row.run, panel.row.task.id, id =>
              this.runs.queuedReason(panel.row.run.id, id),
            ),
          );
      } else if (data === 'i') {
        this.panels.push(new DocumentView(panel.currentRow()));
      } else if (
        data === 't' &&
        panel.currentRow().task.sessionFile &&
        this.tui
      ) {
        this.panels.push(
          new TranscriptView(panel.currentRow(), this.runs, this.tui),
        );
      } else {
        const row = panel.currentRow();
        const action =
          data === 'x'
            ? 'stop'
            : keys.matches(data, 'tui.select.confirm') && row.task.question
              ? 'reply'
              : data === 'm'
                ? this.primaryAction(row)
                : undefined;
        if (action && this.intervention) {
          panel.freeze();
          this.intervention.open(row, action);
        } else panel.handleInput(data);
      }
      this.refresh();
      return true;
    }
    const rows = this.rows();
    const selectedRow = rows[this.selected - 1];
    if (
      data === 'g' &&
      selectedRow?.run.tasks.some(task => task.needs.length)
    ) {
      this.panels.push(
        new GraphView(selectedRow.run, selectedRow.task.id, id =>
          this.runs.queuedReason(selectedRow.run.id, id),
        ),
      );
      this.focus = 'panel';
      this.ctx?.ui.setWorkingVisible(false);
    } else if (keys.matches(data, 'tui.select.up'))
      this.selected = Math.max(0, this.selected - 1);
    else if (keys.matches(data, 'tui.select.down'))
      this.selected = Math.min(rows.length, this.selected + 1);
    else if (keys.matches(data, 'tui.select.confirm')) {
      const row = rows[this.selected - 1];
      if (row) {
        this.panels.push(this.inspect(row));
        this.focus = 'panel';
        this.ctx?.ui.setWorkingVisible(false);
      } else {
        this.focus = 'editor';
        if (this.editor) this.tui?.setFocus(this.editor);
      }
    }
    this.refresh();
    return true;
  }

  renderInspection(width: number): string[] | undefined {
    if (this.focus !== 'panel' || !this.ctx || !this.tui) return undefined;
    if (width < 40 || this.tui.terminal.rows < 16)
      return wrapTextWithAnsi('Resize terminal.\nesc back', Math.max(1, width));
    const panel = this.panels.at(-1);
    if (
      panel instanceof DocumentView ||
      panel instanceof HistoryView ||
      panel instanceof TranscriptView
    )
      return panel.render(
        width,
        Math.floor(this.tui.terminal.rows / 2),
        this.ctx.ui.theme,
      );
    if (panel instanceof GraphView) {
      const help = wrapTextWithAnsi(
        this.ctx.ui.theme.fg(
          'dim',
          `${keyHint('tui.select.up', '')}/${keyHint('tui.select.down', 'select')} · ${keyHint('tui.select.confirm', 'view')} · esc back`,
        ),
        width,
      );
      return [
        ...panel.render(
          width,
          Math.floor(this.tui.terminal.rows / 2) - help.length,
          this.ctx.ui.theme,
        ),
        ...help,
      ];
    }
    if (!panel) return [];
    const composer = this.intervention?.active
      ? this.intervention.render(width, this.tui.terminal.rows - 10)
      : [];
    if (composer.length && composer.length + 6 > this.tui.terminal.rows - 6)
      return wrapTextWithAnsi(
        'Resize terminal to edit this message.\nesc back',
        width,
      );
    const row = panel.currentRow();
    const primary = this.primaryAction(row);
    const actions = [
      row.task.question && !this.intervention?.unavailable(row, 'reply')
        ? keyHint('tui.select.confirm', 'reply')
        : '',
      primary && !this.intervention?.unavailable(row, primary)
        ? `m ${primary}`
        : '',
      !this.intervention?.unavailable(row, 'stop') ? 'x stop' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return [
      ...panel.render(
        width,
        Math.max(
          4,
          Math.min(
            this.tui.terminal.rows - 6,
            Math.max(
              Math.floor(this.tui.terminal.rows / 2),
              composer.length + 6,
            ),
          ) - composer.length,
        ),
        this.ctx.ui.theme,
        actions,
        composer.length > 0,
      ),
      ...composer,
    ];
  }

  private primaryAction(row: FleetRow): InterventionAction | undefined {
    return row.task.status === 'running'
      ? 'message'
      : row.task.status === 'completed'
        ? 'follow-up'
        : row.task.status === 'failed' || row.task.status === 'stopped'
          ? 'resume'
          : undefined;
  }

  private inspect(row: FleetRow): Inspection {
    return new Inspection(
      row,
      () => this.runs.queuedReason(row.run.id, row.task.id),
      this.tui ? {runs: this.runs, tui: this.tui} : undefined,
    );
  }

  dispose(): void {
    this.intervention?.dispose();
    this.intervention = undefined;
    clearInterval(this.timer);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.ctx) {
      if (this.footer) this.ctx.ui.setFooter(undefined);
      this.ctx.ui.setEditorComponent(this.previousEditor);
      this.ctx.ui.setWorkingVisible(true);
    }
    this.ctx = undefined;
    this.editor = undefined;
    this.tui = undefined;
    this.keys = undefined;
    this.footer = false;
    this.focus = 'editor';
    for (const panel of this.panels)
      if (panel instanceof TranscriptView || panel instanceof Inspection)
        panel.dispose();
    this.panels.length = 0;
    this.selected = 0;
  }
}
