// Throwaway UI evaluation. Settings live only in this extension instance.
import {
  DynamicBorder,
  getSelectListTheme,
  getSettingsListTheme,
  keyHint,
  rawKeyHint,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  Container,
  SelectList,
  SettingsList,
  Spacer,
  Text,
} from '@earendil-works/pi-tui';
import {DEFAULT_NAMING_PROMPT} from './settings';

// Assembly only. Native lists own every key and mouse interaction.
class NativeListPage extends Container {
  constructor(
    title: string,
    summary: string,
    theme: Theme,
    private readonly list: SelectList | SettingsList,
  ) {
    super();
    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg('accent', theme.bold(title)), 1, 0));
    this.addChild(new Spacer(1));
    if (summary) {
      this.addChild(new Text(summary, 1, 0));
      this.addChild(new Spacer(1));
    }
    this.addChild(list);
    if (list instanceof SelectList) {
      this.addChild(new Spacer(1));
      this.addChild(
        new Text(
          `${rawKeyHint('↑↓', 'navigate')}  ${keyHint('tui.select.confirm', 'select')}  ${keyHint('tui.select.cancel', 'back')}`,
          1,
          0,
        ),
      );
    }
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());
  }
  handleInput(data: string) {
    this.list.handleInput(data);
  }
}

export function registerNativeNamingPrototype(pi: ExtensionAPI) {
  let automatic = true;
  let model: string | undefined;
  let prompt = DEFAULT_NAMING_PROMPT;
  let maxLength = 80;
  const generatedName = 'research: Compare OAuth provider compatibility';

  async function settings(ctx: ExtensionContext) {
    let selected = 'automatic';
    while (true) {
      const action = await ctx.ui.custom<string | undefined>(
        (_tui, theme, _keys, done) => {
          const list = new SettingsList(
            [
              {
                id: 'automatic',
                label: 'Automatic naming',
                description: 'Name the opening exchange once.',
                currentValue: automatic ? 'enabled' : 'disabled',
                values: ['enabled', 'disabled'],
              },
              {
                id: 'model',
                label: 'Naming model',
                description:
                  'Use the current session model or choose another model.',
                currentValue: model ?? 'current session',
                values: ['Open'],
              },
              {
                id: 'rules',
                label: 'Naming rules',
                description:
                  'Edit the instructions used to generate a session name.',
                currentValue:
                  prompt === DEFAULT_NAMING_PROMPT ? 'default' : 'custom',
                values: ['Open'],
              },
              {
                id: 'length',
                label: 'Maximum length',
                description: 'Maximum number of Unicode characters.',
                currentValue: String(maxLength),
                values: ['Open'],
              },
              {
                id: 'reset',
                label: 'Restore defaults',
                description:
                  'Reset naming settings. Keep the current session name.',
                currentValue: 'Open',
                values: ['Open'],
              },
            ],
            5,
            getSettingsListTheme(),
            (id, value) => {
              selected = id;
              if (id === 'automatic') automatic = value === 'enabled';
              else done(id);
            },
            () => done(undefined),
            {enableSearch: true},
          );
          list.selectItem(selected);
          return new NativeListPage('AutoName / Settings', '', theme, list);
        },
      );
      if (action === undefined) return;
      if (action === 'model') {
        const choice = await ctx.ui.custom<string | undefined>(
          (_tui, theme, _keys, done) => {
            const models = ctx.modelRegistry
              .getAvailable()
              .map(item => `${item.provider}/${item.id}`);
            const list = new SettingsList(
              [
                {
                  id: 'current',
                  label: 'Use current session model',
                  currentValue: model === undefined ? 'selected' : '',
                  values: ['Select'],
                },
                ...models.map(value => ({
                  id: value,
                  label: value,
                  currentValue: model === value ? 'selected' : '',
                  values: ['Select'],
                })),
              ],
              8,
              getSettingsListTheme(),
              id => done(id),
              () => done(undefined),
              {enableSearch: true},
            );
            list.selectItem(model ?? 'current');
            return new NativeListPage(
              'Naming model',
              'Uses existing Pi authentication.',
              theme,
              list,
            );
          },
        );
        if (choice !== undefined)
          model = choice === 'current' ? undefined : choice;
      } else if (action === 'rules') {
        const value = await ctx.ui.editor('Naming rules', prompt);
        if (value !== undefined) {
          if (value.trim()) prompt = value;
          else ctx.ui.notify('Naming rules cannot be empty.', 'error');
        }
      } else if (action === 'length') {
        const value = await ctx.ui.input(
          `Maximum length (current: ${maxLength})`,
        );
        if (value !== undefined) {
          const next = Number(value);
          if (/^[1-9]\d*$/u.test(value) && Number.isSafeInteger(next))
            maxLength = next;
          else ctx.ui.notify('Enter a positive whole number.', 'error');
        }
      } else if (
        action === 'reset' &&
        (await ctx.ui.confirm(
          'Restore naming defaults?',
          'The current session name will stay.',
        ))
      ) {
        automatic = true;
        model = undefined;
        prompt = DEFAULT_NAMING_PROMPT;
        maxLength = 80;
      }
    }
  }

  function generate(ctx: ExtensionContext) {
    const hasDialogue = ctx.sessionManager
      .getBranch()
      .some(entry => entry.type === 'message' && entry.message.role === 'user');
    if (!hasDialogue) {
      ctx.ui.notify(
        'No dialogue to name yet. Start a task, then use /autoname.',
        'error',
      );
      return;
    }
    if (Array.from(generatedName).length > maxLength) {
      ctx.ui.notify('Generated name exceeds the maximum length.', 'error');
      return;
    }
    pi.setSessionName(generatedName);
  }

  pi.registerCommand('autoname', {
    description: 'Generate a session name, or open the AutoName panel',
    handler: async (args, ctx) => {
      if (args.trim() !== 'panel') {
        generate(ctx);
        return;
      }
      while (true) {
        const action = await ctx.ui.custom<string | undefined>(
          (_tui, theme, _keys, done) => {
            const menu = new SelectList(
              [
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
              ],
              2,
              getSelectListTheme(),
            );
            menu.onSelect = item => done(item.value);
            menu.onCancel = () => done(undefined);
            return new NativeListPage(
              'AutoName',
              `Configure automatic naming and name this session.\n\nCurrent name\n${ctx.sessionManager.getSessionName() ?? 'No name yet'}`,
              theme,
              menu,
            );
          },
        );
        if (action === undefined) return;
        if (action === 'settings') await settings(ctx);
        else generate(ctx);
      }
    },
  });
}
