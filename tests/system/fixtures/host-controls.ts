import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Effect} from 'effect';
import {resolveExa} from '../../../src/web/exa-auth';

// Test-only controls/observations. Never substitutes the extension's registration or I/O.
export default function (pi: ExtensionAPI) {
  pi.registerCommand('host-theme', {
    description: 'Offline acceptance fixture: select a native Pi theme',
    handler: async (name, ctx) => {
      const result = ctx.ui.setTheme(name.trim());
      ctx.ui.notify(
        result.success
          ? `HOST_THEME:${name.trim()}`
          : (result.error ?? 'Theme failed'),
        result.success ? 'info' : 'error',
      );
    },
  });
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
  pi.registerCommand('host-reload', {
    description:
      'Offline acceptance fixture: reload and emit a completion marker',
    handler: async (label, ctx) => {
      const completed = join(ctx.cwd, 'reload-ready');
      await ctx.reload();
      // Reload invalidates ctx. A private fixture file acknowledges completion
      // without using stale UI or matching a previous "Reloaded" notification.
      await Effect.runPromise(
        Effect.tryPromise({
          try: () => writeFile(completed, label),
          catch: cause =>
            new Error('Could not acknowledge fixture reload', {cause}),
        }),
      );
    },
  });
}
