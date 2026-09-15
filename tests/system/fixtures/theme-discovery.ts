import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  pi.registerCommand('theme-discovery', {
    description: 'Offline acceptance fixture: inspect loaded themes',
    handler: async (_args, ctx) => {
      const names = ctx.ui
        .getAllThemes()
        .map(theme => theme.name)
        .toSorted()
        .join(',');
      ctx.ui.notify(`THEMES_DISCOVERY:${names}`, 'info');
    },
  });
  pi.registerCommand('theme-state', {
    description: 'Offline acceptance fixture: inspect the active theme',
    handler: async (args, ctx) => {
      ctx.ui.notify(
        `THEME_ACTIVE:${ctx.ui.theme.name ?? '<unnamed>'}:REQUEST:${args.trim()}:END`,
        'info',
      );
    },
  });
}
