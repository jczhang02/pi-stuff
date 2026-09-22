import {
  getSelectListTheme,
  keyText,
  type ExtensionContext,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  Editor,
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
import {stripVTControlCharacters} from 'node:util';
import type {NamingSettings} from './settings';

// Each editor owns only unsubmitted text. Durable saves remain with the file owner.
export class TextSettingEditor implements Component, Focusable {
  private readonly choices: SelectList;
  private readonly input: Input | Editor;
  private editing = false;
  private pending = false;
  private closed = false;
  private error = '';
  private active = false;

  constructor(
    tui: TUI,
    private readonly theme: Theme,
    private readonly label: string,
    initial: string,
    multiline: boolean,
    private readonly save: (value: string | undefined) => Promise<void>,
    private readonly done: () => void,
    private readonly renderAgain: () => void,
    private readonly notifyError: (message: string) => void,
  ) {
    this.choices = new SelectList(
      [
        {value: 'custom', label: 'Edit value'},
        {value: 'default', label: 'Use default'},
      ],
      2,
      getSelectListTheme(),
    );
    this.choices.onSelect = item => {
      if (item.value === 'default') void this.submit(undefined);
      else {
        this.editing = true;
        this.input.focused = this.active;
        renderAgain();
      }
    };
    this.input = multiline
      ? new Editor(
          tui,
          {
            borderColor: text => theme.fg('borderMuted', text),
            selectList: getSelectListTheme(),
          },
          {paddingX: 0},
        )
      : new Input();
    if (this.input instanceof Editor) this.input.setText(initial);
    else this.input.setValue(initial);
    this.input.onSubmit = value => {
      void this.submit(value);
    };
  }

  get focused() {
    return this.active;
  }
  set focused(value: boolean) {
    this.active = value;
    this.input.focused = value && this.editing;
  }

  private async submit(value: string | undefined) {
    if (this.pending || this.closed) return;
    this.pending = true;
    this.error = '';
    try {
      await this.save(value);
      if (!this.closed) this.done();
    } catch (error) {
      if (!this.closed) {
        this.error = stripVTControlCharacters(
          error instanceof Error
            ? error.message
            : 'Could not save this setting.',
        );
        this.notifyError(this.error);
      }
    } finally {
      this.pending = false;
      if (!this.closed) this.renderAgain();
    }
  }

  handleInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      if (this.editing && !this.pending) {
        this.editing = false;
        this.input.focused = false;
      } else this.done();
    } else if (!this.pending) {
      if (this.editing) this.input.handleInput(data);
      else this.choices.handleInput(data);
    }
    this.renderAgain();
  }
  render(width: number) {
    return [
      this.theme.bold(this.label),
      '',
      ...(this.editing ? this.input.render(width) : this.choices.render(width)),
      truncateToWidth(this.theme.fg('error', this.error), width),
      '',
      ...wrapTextWithAnsi(
        this.theme.fg(
          'dim',
          this.editing
            ? this.input instanceof Editor
              ? `${keyText('tui.input.submit')} Save · ${keyText('tui.input.newLine')} Newline · Esc Back`
              : `${keyText('tui.input.submit')} Save · Esc Back`
            : `${keyText('tui.select.up')}/${keyText('tui.select.down')} Navigate · ${keyText('tui.select.confirm')} Select · Esc Back`,
        ),
        width,
      ),
    ];
  }
  invalidate() {
    this.input.invalidate();
    this.choices.invalidate();
  }
  dispose() {
    this.closed = true;
  }
}

export class NamingModelPicker implements Component, Focusable {
  private readonly search = new Input({placeholder: 'Search models'});
  private choices: SelectList;
  private readonly models: NonNullable<NamingSettings['model']>[];
  private pending = false;
  private closed = false;
  private error = '';
  private detailPage = 0;
  private detailPages = 1;

