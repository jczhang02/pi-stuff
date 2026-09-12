import type {Api, Model} from '@earendil-works/pi-ai';
import {
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionContext,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {realpath} from 'node:fs/promises';
import {Effect, Schema} from 'effect';
import {resolveAgentFile} from './agentfile';
import {CHILD_TALK_TOOLS, createChildTools, type ChildHandlers} from './child';
import {attachWorktree, createWorktree} from './worktree';
import type {TaskSnapshot} from './types';
import {truncateText} from './format';
import {THINKING_LEVELS} from './schemas';
import {sessionUsage} from './usage';

export class SubagentError extends Schema.TaggedError<SubagentError>()(
  'SubagentError',
  {message: Schema.String},
) {}
const Arguments = Schema.Struct({
  path: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  pattern: Schema.optional(Schema.String),
  question: Schema.optional(Schema.String),
});
const READ_TOOLS = ['read', 'grep', 'find', 'ls'];
const WRITE_TOOLS = [...READ_TOOLS, 'bash', 'edit', 'write'];

export function resolveChildModel(
  ctx: ExtensionContext,
  reference: string | undefined,
): Model<Api> {
  if (!reference?.trim() && ctx.model) return ctx.model;
  const value = reference?.trim();
  const available = ctx.modelRegistry.getAll();
  const model =
    available.find(model => `${model.provider}/${model.id}` === value) ??
    available.find(
      model => model.id === value && model.provider === ctx.model?.provider,
    ) ??
    available.find(model => model.id === value);
  if (!model)
    throw new SubagentError({
      message: `Unknown child model: ${value ?? '(none)'}.`,
    });
  return model;
}

export interface SessionObserver {
  changed(): void;
  opened(task: TaskSnapshot, session: AgentSession): void;
}

/** Owns one real SDK session, its startup and execution resources. */
export class TaskSession {
  session: AgentSession | undefined;
  private opening: Promise<AgentSession> | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    readonly task: TaskSnapshot,
    private readonly ctx: ExtensionContext,
    private readonly handlers: ChildHandlers,
    private readonly observer: SessionObserver,
  ) {}

  open(): Promise<AgentSession> {
    if (this.session) return Promise.resolve(this.session);
    if (this.opening) return this.opening;
    this.opening = Effect.runPromise(
      Effect.tryPromise({
        try: () => this.create(),
        catch: error =>
          new SubagentError({
            message:
              error instanceof Error
                ? error.message
                : 'Cannot open child session.',
          }),
      }),
    );
    return this.opening;
  }

  private async create(): Promise<AgentSession> {
    const task = this.task;
    const agentDir = getAgentDir();
    const restored = Boolean(task.sessionFile);
    if (!restored) {
      const file = await resolveAgentFile(
        task.agent,
        task.task,
        task.cwd,
        agentDir,
      );
      task.prompt = task.prompt ?? file?.body;
      task.agentFile = file?.path;
      task.model = task.model ?? file?.model;
      task.tools =
        task.tools ?? file?.tools ?? (task.write ? WRITE_TOOLS : READ_TOOLS);
      const invalid = task.tools.filter(
        tool => !WRITE_TOOLS.includes(tool) && !CHILD_TALK_TOOLS.includes(tool),
      );
      if (invalid.length)
        throw new SubagentError({
          message: `Unknown child tools: ${invalid.join(', ')}.`,
        });
      task.write =
        task.write ||
        task.tools.some(tool => ['bash', 'edit', 'write'].includes(tool));
      task.tools = [...new Set([...task.tools, ...CHILD_TALK_TOOLS])];
      if (task.write && !task.branch) {
        const source = await realpath(task.cwd);
        const worktree = await createWorktree(source, task.runId, task.id);
        if (!worktree)
          throw new SubagentError({
            message:
              'Write-capable tasks require an isolated Git worktree. Use a Git repository with a commit.',
          });
        task.originCwd = source;
        task.cwd = join(worktree.path, relative(worktree.root, source));
        task.branch = worktree.branch;
        task.isolation = 'worktree';
      }
    }
    if (task.branch) {
      const worktree = await attachWorktree(
        task.originCwd ?? this.ctx.cwd,
        task.branch,
      );
      if (!worktree)
        throw new SubagentError({
          message: `Cannot restore worktree ${task.branch}. Its files and branch were left untouched.`,
        });
      const subdirectory = relative(
        worktree.root,
        task.originCwd ?? this.ctx.cwd,
      );
      if (
        isAbsolute(subdirectory) ||
        subdirectory === '..' ||
        subdirectory.startsWith('../') ||
        resolve(worktree.path, subdirectory) !== resolve(task.cwd)
      )
        throw new SubagentError({
          message:
            'Stored child worktree path does not match the registered worktree.',
        });
    }
    const model = resolveChildModel(this.ctx, task.model);
    const thinking =
      THINKING_LEVELS.find(level => level === task.thinking) ??
      this.ctx.thinkingLevel ??
      'off';
    if (
      thinking !== 'off' &&
      (!model.reasoning || model.thinkingLevelMap?.[thinking] === null)
    )
      throw new SubagentError({
        message: `Thinking level ${thinking} is unsupported by ${model.provider}/${model.id}.`,
      });
    task.model = `${model.provider}/${model.id}`;
    task.thinking = thinking;
    const runtime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: join(agentDir, 'models.json'),
      allowModelNetwork: false,
    });
    for (const id of this.ctx.modelRegistry.getRegisteredProviderIds()) {
      const provider = this.ctx.modelRegistry.getRegisteredNativeProvider(id);
      const config = this.ctx.modelRegistry.getRegisteredProviderConfig(id);
      if (provider) runtime.registerNativeProvider(provider);
      else if (config) runtime.registerProvider(id, config);
    }
    await runtime.refresh({allowNetwork: false});
    const instructions = [
      task.prompt,
      'You are a child agent working on the assigned task. Keep your scope focused. Do not spawn agents or send external messages unless explicitly authorized by the parent. Report evidence and unresolved issues. Use ask_parent when blocked, notify_parent for useful progress, and send_agent_message / poll_agent_messages for siblings. Completion automatically reports your final result.',
      `Sibling task ids: ${task.roster ?? '(none)'}. Do not wait on a sibling that depends on you.`,
      task.branch
        ? `Your isolated worktree is ${task.cwd}, branch ${task.branch}. Edit only this worktree. Do not switch branches, commit, merge, remove worktrees, or modify shared node_modules. Changes will be preserved for parent review.`
        : 'Your toolset is read-only.',
    ]
      .filter(Boolean)
      .join('\n\n');
    const loader = new DefaultResourceLoader({
      cwd: task.cwd,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      appendSystemPromptOverride: base => [...base, instructions],
    });
    await loader.reload();
    const sessionDir = join(
      this.ctx.sessionManager.getSessionDir(),
      'pi-stuff-subagents',
      this.ctx.sessionManager.getSessionId(),
      task.runId,
      task.id,
    );
    const parentSession = this.ctx.sessionManager.getSessionFile();
    if (
      task.sessionFile &&
      resolve(dirname(task.sessionFile)) !== resolve(sessionDir)
    )
      throw new SubagentError({
        message: 'Child session file is outside this task’s session directory.',
      });
    const sessionManager = task.sessionFile
      ? SessionManager.open(task.sessionFile, sessionDir, task.cwd)
      : SessionManager.create(
          task.cwd,
          sessionDir,
          parentSession ? {parentSession} : undefined,
        );
    const created = await createAgentSession({
      cwd: task.cwd,
      agentDir,
      modelRuntime: runtime,
      model,
      thinkingLevel: thinking,
      resourceLoader: loader,
      sessionManager,
      tools: task.tools ?? READ_TOOLS,
      customTools: createChildTools(task.id, this.handlers),
    });
    this.session = created.session;
    task.sessionFile = created.session.sessionFile;
    task.sessionId = created.session.sessionId;
    created.session.setSessionName(task.agent);
    this.unsubscribe = created.session.subscribe(event => this.event(event));
    this.observer.opened(task, created.session);
    this.observer.changed();
    return created.session;
  }

  async execute(message: string, signal: AbortSignal): Promise<void> {
    await Effect.runPromise(
      Effect.tryPromise({
        try: async () => {
          const session = await this.open();
          if (
            this.task.model &&
            `${session.model?.provider}/${session.model?.id}` !==
              this.task.model
          )
            await session.setModel(
              resolveChildModel(this.ctx, this.task.model),
            );
          if (signal.aborted)
            throw new SubagentError({
              message: 'Task canceled before its prompt started.',
            });
          this.task.status = 'running';
          this.observer.changed();
          let aborting: Promise<void> | undefined;
          const abort = () => {
            aborting = session.abort();
          };
          signal.addEventListener('abort', abort, {once: true});
          try {
            await session.prompt(message, {
              source: 'extension',
              expandPromptTemplates: false,
            });
            const last = session.messages.findLast(
              message => message.role === 'assistant',
            );
            if (
              last?.role === 'assistant' &&
              (last.stopReason === 'error' || last.stopReason === 'aborted')
            )
              throw new SubagentError({
                message: last.errorMessage ?? `Agent ${last.stopReason}.`,
              });
          } finally {
            signal.removeEventListener('abort', abort);
            await aborting;
          }
        },
        catch: error =>
          new SubagentError({
            message:
              error instanceof Error
                ? error.message
                : 'Child execution failed.',
          }),
      }),
    );
  }

  async compact(signal: AbortSignal): Promise<void> {
    const session = await this.open();
    if (signal.aborted)
      throw new SubagentError({message: 'Compaction canceled.'});
    const abort = () => session.abortCompaction();
    // Pi initializes its compaction controller after awaiting abort(). Cover a
    // cancellation in that interval as well as a live summarization request.
    const unsubscribe = session.subscribe(event => {
      if (event.type === 'compaction_start' && signal.aborted) abort();
    });
    signal.addEventListener('abort', abort, {once: true});
    try {
      await session.compact();
    } finally {
      signal.removeEventListener('abort', abort);
      unsubscribe();
    }
  }

  private event(event: AgentSessionEvent): void {
    if (event.type === 'tool_execution_start') {
      this.task.toolCalls++;
      const args = Schema.decodeUnknownOption(Arguments)(event.args);
      const detail =
        args._tag === 'Some'
          ? (args.value.path ??
            args.value.command ??
            args.value.pattern ??
            args.value.question ??
            '')
          : '';
      this.task.lastActivity = `${event.toolName} ${detail}`
        .replace(/\s+/g, ' ')
        .slice(0, 160);
    } else if (
      event.type === 'message_end' &&
      event.message.role === 'assistant'
    ) {
      const message = event.message;
      this.task.usage.turns++;
      this.task.usage.input += message.usage.input;
      this.task.usage.output += message.usage.output;
      this.task.usage.cacheRead += message.usage.cacheRead;
      this.task.usage.cacheWrite += message.usage.cacheWrite;
      this.task.usage.cost += message.usage.cost.total;
      const text = message.content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n');
      if (text) this.task.finalText = truncateText(text);
    } else if (
      (event.type === 'compaction_end' || event.type === 'agent_settled') &&
      this.session
    ) {
      this.task.usage = sessionUsage(this.session.sessionManager.getEntries());
    } else if (event.type === 'auto_retry_start') {
      this.task.lastActivity = `Retry ${event.attempt}/${event.maxAttempts}: ${event.errorMessage}`;
    }
    this.observer.changed();
  }

  async dispose(): Promise<void> {
    const session =
      this.session ?? (await this.opening?.catch(() => undefined));
    if (session) {
      await session.abort();
      session.abortBash();
      this.unsubscribe?.();
      session.dispose();
    }
  }
}
