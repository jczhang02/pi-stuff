import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type ExtensionContext,
  type AgentSession,
  type ToolDefinition,
  type CreateAgentSessionOptions,
} from '@earendil-works/pi-coding-agent';
import {join} from 'node:path';
import {Effect, Schema} from 'effect';
import type {Api, Model} from '@earendil-works/pi-ai';
import type {ThinkingLevel} from '@earendil-works/pi-agent-core';

export class SubagentError extends Schema.TaggedError<SubagentError>()(
  'SubagentError',
  {message: Schema.String},
) {}

export interface Investigation {
  agent: string;
  task: string;
  cwd: string;
  prompt?: string;
  write: boolean;
  tools: string[];
  maxRuntimeMs: number;
  model: Model<Api>;
  thinking: ThinkingLevel | undefined;
}

// Behavioral source: arhen/pi-extensions 676b11e, pi-core-subagent 1.3.55.
// See LICENSE in this directory. Read-only work uses the current checkout.
export function investigate(
  input: Investigation,
  parent: ExtensionContext,
  signal: AbortSignal | undefined,
  customTools: ToolDefinition[],
  ready: (session: AgentSession) => void,
) {
  return Effect.tryPromise({
    async try() {
      signal?.throwIfAborted();
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
          input.write
            ? 'You are a subagent working in your own Git worktree. Return your findings and changes to the parent. Do not delegate. node_modules is shared with the parent project: do not install, delete, or modify dependencies.'
            : 'You are a read-only subagent. Inspect the assigned working directory and return your findings to the parent. Do not delegate.',
          ...(input.prompt === undefined ? [] : [input.prompt]),
        ],
      });
      await resourceLoader.reload();
      signal?.throwIfAborted();
      const parentSession = parent.sessionManager.getSessionFile();
      const options: CreateAgentSessionOptions = {
        cwd: input.cwd,
        agentDir,
        modelRuntime,
        model: input.model,
        tools: [...input.tools, ...customTools.map(tool => tool.name)],
        customTools,
        resourceLoader,
        sessionManager: SessionManager.create(
          input.cwd,
          undefined,
          parentSession === undefined ? undefined : {parentSession},
        ),
      };
      if (input.thinking !== undefined) options.thinkingLevel = input.thinking;
      const {session} = await createAgentSession(options);
      let abort: Promise<void> | undefined;
      const cancel = () => {
        abort ??= session.abort();
      };
      signal?.addEventListener('abort', cancel, {once: true});
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        session.setSessionName(input.agent);
        await session.bindExtensions({mode: 'json'});
        for (const tool of input.tools) {
          if (!session.getActiveToolNames().includes(tool))
            throw new SubagentError({
              message: `Required child tool is unavailable: ${tool}`,
            });
        }
        signal?.throwIfAborted();
        ready(session);
        timer = setTimeout(() => {
          timedOut = true;
          cancel();
        }, input.maxRuntimeMs);
        try {
          await session.prompt(input.task, {
            source: 'extension',
            expandPromptTemplates: false,
          });
        } catch (error) {
          if (!timedOut) throw error;
        }
        signal?.throwIfAborted();
        if (timedOut)
          throw new SubagentError({
            message: `Subagent timed out after ${input.maxRuntimeMs}ms.`,
          });
        const last = session.messages.findLast(
          message => message.role === 'assistant',
        );
        if (
          last?.role === 'assistant' &&
          (last.stopReason === 'error' || last.stopReason === 'aborted')
        )
          throw new SubagentError({
            message:
              last.errorMessage ??
              (last.stopReason === 'aborted'
                ? 'The child provider aborted execution.'
                : 'The child provider failed.'),
          });
        return {
          status: 'completed' as const,
          agent: input.agent,
          task: input.task,
          cwd: input.cwd,
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
        clearTimeout(timer);
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