  constructor(
    ctx: ExtensionContext,
    private readonly theme: Theme,
    private readonly keys: KeybindingsManager,
    selected: NamingSettings['model'],
    private readonly save: (model: NamingSettings['model']) => Promise<void>,
    private readonly done: () => void,
    private readonly renderAgain: () => void,
    private readonly notifyError: (message: string) => void,
  ) {
    this.models = ctx.modelRegistry
      .getAvailable()
      .map(model => ({provider: model.provider, id: model.id}));
    if (
      selected &&
      !this.models.some(
        model =>
          model.provider === selected.provider && model.id === selected.id,
      )
    )
      this.models.unshift(selected);
    this.choices = this.createChoices('');
    this.choices.setSelectedIndex(
      selected
        ? 1 +
            this.models.findIndex(
              model =>
                model.provider === selected.provider &&
                model.id === selected.id,
            )
        : 0,
    );
  }
  private createChoices(query: string) {
    const items = [
      {value: 'current', label: 'Use current session model'},
      ...this.models.map((model, index) => ({
        value: String(index),
        label: stripVTControlCharacters(`${model.provider}/${model.id}`),
      })),
    ].filter(item => item.label.toLowerCase().includes(query.toLowerCase()));
    const choices = new SelectList(items, 4, {
      ...getSelectListTheme(),
      noMatch: () => this.theme.fg('muted', 'No matching models'),
    });
    choices.onSelectionChange = () => {
      this.detailPage = 0;
    };
    choices.onSelect = item => {
      const model =
        item.value === 'current' ? undefined : this.models[Number(item.value)];
      void this.submit(
        model ? {provider: model.provider, id: model.id} : undefined,
      );
    };
    return choices;
  }
  get focused() {
    return this.search.focused;
  }
  set focused(value: boolean) {
    this.search.focused = value;
  }
  private async submit(model: NamingSettings['model']) {
    if (this.pending || this.closed) return;
    this.pending = true;
    this.error = '';
    try {
      await this.save(model);
      if (!this.closed) this.done();
    } catch (error) {
      if (!this.closed) {
        this.error = stripVTControlCharacters(
          error instanceof Error
            ? error.message
            : 'Could not save the naming model.',
        );
        this.notifyError(this.error);
      }
    } finally {
      this.pending = false;
      if (!this.closed) this.renderAgain();
    }
  }
  handleInput(data: string) {
    if (matchesKey(data, Key.escape)) this.done();
    else if (!this.pending) {
      if (data === '[') this.detailPage = Math.max(0, this.detailPage - 1);
      else if (data === ']')
        this.detailPage = Math.min(this.detailPages - 1, this.detailPage + 1);
      else if (
        this.keys.matches(data, 'tui.select.up') ||
        this.keys.matches(data, 'tui.select.down') ||
        this.keys.matches(data, 'tui.select.confirm')
      )
        this.choices.handleInput(data);
      else {
        this.search.handleInput(data);
        this.choices = this.createChoices(this.search.getValue());
        this.detailPage = 0;
      }
    }
    this.renderAgain();
  }
  render(width: number) {
    const detail = wrapTextWithAnsi(
      this.choices.getSelectedItem()?.label ?? 'No matching models',
      width,
    );
    this.detailPages = Math.max(1, Math.ceil(detail.length / 2));
    this.detailPage = Math.min(this.detailPage, this.detailPages - 1);
    const slice = detail.slice(this.detailPage * 2, this.detailPage * 2 + 2);
    const choices = this.choices.render(width);
    return [
      this.theme.bold('Naming model'),
      'Uses existing Pi authentication.',
      '',
      ...this.search.render(width),
      '',
      ...choices,
      ...Array<string>(Math.max(0, 5 - choices.length)).fill(''),
      ...slice,
      ...Array<string>(2 - slice.length).fill(''),
      this.detailPages > 1
        ? `[ / ] Full model · ${this.detailPage + 1}/${this.detailPages}`
        : '',
      truncateToWidth(this.theme.fg('error', this.error), width),
      '',
      this.theme.fg(
        'dim',
        `Type to search · ${keyText('tui.select.confirm')} Save · Esc Back`,
      ),
    ];
  }
  invalidate() {
    this.search.invalidate();
    this.choices.invalidate();
  }
  dispose() {
    this.closed = true;
  }
}
