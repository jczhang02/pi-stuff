import {
  type KeybindingsManager,
  ExtensionSelectorComponent,
  getSettingsListTheme,
  type ExtensionContext,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  Container,
  SettingsList,
  type Focusable,
  type TUI,
} from '@earendil-works/pi-tui';
import {Schema} from 'effect';
import {stripVTControlCharacters} from 'node:util';
import {DEFAULT_NAMING_PROMPT, NamingSettings} from './settings';
import type {NamingRuntime} from './register';
import {NamingTextEditor} from './editors';
import {PanelPage} from '../pi/panel-layout';

// Owns saves and native subviews; no selection, editing or cancel key handling.
export class NamingSettingsPanel extends Container implements Focusable {
  private readonly list: SettingsList;
  private editor: NamingTextEditor | undefined;
  private control: PanelPage | NamingTextEditor | ExtensionSelectorComponent;
  private saving = false;
  private closed = false;
  private active = false;
  get focused() {
    return this.active;
  }
  set focused(value: boolean) {
    this.active = value;
    if (this.editor) this.editor.focused = value;
  }

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keys: KeybindingsManager,
    private readonly ctx: ExtensionContext,
    private readonly runtime: NamingRuntime,
    private readonly save: (settings: NamingSettings) => Promise<void>,
    back: () => void,
    private readonly notifyError: (message: string) => void,
  ) {
    super();
    this.list = new SettingsList(
      [
        {
          id: 'automatic',
          label: 'Automatic naming',
          description:
            'Name the opening exchange once. Enabling this does not rearm the current session.',
          currentValue: '',
          values: ['enabled', 'disabled'],
        },
        {
          id: 'model',
          label: 'Naming model',
          description:
            'Use the current session model or choose another authenticated model.',
          currentValue: '',
          values: ['Open'],
        },
        {
          id: 'prompt',
          label: 'Naming rules',
          description: 'Edit the instructions used to generate a session name.',
          currentValue: '',
          values: ['Open'],
        },
        {
          id: 'maxLength',
          label: 'Maximum length',
          description:
            'Positive number of Unicode characters. Overlong names are rejected.',
          currentValue: '',
          values: ['Open'],
        },
        {
          id: 'reset',
          label: 'Restore defaults',
          description:
            'Restore all settings or an individual rule or length default. Keep the current name.',
          currentValue: 'Open',
          values: ['Open'],
        },
      ],
      5,
      getSettingsListTheme(),
      (id, value) => {
        if (this.saving) {
          this.refresh();
          return;
        }
        if (id === 'automatic')
          void this.persist({
            ...runtime.settings,
            automatic: value === 'enabled',
          }).catch(error => this.report(error));
        else if (id === 'model') this.openModel();
        else if (id === 'prompt' || id === 'maxLength') this.openText(id);
        else if (id === 'reset') this.resetDefaults();
      },
      back,
      {enableSearch: true},
    );
    this.control = new PanelPage(theme, 'AutoName / Settings', this.list);
    this.addChild(this.control);
    this.refresh();
  }
  private openText(field: 'prompt' | 'maxLength') {
    this.editor = new NamingTextEditor(
      this.tui,
      this.keys,
      field === 'prompt' ? 'Naming rules' : 'Maximum length',
      field === 'prompt'
        ? (this.runtime.settings.prompt ?? DEFAULT_NAMING_PROMPT)
        : String(this.runtime.settings.maxLength ?? 80),
      field === 'prompt',
      async value => {
        const next = {...this.runtime.settings};
        if (field === 'prompt') {
          if (!value.trim())
            throw new Error('Enter naming rules or restore their default.');
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
      () => this.showSettings(),
      this.notifyError,
    );
    this.show(this.editor);
    this.focused = this.active;
  }
  private openModel() {
    const models = this.ctx.modelRegistry
      .getAvailable()
      .map(model => ({provider: model.provider, id: model.id}));
    const selected = this.runtime.settings.model;
    if (
      selected &&
      !models.some(
        model =>
          model.provider === selected.provider && model.id === selected.id,
      )
    )
      models.unshift(selected);
    const list = new SettingsList(
      [
        {
          id: 'current',
          label: 'Use current session model',
          currentValue: '',
          values: ['Select'],
        },
        ...models.map((model, i) => ({
          id: String(i),
          label: stripVTControlCharacters(`${model.provider}/${model.id}`),
          description: stripVTControlCharacters(
            `${model.provider}/${model.id}`,
          ),
          currentValue: '',
          values: ['Select'],
        })),
      ],
      4,
      getSettingsListTheme(),
      id => {
        if (this.saving) return;
        const next = {...this.runtime.settings};
        const model = id === 'current' ? undefined : models[Number(id)];
        if (model) next.model = model;
        else delete next.model;
        const view = this.control;
        void this.persist(next)
          .then(() => {
            if (!this.closed && this.control === view) this.showSettings();
          })
          .catch(error => this.report(error));
      },
      () => this.showSettings(),
      {enableSearch: true},
    );
    list.selectItem(
      selected
        ? String(
            models.findIndex(
              model =>
                model.provider === selected.provider &&
                model.id === selected.id,
            ),
          )
        : 'current',
    );
    this.show(
      new PanelPage(
        this.theme,
        'Naming model',
        list,
        'Search models. Uses existing Pi authentication.',
      ),
    );
  }
  private resetDefaults() {
    this.show(
      new ExtensionSelectorComponent(
        'Restore defaults',
        ['All naming settings', 'Naming rules only', 'Maximum length only'],
        option => {
          this.show(
            new ExtensionSelectorComponent(
              'Restore naming defaults? The current session name will stay.',
              ['Yes', 'No'],
              answer => {
                if (answer === 'No') {
                  this.showSettings();
                  return;
                }
                if (this.saving) return;
                const next =
                  option === 'All naming settings'
                    ? {}
                    : {...this.runtime.settings};
                if (option === 'Naming rules only') delete next.prompt;
                if (option === 'Maximum length only') delete next.maxLength;
                const view = this.control;
                void this.persist(next)
                  .then(() => {
                    if (!this.closed && this.control === view)
                      this.showSettings();
                  })
                  .catch(error => this.report(error));
              },
              () => this.showSettings(),
            ),
          );
        },
        () => this.showSettings(),
      ),
    );
  }
  private show(
    control: PanelPage | NamingTextEditor | ExtensionSelectorComponent,
  ) {
    this.control = control;
    this.clear();
    this.addChild(control);
    this.tui.requestRender();
  }
  private showSettings() {
    this.editor?.dispose();
    this.editor = undefined;
    this.refresh();
    this.show(new PanelPage(this.theme, 'AutoName / Settings', this.list));
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
    if (this.closed || this.saving)
      throw new Error('A naming setting is already being saved.');
    this.saving = true;
    try {
      await this.save(Schema.decodeUnknownSync(NamingSettings)(settings));
    } finally {
      this.saving = false;
      if (!this.closed) {
        this.refresh();
        this.tui.requestRender();
      }
    }
  }
  private report(error: Error) {
    this.notifyError(stripVTControlCharacters(error.message));
  }
  handleInput(data: string) {
    this.control.handleInput(data);
  }
  dispose() {
    this.closed = true;
    this.editor?.dispose();
    if (this.control instanceof ExtensionSelectorComponent)
      this.control.dispose();
  }
}
