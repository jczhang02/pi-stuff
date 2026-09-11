import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';

// Only manipulates Pi's public tool selection, never the extension under test.
export default function (pi: ExtensionAPI) {
  pi.registerCommand('host-tools', {
    description: 'Offline acceptance fixture: choose active tools',
    handler: async (args, ctx) => {
      pi.setActiveTools(args.split(','));
      ctx.ui.notify(
        `HOST_SELECTION:${pi.getActiveTools().toSorted().join(',')}`,
        'info',
      );
    },
  });
}
