import {
  CustomEditor,
  getSettingsListTheme,
  type ExtensionContext,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import {SettingsList} from '@earendil-works/pi-tui';
import {PanelPage} from '../pi/panel-layout';
import {EditorMatcher} from './matcher';
import {decorateEditor} from './decorate';
import type {EditorSettings} from './settings';

type EditorFactory = NonNullable<
  ReturnType<ExtensionContext['ui']['getEditorComponent']>
>;

export function registerEditor(
  pi: ExtensionAPI,
  current: () => EditorSettings,
  save: (settings: EditorSettings) => Promise<void>,
) {
  let settings = current();
  let matcher: EditorMatcher | undefined;
  let factory: EditorFactory | undefined;
  let previous: EditorFactory | undefined;
  let redraw = () => {};
  let reported = false;
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI) return;
    if (factory && ctx.ui.getEditorComponent() === factory) return;
    previous = ctx.ui.getEditorComponent();
    factory = (tui, theme, keys) => {
      matcher?.close();
      const options = {paddingX: 0, embedWorkingStatus: true};
      const editor =
        previous?.(tui, theme, keys) ??
        new CustomEditor(tui, theme, keys, options);
      redraw = () => tui.requestRender();
      if (!(editor instanceof CustomEditor)) return editor;
      matcher = new EditorMatcher(settings, redraw);
      decorateEditor(editor, matcher, () => settings.enabled !== false);
      return editor;
    };
    ctx.ui.setEditorComponent(factory);
    if (!reported && matcher?.invalid.length) {
      reported = true;
      ctx.ui.notify(
        `Invalid editor keyword regex at entries ${matcher.invalid.join(', ')}. These entries were skipped. Correct pi-stuff.json and /reload.`,
        'error',
      );
    }
  });
  pi.on('session_shutdown', (event, ctx) => {
    if (event.reason !== 'quit' && event.reason !== 'reload') return;
    matcher?.close();
    if (ctx.hasUI && ctx.ui.getEditorComponent() === factory)
      ctx.ui.setEditorComponent(previous);
  });
  pi.registerCommand('editor', {
    description: 'Editor highlighting settings',
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      let saving = false;
      await ctx.ui.custom<void>((tui, theme, _keys, done) => {
        const list = new SettingsList(
          [
            {
              id: 'enabled',
              label: 'Skill and keyword colors',
              description:
                'Static retro highlighting in the editor. Edit keyword regex in pi-stuff.json and /reload.',
              currentValue: settings.enabled === false ? 'disabled' : 'enabled',
              values: ['enabled', 'disabled'],
            },
          ],
          1,
          getSettingsListTheme(),
          (_id, value) => {
            if (saving) {
              list.updateValue(
                'enabled',
                settings.enabled === false ? 'disabled' : 'enabled',
              );
              return;
            }
            saving = true;
            void save({...settings, enabled: value === 'enabled'})
              .catch(error =>
                ctx.ui.notify(
                  error instanceof Error ? error.message : String(error),
                  'error',
                ),
              )
              .finally(() => {
                settings = current();
                redraw();
                saving = false;
                list.updateValue(
                  'enabled',
                  settings.enabled === false ? 'disabled' : 'enabled',
                );
                tui.requestRender();
              });
          },
          () => done(),
          {enableSearch: false},
        );
        return new PanelPage(theme, 'Editor', list);
      });
    },
  });
}
