import type {
  AgentSession,
  ExtensionContext,
  SessionManager,
  SessionStats,
  ToolDefinition,
  ToolInfo,
} from '@earendil-works/pi-coding-agent';
import {Effect} from 'effect';
import {investigate, type Investigation} from './session';
import {
  preflightConfiguration,
  type ResolvedConfiguration,
} from './configuration';
import {extensionPaths} from './extensions';
import {SchedulerTaskFailure} from './graph';
import type {TaskSnapshot, Usage} from './records';
import {prepareWorkspace, saveWorkspace, releaseWorkspace} from './workspace';

interface RequestExecution {
  task: TaskSnapshot;
  configuration: ResolvedConfiguration;
  parentTools: () => ToolInfo[];
  parent: ExtensionContext;
  signal: AbortSignal;
  runId: string;
  message: string;
  baseBranch: string | undefined;
  sessionManager: SessionManager | undefined;
  tools: ToolDefinition[];
  ready: (session: AgentSession) => void;
  changed: () => void;
}

function usage(stats: SessionStats) {
  return {
    input: stats.tokens.input,
    output: stats.tokens.output,
    cacheRead: stats.tokens.cacheRead,
    cacheWrite: stats.tokens.cacheWrite,
    cost: stats.cost,
    turns: stats.assistantMessages,
  };
}

function recordedUsage(value: ReturnType<typeof usage>): Usage {
  const result: Usage = {turns: value.turns};
  const hasTokens =
    value.input + value.output + value.cacheRead + value.cacheWrite > 0;
  if (hasTokens) {
    result.input = value.input;
    result.output = value.output;
    result.cacheRead = value.cacheRead;
    result.cacheWrite = value.cacheWrite;
  }
  if (hasTokens || value.cost > 0) result.cost = value.cost;
  return result;
}

// One request owns execution and file finalization, for both dispatch and continuation.
export async function executeRequest(input: RequestExecution) {
  const {task, signal} = input;
  let unsubscribe: (() => void) | undefined;
  let baseline: ReturnType<typeof usage> | undefined;
  let outcome: 'completed' | 'failed' | 'stopped' = 'completed';
  const updateUsage = (session: AgentSession) => {
    const total = usage(session.getSessionStats());
    task.cumulativeUsage = recordedUsage(total);
    if (!baseline) return;
    const current = {
      input: total.input - baseline.input,
      output: total.output - baseline.output,
      cacheRead: total.cacheRead - baseline.cacheRead,
      cacheWrite: total.cacheWrite - baseline.cacheWrite,
      cost: total.cost - baseline.cost,
      turns: total.turns - baseline.turns,
    };
    const hasTokens =
      current.input + current.output + current.cacheRead + current.cacheWrite >
      0;
    if (current.turns > 0 || hasTokens || current.cost > 0)
      task.usage = recordedUsage(current);
  };
  try {
    signal.throwIfAborted();
    task.status = 'starting';
    task.startedAt = Date.now();
    input.changed();
    const configuration = await Effect.runPromise(
      preflightConfiguration(input.configuration, input.parent, signal),
    );
    task.prompt = configuration.prompt;
    task.write = configuration.write;
    task.tools = configuration.tools;
    task.model = configuration.model.id;
    task.provider = configuration.model.provider;
    task.configurationNotes = configuration.notes;
    if (configuration.roleSource) task.roleSource = configuration.roleSource;
    const paths = extensionPaths(configuration.tools, input.parentTools());
    if (task.write && !input.sessionManager) {
      task.workspace = await Effect.runPromise(
        prepareWorkspace(task.cwd, input.runId, task.id, input.baseBranch),
      );
    }
    const investigation: Investigation = {
      ...task,
      extensionPaths: paths,
      model: configuration.model,
      thinking: configuration.thinking,
      cwd: task.workspace?.cwd ?? task.cwd,
      task: input.message,
    };
    if (input.sessionManager)
      investigation.sessionManager = input.sessionManager;
    const result = await Effect.runPromise(
      investigate(
        investigation,
        input.parent,
        signal,
        input.tools,
        session => {
          baseline = usage(session.getSessionStats());
          const startEntryId = session.sessionManager.getLeafId();
          if (startEntryId) task.startEntryId = startEntryId;
          task.status = 'running';
          task.sessionId = session.sessionId;
          if (session.sessionFile) task.sessionFile = session.sessionFile;
          task.tools = session.getActiveToolNames();
          task.thinking = session.thinkingLevel;
          input.ready(session);
          input.changed();
          unsubscribe = session.subscribe(event => {
            if (
              (event.type === 'message_update' ||
                event.type === 'message_end') &&
              event.message.role === 'assistant'
            ) {
              const text = event.message.content
                .filter(part => part.type === 'text')
                .map(part => part.text)
                .join('\n');
              if (text) task.finalText = text;
              if (event.type === 'message_end') updateUsage(session);
            }
            if (
              event.type === 'message_start' &&
              event.message.role === 'user'
            ) {
              const content = event.message.content;
              const text = Array.isArray(content)
                ? content
                    .filter(part => part.type === 'text')
                    .map(part => part.text)
                    .join('\n')
                : content;
              const index = task.pendingInstructions.indexOf(text);
              if (index !== -1) task.pendingInstructions.splice(index, 1);
            }
            if (
              event.type === 'message_update' ||
              event.type === 'message_end' ||
              event.type === 'message_start'
            )
              input.changed();
          });
        },
        session => {
          updateUsage(session);
          const endEntryId = session.sessionManager.getLeafId();
          if (endEntryId) task.endEntryId = endEntryId;
          if (session.model) {
            task.model = session.model.id;
            task.provider = session.model.provider;
          }
          task.thinking = session.thinkingLevel;
        },
        message => {
          task.extensionErrors ??= [];
          task.extensionErrors.push(message);
          input.changed();
        },
      ),
    );
    task.finalText = result.finalText;
    task.sessionId = result.sessionId;
    if (result.sessionFile !== undefined) task.sessionFile = result.sessionFile;
    task.tools = result.tools;
  } catch (error) {
    outcome = signal.aborted ? 'stopped' : 'failed';
    task.error = error instanceof Error ? error.message : String(error);
  } finally {
    unsubscribe?.();
    if (task.workspace) {
      task.finalizing = true;
      if (signal.aborted) task.status = 'stopping';
      input.changed();
      try {
        task.git = await Effect.runPromise(
          saveWorkspace(task.workspace, `subagent: ${task.agent}`),
        );
        try {
          await Effect.runPromise(releaseWorkspace(task.workspace));
        } catch (error) {
          task.cleanupError =
            error instanceof Error ? error.message : String(error);
        }
      } catch (error) {
        task.preservationError =
          error instanceof Error ? error.message : String(error);
      } finally {
        task.finalizing = false;
      }
    }
    if (signal.aborted) outcome = 'stopped';
    task.status = outcome;
    task.endedAt = Date.now();
    input.changed();
  }
  return outcome === 'completed'
    ? {status: outcome, output: task.finalText}
    : {
        status: outcome,
        output: task.finalText,
        failure: new SchedulerTaskFailure({
          taskId: task.id,
          message: task.error ?? 'The task was stopped.',
        }),
      };
}
