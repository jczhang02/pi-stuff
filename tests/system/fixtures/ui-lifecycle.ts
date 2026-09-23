import {
  SessionManager,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';

import {Schema} from 'effect';

// Exercise public session actions without replacing product event handlers.
export default function (pi: ExtensionAPI) {
  const points = new Map<string, string>();
  pi.on('session_before_compact', event => {
    if (event.customInstructions !== 'fixture-split-retrieval') return;
    // A supported mid-turn cut: retain the second call and its following results.
    const kept = event.branchEntries.filter(
      entry =>
        entry.type === 'message' &&
        entry.message.role === 'assistant' &&
        entry.message.content.some(block => block.type === 'toolCall'),
    )[1];
    if (!kept) throw new Error('Missing second tool call for compaction');
    return {
      compaction: {
        summary: 'FIXTURE_COMPACTION_SUMMARY',
        firstKeptEntryId: kept.id,
        tokensBefore: event.preparation.tokensBefore,
      },
    };
  });
  pi.registerCommand('lifecycle-compacted-history', {
    description:
      'Replay recorded tool messages around a native compaction entry',
    handler: async (_args, ctx) => {
      const saved = SessionManager.create(
        ctx.cwd,
        ctx.sessionManager.getSessionDir(),
      );
      let firstCall: string | undefined;
      let calls = 0;
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== 'message') continue;
        const message = entry.message;
        // Newer hosts persist system-prompt snapshots. Replay conversational
        // records only; the destination session owns its system context.
        if (Schema.is(Schema.Struct({role: Schema.Literal('system')}))(message))
          continue;
        if (
          message.role === 'assistant' &&
          message.content.some(block => block.type === 'toolCall')
        ) {
          calls++;
          if (calls === 3 && firstCall)
            saved.appendCompaction('FIXTURE_BOUNDARY_SUMMARY', firstCall, 100);
          const id = saved.appendMessage(message);
          firstCall ??= id;
        } else if (
          message.role === 'user' ||
          message.role === 'assistant' ||
          message.role === 'toolResult'
        )
          saved.appendMessage(message);
        else throw new Error('Unexpected message in tool-history fixture');
      }
      const file = saved.getSessionFile();
      if (!file) throw new Error('Missing replayed session file');
      await ctx.switchSession(file);
    },
  });
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
