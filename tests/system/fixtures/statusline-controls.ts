import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';

// Public host controls supply external status messages and native lifecycle actions.
export default function (pi: ExtensionAPI) {
  pi.registerCommand('status-fixture', {
    description: 'Offline statusline acceptance controls',
    handler: async (action, ctx) => {
      if (action === 'colors') {
        ctx.ui.setStatus(
          'colors',
          (['accent', 'warning', 'error', 'text'] as const)
            .map(color => ctx.ui.theme.fg(color, color))
            .join(' '),
        );
      } else if (action === 'takeover') {
        ctx.ui.setFooter(() => ({
          render: () => ['OTHER_FOOTER', ''],
          invalidate() {},
        }));
      } else if (action === 'clear') {
        ctx.ui.setStatus('z-last', undefined);
        ctx.ui.setStatus('a-first', undefined);
      } else if (action === 'segments') {
        ctx.ui.setStatus('z-last', 'ProviderCase');
        ctx.ui.setStatus('a-first', ctx.ui.theme.fg('success', 'ThirdParty'));
      } else if (action === 'light' || action === 'dark') {
        ctx.ui.setTheme(action);
      } else if (action === 'model') {
        const model = ctx.modelRegistry.find('fixture', 'naming');
        if (!model || !(await pi.setModel(model)))
          throw new Error('Fixture model unavailable');
      } else if (action === 'compact') {
        await new Promise<void>((resolve, reject) =>
          ctx.compact({onComplete: () => resolve(), onError: reject}),
        );
      }
      ctx.ui.notify(`STATUS_READY_${action}`, 'info');
    },
  });
}
