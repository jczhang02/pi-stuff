import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {join} from 'node:path';
import {Effect, Schema} from 'effect';

export class SubagentError extends Schema.TaggedError<SubagentError>()(
  'SubagentError',
  {message: Schema.String},
) {}

export interface Investigation {
  agent: string;
  task: string;
  cwd: string;
}

// Behavioral source: arhen/pi-extensions 676b11e, pi-core-subagent 1.3.55.
// See LICENSE in this directory. Read-only work uses the current checkout.
export function investigate(
  input: Investigation,
  parent: ExtensionContext,
  signal: AbortSignal | undefined,
) {
  return Effect.tryPromise({
    async try() {
      signal?.throwIfAborted();
      if (!parent.model)
        throw new SubagentError({message: 'Select a parent model first.'});
      const agentDir = getAgentDir();
      const modelRuntime = await ModelRuntime.create({
        authPath: join(agentDir, 'auth.json'),
        modelsPath: join(agentDir, 'models.json'),
      });
      for (const id of parent.modelRegistry.getRegisteredProviderIds()) {
        const native = parent.modelRegistry.getRegisteredNativeProvider(id);
        if (native) modelRuntime.registerNativeProvider(native);
        else {
          const config = parent.modelRegistry.getRegisteredProviderConfig(id);
          if (config) modelRuntime.registerProvider(id, config);
        }
      }
      await modelRuntime.refresh({allowNetwork: false});
      const resourceLoader = new DefaultResourceLoader({
        cwd: input.cwd,
        agentDir,
        noExtensions: true,
        appendSystemPrompt: [
          'You are a read-only subagent. Inspect the assigned working directory and return your findings to the parent. Do not delegate.',
        ],
      });
      await resourceLoader.reload();
      signal?.throwIfAborted();
      const parentSession = parent.sessionManager.getSessionFile();
      const {session} = await createAgentSession({
        cwd: input.cwd,
        agentDir,
        modelRuntime,
        model: parent.model,
        tools: ['read', 'grep', 'find', 'ls'],
        resourceLoader,
        sessionManager: SessionManager.create(
          input.cwd,
          undefined,
          parentSession === undefined ? undefined : {parentSession},
        ),
      });
      let abort: Promise<void> | undefined;
      const cancel = () => {
        abort ??= session.abort();
      };
      signal?.addEventListener('abort', cancel, {once: true});
      const startedAt = Date.now();
      try {
        session.setSessionName(input.agent);
        await session.bindExtensions({mode: 'json'});
        signal?.throwIfAborted();
        await session.prompt(input.task, {
          source: 'extension',
          expandPromptTemplates: false,
        });
        signal?.throwIfAborted();
        const last = session.messages.findLast(
          message => message.role === 'assistant',
        );
        if (last?.role === 'assistant' && last.stopReason === 'error')
          throw new SubagentError({
            message: last.errorMessage ?? 'The child provider failed.',
          });
        return {
          status: 'completed' as const,
          agent: input.agent,
          task: input.task,
          cwd: input.cwd,
          startedAt,
          endedAt: Date.now(),
          sessionId: session.sessionId,
          sessionFile: session.sessionFile,
          tools: session.getActiveToolNames(),
          finalText:
            last?.role === 'assistant'
              ? last.content
                  .filter(part => part.type === 'text')
                  .map(part => part.text)
                  .join('\n')
              : '',
        };
      } finally {
        signal?.removeEventListener('abort', cancel);
        try {
          await (abort ?? session.abort());
        } finally {
          session.dispose();
        }
      }
    },
    catch: error =>
      error instanceof SubagentError
        ? error
        : new SubagentError({
            message: error instanceof Error ? error.message : String(error),
          }),
  });
}
