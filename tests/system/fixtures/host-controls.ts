import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {Effect} from 'effect';
import {resolveExa} from '../../../src/pi/exa';

// Test-only controls/observations. Never substitutes the extension's registration or I/O.
export default function (pi: ExtensionAPI) {
  pi.registerCommand('host-auth', {
    description:
      'Offline acceptance fixture: inspect synthetic Exa authentication',
    handler: async (label, ctx) => {
      const key = await Effect.runPromise(resolveExa(ctx.modelRegistry));
      const source =
        key === 'fixture-stored-key'
          ? 'stored'
          : key === 'fixture-next-key'
            ? 'changed'
            : key === 'fixture-env-key'
              ? 'env'
              : key === undefined
                ? 'missing'
                : 'unexpected';
      const models = ctx.modelRegistry
        .getAll()
        .filter(model => model.provider === 'exa');
      ctx.ui.notify(
        `HOST_AUTH_${label}:${source}:exaModels=${models.length}:model=${ctx.model?.provider}/${ctx.model?.id}`,
        'info',
      );
    },
  });
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
