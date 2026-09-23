import {
  SessionManager,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import {Effect} from 'effect';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Observe public tool metadata and persisted results without intercepting execution.
export default function (pi: ExtensionAPI) {
  pi.registerCommand('ui-contract', {
    description: 'Record the host tool and stored-result contract',
    handler: async (_args, ctx) => {
      const tools = pi
        .getAllTools()
        .map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          promptGuidelines: tool.promptGuidelines,
        }))
        .toSorted((left, right) => left.name.localeCompare(right.name));
      const file = ctx.sessionManager.getSessionFile();
      if (!file) throw new Error('Missing persisted session');
      const results = SessionManager.open(file)
        .getBranch()
        .flatMap(entry => {
          if (entry.type !== 'message' || entry.message.role !== 'toolResult')
            return [];
          const {toolName, content, details, isError} = entry.message;
          return [{toolName, content, details, isError}];
        });
      await Effect.runPromise(
        Effect.tryPromise({
          try: () =>
            writeFile(
              join(ctx.cwd, 'contract.json'),
              JSON.stringify({tools, results}),
            ),
          catch: cause => new Error('Could not record tool contract', {cause}),
        }),
      );
      ctx.ui.notify('CONTRACT_RECORDED', 'info');
    },
  });
}
