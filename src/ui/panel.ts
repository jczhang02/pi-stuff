import {
  getSettingsListTheme,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import {
  Container,
  Text,
  SettingsList,
  Key,
  matchesKey,
} from '@earendil-works/pi-tui';
import {Schema} from 'effect';
import {ConfigurationError} from '../pi/configuration';
import {UiSettings} from './settings';

const options = [
  {id: 'enabled', label: 'New UI', defaultValue: true},
  {id: 'retrievalGroups', label: 'Retrieval groups', defaultValue: true},
  {id: 'writePreviewLines', label: 'Write preview rows', defaultValue: 3},
  {id: 'editPreviewLines', label: 'Edit preview rows', defaultValue: 6},
  {id: 'bashPreviewLines', label: 'Bash preview rows', defaultValue: 3},
  {id: 'bashRunningPreviewLines', label: 'Running Bash rows', defaultValue: 2},
  {id: 'welcome', label: 'Welcome page', defaultValue: true},
  {id: 'codeHighlighting', label: 'Code highlighting', defaultValue: true},
  {id: 'diffLineNumbers', label: 'Diff line numbers', defaultValue: true},
  {id: 'diffBackgrounds', label: 'Diff backgrounds', defaultValue: true},
] as const;

export function registerUiPanel(
  pi: ExtensionAPI,
  current: () => UiSettings,
  save: (settings: UiSettings) => Promise<void>,
): void {
  pi.registerCommand('ui', {
    description: 'Configure global conversation UI settings',
    handler: async (_args, ctx) => {
      if (ctx.mode !== 'tui') {
        ctx.ui.notify('/ui requires TUI mode', 'error');
        return;
      }
      await ctx.ui.custom<void>((tui, theme, keys, done) => {
        const body = new Container();
        body.addChild(
          new Text(
            theme.fg('accent', theme.bold('Conversation UI settings')),
            0,
            1,
          ),
        );
        body.addChild(
          new Text(
            'Global settings. Theme and Hide thinking stay in Pi settings.',
            0,
            0,
          ),
        );
        const feedback = new Text('', 0, 1);
        let saving = false;
        let closed = false;
        const values = options.map(option => ({
          id: option.id,
          label: option.label,
          currentValue: String(current()[option.id] ?? option.defaultValue),
          values:
            option.defaultValue === true
              ? ['true', 'false']
              : [
                  ...new Set([
                    0,
                    1,
                    2,
                    3,
                    6,
                    10,
                    Number(current()[option.id] ?? option.defaultValue),
                  ]),
                ]
                  .sort((a, b) => a - b)
                  .map(String),
        }));
        const list = new SettingsList(
          values,
          6,
          {
            ...getSettingsListTheme(),
            hint: () =>
              theme.fg('dim', '↑↓ Navigate · Enter Change · Esc Close'),
          },
          (id, value) => {
            void change(id, value);
          },
          done,
        );
        body.addChild(list);
        body.addChild(feedback);
        async function change(id: string, value: string) {
          const option = options.find(option => option.id === id);
          if (!option || saving) return;
          saving = true;
          feedback.setText(theme.fg('muted', 'Saving…'));
          tui.requestRender();
          try {
            const decoded =
              option.defaultValue === true ? value === 'true' : Number(value);
            const next = Schema.decodeUnknownSync(UiSettings)({
              ...current(),
              [option.id]: decoded,
            });
            await save(next);
            feedback.setText(theme.fg('muted', 'Saved. /reload to apply.'));
          } catch (error) {
            feedback.setText(
              theme.fg(
                'error',
                Schema.is(ConfigurationError)(error)
                  ? error.message
                  : 'Could not save UI settings. /reload to verify.',
              ),
            );
          } finally {
            // A rename may have committed even if lock cleanup then failed.
            list.updateValue(
              option.id,
              String(current()[option.id] ?? option.defaultValue),
            );
            saving = false;
            if (!closed) tui.requestRender();
          }
        }
        return {
          render: width => body.render(width),
          invalidate: () => body.invalidate(),
          handleMouse: event =>
            saving ? {handled: true} : body.handleMouse(event),
          handleInput(data) {
            if (matchesKey(data, Key.escape)) {
              closed = true;
              done();
              return;
            }
            if (saving || keys.matches(data, 'tui.select.cancel')) return;
            list.handleInput(data);
            tui.requestRender();
          },
          dispose() {
            closed = true;
          },
        };
      });
    },
  });
}
