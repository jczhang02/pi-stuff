import {
  getSelectListTheme,
  keyText,
  getSettingsListTheme,
  type ExtensionContext,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  Key,
  matchesKey,
  SelectList,
  SettingsList,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type KeybindingsManager,
  type TUI,
} from '@earendil-works/pi-tui';
import {Schema} from 'effect';
import {stripVTControlCharacters} from 'node:util';
import {DEFAULT_NAMING_PROMPT, NamingSettings} from './settings';
import type {NamingRuntime} from './register';
import {NamingModelPicker, TextSettingEditor} from './editors';

const descriptions = {
  automatic:
    'Name the opening exchange once. Enabling this does not rearm the current session.',
  model:
    'Independent of the conversation model; uses existing Pi authentication.',
  prompt:
    'Edit the full style instructions or restore the built-in English rules.',
  maxLength:
    'Positive number of Unicode characters. Overlong names are rejected.',
  reset: 'Reset naming configuration. Keep the current session name.',
};

// Owns unsubmitted editors and serializes field saves. Runtime changes only after
// the configuration file owner commits; failed saves restore the displayed value.
export class NamingSettingsPanel implements Component, Focusable {
  private readonly list: SettingsList;
  private readonly reset: SelectList;
  private editor: NamingModelPicker | TextSettingEditor | undefined;
  private resetting = false;
  private saving = false;
  private closed = false;
  private error = '';
  private active = false;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keys: KeybindingsManager,
    ctx: ExtensionContext,
    private readonly runtime: NamingRuntime,
    private readonly save: (settings: NamingSettings) => Promise<void>,
    private readonly back: () => void,
    private readonly notifyError: (message: string) => void,
  ) {
    const openText = (field: 'prompt' | 'maxLength', close: () => void) => {
      this.editor = new TextSettingEditor(
        tui,
        theme,
        field === 'prompt' ? 'Naming rules' : 'Maximum length',
        field === 'prompt'
          ? (runtime.settings.prompt ?? DEFAULT_NAMING_PROMPT)
          : String(runtime.settings.maxLength ?? 80),
        field === 'prompt',
        async value => {
          const next = {...runtime.settings};
          if (value === undefined) delete next[field];
          else if (field === 'prompt') {
            if (!value.trim())
              throw new Error('Enter naming rules or choose Use default.');
            next.prompt = value;
          } else {
            if (
              !/^[1-9]\d*$/u.test(value.trim()) ||
              !Number.isSafeInteger(Number(value))
            )
              throw new Error('Maximum length must be a positive integer.');
            next.maxLength = Number(value);
          }
          await this.persist(next);
        },
        () => this.closeEditor(close),
        () => this.renderAgain(),
        notifyError,
      );
      this.editor.focused = this.active;
      return this.editor;
    };
    this.list = new SettingsList(
      [
        {
          id: 'automatic',
          label: 'Automatic naming',
          description: descriptions.automatic,
          currentValue: '',
          values: ['enabled', 'disabled'],
        },
        {
          id: 'model',
          label: 'Naming model',
          description: descriptions.model,
          currentValue: '',
          submenu: (_value, close) => {
            this.editor = new NamingModelPicker(
              ctx,
              theme,
              keys,
              runtime.settings.model,
              async model => {
                const next = {...runtime.settings};
                if (model) next.model = model;
                else delete next.model;
                await this.persist(next);
              },
              () => this.closeEditor(close),
              () => this.renderAgain(),
              notifyError,
            );
            this.editor.focused = this.active;
            return this.editor;
          },
        },
        {
          id: 'prompt',
          label: 'Naming rules',
          description: descriptions.prompt,
          currentValue: '',
          submenu: (_value, close) => openText('prompt', close),
        },
        {
          id: 'maxLength',
          label: 'Maximum length',
          description: descriptions.maxLength,
          currentValue: '',
          submenu: (_value, close) => openText('maxLength', close),
        },
        {
          id: 'reset',
          label: 'Restore defaults',
          description: descriptions.reset,
          currentValue: 'Open',
          values: ['Open'],
        },
      ],
      5,
      {
        ...getSettingsListTheme(),
        hint: () =>
          theme.fg(
            'dim',
            `${keyText('tui.select.up')}/${keyText('tui.select.down')} Navigate · ${keyText('tui.select.confirm')} Change · Esc Back`,
          ),
      },
      (id, value) => {
        this.error = '';
        if (id === 'reset') {
          this.resetting = true;
          this.reset.setSelectedIndex(0);
        } else if (id === 'automatic')
          void this.persist({
            ...runtime.settings,
            automatic: value === 'enabled',
          }).catch(error =>
            this.report(
              error instanceof Error
                ? error
                : new Error('Could not save naming settings.'),
            ),
          );
      },
      back,
    );
    this.reset = new SelectList(
      [
        {value: 'cancel', label: 'Keep settings'},
        {value: 'reset', label: 'Restore naming defaults'},
      ],
      2,
      getSelectListTheme(),
    );
    this.reset.onSelect = item => {
      if (item.value === 'cancel') this.resetting = false;
      else
        void this.persist({})
          .then(() => {
            this.resetting = false;
            this.renderAgain();
          })
          .catch(error =>
            this.report(
              error instanceof Error
                ? error
                : new Error('Could not save naming settings.'),
            ),
          );
    };
    this.refresh();
  }
  get focused() {
    return this.active;
  }
  set focused(value: boolean) {
    this.active = value;
    if (this.editor) this.editor.focused = value;
  }
  private renderAgain() {
    if (!this.closed) this.tui.requestRender();
  }
  private closeEditor(close: () => void) {
    this.editor?.dispose();
    this.editor = undefined;
    close();
    this.refresh();
    this.renderAgain();
  }
  private refresh() {
    const settings = this.runtime.settings;
    this.list.updateValue(
      'automatic',
      settings.automatic === false ? 'disabled' : 'enabled',
    );
    this.list.updateValue(
      'model',
      settings.model
        ? stripVTControlCharacters(
            `${settings.model.provider}/${settings.model.id}`,
          )
        : 'current session',
    );
    this.list.updateValue(
      'prompt',
      settings.prompt === undefined ? 'default' : 'custom',
    );
    this.list.updateValue('maxLength', String(settings.maxLength ?? 80));
  }
  private async persist(settings: NamingSettings) {
    if (this.closed || this.saving) return;
    this.saving = true;
    this.error = '';
    try {
      await this.save(Schema.decodeUnknownSync(NamingSettings)(settings));
    } finally {
      this.saving = false;
      this.refresh();
      this.renderAgain();
    }
  }
  private report(error: Error) {
    const message = stripVTControlCharacters(error.message);
    this.notifyError(message);
    if (this.closed) return;
    this.error = message;
    this.renderAgain();
  }
  handleInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      if (this.editor) this.editor.handleInput(data);
      else if (this.resetting) {
        this.resetting = false;
        this.error = '';
      } else this.back();
    } else if (!this.saving && !this.keys.matches(data, 'tui.select.cancel')) {
      if (this.editor) this.editor.handleInput(data);
      else if (this.resetting) this.reset.handleInput(data);
      else this.list.handleInput(data);
    }
    this.renderAgain();
  }
  render(width: number) {
    if (this.editor) return this.editor.render(width);
    if (this.resetting)
      return [
        'Restore naming defaults?',
        '',
        'Automatic naming, current model, default English',
        'rules and an 80-character limit.',
        'The current session name will stay.',
        '',
        ...this.reset.render(width),
        truncateToWidth(this.theme.fg('error', this.error), width),
        '',
        `${keyText('tui.select.confirm')} Select · Esc Back`,
      ];
    const lines = this.list.render(width);
    const body = lines.slice(0, -1);
    const rows =
      7 +
      Math.max(
        ...Object.values(descriptions).map(
          text => wrapTextWithAnsi(text, width - 4).length,
        ),
      );
    return [
      ...body,
      ...Array<string>(Math.max(0, rows - body.length)).fill(''),
      truncateToWidth(this.theme.fg('error', this.error), width),
      lines.at(-1) ?? '',
    ];
  }
  invalidate() {
    this.list.invalidate();
    this.reset.invalidate();
  }
  dispose() {
    this.closed = true;
    this.editor?.dispose();
  }
}
