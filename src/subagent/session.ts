import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  parseSessionEntries,
  SessionManager,
  type ExtensionContext,
  type AgentSession,
  type ToolDefinition,
  type CreateAgentSessionOptions,
} from '@earendil-works/pi-coding-agent';
import {readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {Effect, Schema} from 'effect';
import type {Api, Model} from '@earendil-works/pi-ai';
import {childUI} from './extensions';
import type {ThinkingLevel} from '@earendil-works/pi-agent-core';

export class SubagentError extends Schema.TaggedError<SubagentError>()(
  'SubagentError',
  {message: Schema.String},
) {}

const SavedSessionHeader = Schema.Struct({
  type: Schema.Literal('session'),
  version: Schema.optional(Schema.Number),
  id: Schema.String,
  timestamp: Schema.String,
  cwd: Schema.String,
  parentSession: Schema.optional(Schema.String),
});

const SavedSessionEntryEnvelope = Schema.Struct({
  type: Schema.String,
  id: Schema.NonEmptyString,
  parentId: Schema.NullOr(Schema.String),
  timestamp: Schema.String,
});

export interface Investigation {
  agent: string;
  task: string;
  cwd: string;
  prompt?: string;
  write: boolean;
  tools: string[];
  extensionPaths: string[];
  maxRuntimeMs: number;
  model: Model<Api>;
  thinking: ThinkingLevel | undefined;
  sessionManager?: SessionManager;
}

async function validateSavedSession(
  file: string,
  cwd: string,
  expectedId: string,
): Promise<void> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(file);
  } catch (error) {
    throw new Error(`Saved session file is unavailable: ${file}`, {
      cause: error,
    });
  }
  if (!info.isFile())
    throw new Error(`Saved session path is not a file: ${file}`);

  const content = await readFile(file, 'utf8');
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0)
    throw new Error(`Saved session file is empty: ${file}`);

  // SessionManager's public parser intentionally skips malformed lines. Count
  // parsed entries first so SessionManager.open cannot silently accept a
  // partially corrupt file and repair it while opening.
  const entries = parseSessionEntries(content);
  if (entries.length !== lines.length)
    throw new Error(`Saved session file is invalid: ${file}`);

  const header = entries[0];
  if (!Schema.is(SavedSessionHeader)(header))
    throw new Error(`Saved session header is invalid: ${file}`);

  if (header.id !== expectedId)
    throw new Error(
      `Saved session id does not match expected id: ${header.id}`,
    );

  const knownEntryIds = new Set<string>();
  for (const entry of entries.slice(1)) {
    if (
      !Schema.is(SavedSessionEntryEnvelope)(entry) ||
      entry.type === 'session'
    )
      throw new Error(`Saved session entry envelope is invalid: ${file}`);
    if (knownEntryIds.has(entry.id))
      throw new Error(`Saved session entry id is duplicated: ${file}`);
    // Native SessionManager writes an entry only after its parent, so this
    // ordering check also rejects forward links, self-links and cycles.
    if (entry.parentId !== null && !knownEntryIds.has(entry.parentId))
      throw new Error(`Saved session entry parent is missing: ${file}`);
    knownEntryIds.add(entry.id);
  }

  const context = SessionManager.inMemory(
    cwd,
    undefined,
    entries,
  ).buildSessionContext();
  if (context.messages.length === 0)
    throw new Error(`Saved session has no context: ${file}`);
}

export function openSavedSession(
  file: string,
  cwd: string,
  expectedId: string,
): Effect.Effect<SessionManager, SubagentError> {
  return Effect.tryPromise({
    try: async () => {
      await validateSavedSession(file, cwd, expectedId);
      return SessionManager.open(file, undefined, cwd);
    },
    catch: error =>
      error instanceof SubagentError
        ? error
        : new SubagentError({
            message: error instanceof Error ? error.message : String(error),
          }),
  });
}

// Behavioral source: arhen/pi-extensions 676b11e, pi-core-subagent 1.3.55.
// See LICENSE in this directory. Read-only work uses the current checkout.
export function investigate(
  input: Investigation,
  parent: ExtensionContext,
  signal: AbortSignal | undefined,
  customTools: ToolDefinition[],
  ready: (session: AgentSession) => void,
  finished: (session: AgentSession) => void,
  extensionError: (message: string) => void,
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
        additionalExtensionPaths: input.extensionPaths,
        appendSystemPromptOverride: base => [
          ...base,
          input.write
            ? 'You are a subagent working in your own Git worktree. Return your findings and changes to the parent. Do not delegate. node_modules is shared with the parent project: do not install, delete, or modify dependencies.'
            : 'You are a read-only subagent. Inspect the assigned working directory and return your findings to the parent. Do not delegate.',
          ...(input.prompt === undefined ? [] : [input.prompt]),
        ],
      });
      await resourceLoader.reload();
      const loadErrors = resourceLoader.getExtensions().errors;
      if (loadErrors.length)
        throw new Error(
          `Required child extensions failed to load: ${loadErrors.map(error => `${error.path}: ${error.error}`).join('; ')}`,
        );
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
        sessionManager:
          input.sessionManager ??
          SessionManager.create(
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
        const bindingErrors: string[] = [];
        let binding = true;
        await session.bindExtensions({
          mode: 'json',
          uiContext: childUI(parent.ui.theme),
          onError: error => {
            const message = `${error.extensionPath} (${error.event}): ${error.error}`;
            if (binding) bindingErrors.push(message);
            else extensionError(message);
          },
        });
        if (bindingErrors.length)
          throw new Error(
            `Required child extensions failed to bind: ${bindingErrors.join('; ')}`,
          );
        binding = false;
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
          try {
            finished(session);
          } finally {
            session.dispose();
          }
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
