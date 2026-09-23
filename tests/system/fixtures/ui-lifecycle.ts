import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';

// Exercise public session actions without replacing product event handlers.
export default function (pi: ExtensionAPI) {
  const points = new Map<string, string>();
  pi.registerCommand('lifecycle-mark', {
    description: 'Remember the current test branch leaf',
    handler: async (label, ctx) => {
      const leaf = ctx.sessionManager.getLeafId();
      if (!leaf) throw new Error('Expected a persisted leaf');
      points.set(label.trim(), leaf);
      ctx.ui.notify(`MARKED:${label.trim()}`, 'info');
    },
  });
  pi.registerCommand('lifecycle-tree', {
    description: 'Navigate to a remembered test branch leaf',
    handler: async (label, ctx) => {
      const point = points.get(label.trim());
      if (!point) throw new Error('Missing test branch point');
      await ctx.navigateTree(point, {summarize: false});
    },
  });
  pi.registerCommand('lifecycle-fork', {
    description: 'Fork before the latest test user message',
    handler: async (_args, ctx) => {
      const entry = ctx.sessionManager
        .getBranch()
        .findLast(
          entry => entry.type === 'message' && entry.message.role === 'user',
        );
      if (!entry) throw new Error('Missing user message');
      await ctx.fork(entry.id);
    },
  });
}
