import {type ExtensionAPI, VERSION} from '@earendil-works/pi-coding-agent';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Effect} from 'effect';
import {resolveExa} from '../../../src/web/exa-auth';

// Test-only controls/observations. Never substitutes the extension's registration or I/O.
export default function (pi: ExtensionAPI) {
  pi.on('session_info_changed', async (_event, ctx) => {
    await Effect.runPromise(
      Effect.tryPromise({
        try: () =>
          writeFile(
            join(ctx.cwd, 'observed-session-name'),
            ctx.sessionManager.getSessionName() ?? '',
          ),
        catch: cause =>
          new Error('Could not record native session name', {cause}),
      }),
    );
  });
  pi.registerCommand('host-fork', {
    description:
      'Offline acceptance fixture: fork before or at the opening request',
    handler: async (position, ctx) => {
      const target = ctx.sessionManager
        .getEntries()
        .find(
          entry => entry.type === 'message' && entry.message.role === 'user',
        );
      if (!target) throw new Error('Fixture requires a user entry');
      await ctx.fork(target.id, {
        position: position === 'before' ? 'before' : 'at',
        withSession: async next => {
          next.ui.notify('HOST_FORK_READY', 'info');
        },
      });
    },
  });
  pi.registerCommand('host-tree', {
    description:
      'Offline acceptance fixture: navigate to the opening user entry',
    handler: async (_args, ctx) => {
      const target = ctx.sessionManager
        .getEntries()
        .find(
          entry => entry.type === 'message' && entry.message.role === 'user',
        );
      if (!target) throw new Error('Fixture requires a user entry');
      await ctx.navigateTree(target.id, {summarize: false});
      ctx.ui.notify('HOST_TREE_READY', 'info');
    },
  });
  pi.registerCommand('host-parent-session', {
    description:
      'Offline acceptance fixture: create a parent-linked native session',
    handler: async (_args, ctx) => {
      const parentSession = ctx.sessionManager.getSessionFile();
      if (!parentSession)
        throw new Error('Fixture requires a persistent session');
      await ctx.newSession({
        parentSession,
        withSession: async next => {
          next.ui.notify('HOST_PARENT_SESSION', 'info');
        },
      });
    },
  });
  pi.registerCommand('host-provider', {
    description:
      'Offline acceptance fixture: remove or restore model authentication',
    handler: async (action, ctx) => {
      if (action === 'off') {
        pi.registerProvider('fixture', {apiKey: '$PI_FIXTURE_MISSING_KEY'});
      } else pi.unregisterProvider('fixture');
      await ctx.modelRegistry.refresh({allowNetwork: false});
      ctx.ui.notify(`HOST_PROVIDER_${action}`, 'info');
    },
  });
  pi.registerCommand('host-runtime', {
    description: 'Offline acceptance fixture: report the executing host',
    handler: async (_args, ctx) => {
      ctx.ui.notify(`HOST_RUNTIME:pi=${VERSION}:bun=${Bun.version}`, 'info');
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
