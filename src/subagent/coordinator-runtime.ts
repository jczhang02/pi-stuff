import {join} from 'node:path';
import {Effect} from 'effect';
import {
  type AgentSession,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import type {FleetRecord, TaskRecord} from './records';
import type {CoordinatorMailbox} from './coordinator-mailbox';
import {observeActivity, type ChildActivity} from './activity';
import {
  closeChildSession,
  createChildSession,
  readParentHistory,
  verifyChildSession,
  type ChildSessionOptions,
} from './session';
import {settleTask} from './settlement';
import {withExecutionTracking} from './processes';
import {
  inspectWorkspace,
  prepareWorkspace,
  saveArtifact,
  type WorkspaceRequest,
} from './workspace';

export interface TaskExecutionState {
  task: (id: string) => TaskRecord;
  snapshot: () => FleetRecord;
  update: (transform: (record: FleetRecord) => FleetRecord) => Promise<void>;
  change: (id: string, patch: Partial<TaskRecord>) => Promise<void>;
  waitForWrites: () => Promise<void>;
}

export interface TaskExecutionSession {
  context: () => ExtensionContext;
  childTool: (taskId: string) => ChildSessionOptions['tool'];
  effectiveTools: (id: string) => readonly string[];
  previewCharacters: () => number;
  resultWaitMs: () => number;
}

export interface TaskExecutionScheduler {
  waitFor: (predicate: () => boolean, milliseconds?: number) => Promise<void>;
  releaseSlot: (id: string) => void;
  acquireSlot: (id: string) => Promise<void>;
  expire: (id: string) => Promise<void>;
  fail: (error: Error | string) => void;
}

export interface TaskExecutionWorkspace {
  operation: <T>(operation: () => Promise<T>) => Promise<T>;
}

export interface TaskExecutionLifecycle {
  cancelOwned: (id: string) => Promise<void>;
  announce: (id: string) => Promise<void>;
}

export interface TaskExecutionHost {
  readonly storeDirectory: string;
  readonly state: TaskExecutionState;
  readonly session: TaskExecutionSession;
  readonly scheduler: TaskExecutionScheduler;
  readonly workspace: TaskExecutionWorkspace;
  readonly lifecycle: TaskExecutionLifecycle;
  readonly mailbox: CoordinatorMailbox;
}

interface Clock {
  readonly started: number;
  readonly timer: ReturnType<typeof setTimeout> | undefined;
}

function restorationMessage(
  commit: string,
  unsavedFiles: readonly string[],
  ignoredFiles: readonly string[],
): string {
  const paths = [...new Set([...unsavedFiles, ...ignoredFiles])];
  return paths.length
    ? `Workspace restored from fixed commit ${commit}. Previous unsaved or ignored paths were not restored: ${paths.join(', ')}.`
    : `Workspace restored from fixed commit ${commit}. No previous unsaved or ignored paths were restored.`;
}

/**
 * Owns one task's Pi session and its non-durable lifetime state.
 *
 * The coordinator still owns admission, authority and the global slot queue.
 * This boundary owns the task-local session, workspace binding, execution
 * clock, tool witness, child join and evidence drain, and exposes only the
 * small hooks needed to publish durable fleet transitions.
 */
export class TaskExecutionRuntime {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly clocks = new Map<string, Clock>();
  private readonly pausedClocks = new Set<string>();
  private readonly toolCalls = new Map<string, Set<string>>();
  private readonly toolNames = new Map<string, Map<string, string>>();
  private readonly waitingCalls = new Map<string, Set<string>>();

  constructor(private readonly host: TaskExecutionHost) {}

  session(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }

  activeToolNames(id: string): readonly string[] {
    return [...(this.toolNames.get(id)?.values() ?? [])];
  }

  activeToolCalls(id: string): readonly string[] {
    return [...(this.toolCalls.get(id) ?? [])];
  }

  isWaitingCall(id: string, callId: string): boolean {
    return this.waitingCalls.get(id)?.has(callId) ?? false;
  }

  addWaitingCall(id: string, callId: string): void {
    const calls = this.waitingCalls.get(id) ?? new Set<string>();
    calls.add(callId);
    this.waitingCalls.set(id, calls);
  }

  removeWaitingCall(id: string, callId: string): void {
    this.waitingCalls.get(id)?.delete(callId);
  }

  /** Park one active tool call and restore its task state exactly once. */
  async waitForCall(
    id: string,
    callId: string,
    stage: string,
    reason: string,
    predicate: () => boolean,
    milliseconds: number,
  ): Promise<void> {
    await this.waitForTask(id, stage, reason, predicate, milliseconds, callId);
  }

  async waitForTask(
    id: string,
    stage: string,
    reason: string,
    predicate: () => boolean,
    milliseconds: number,
    callId?: string,
  ): Promise<void> {
    if (callId) this.addWaitingCall(id, callId);
    let released = false;
    try {
      await this.host.state.change(id, {
        phase: 'waiting',
        stage,
        reason,
      });
      this.host.scheduler.releaseSlot(id);
      released = true;
      await this.host.scheduler.waitFor(predicate, milliseconds);
    } finally {
      try {
        if (released) await this.host.scheduler.acquireSlot(id);
      } finally {
        if (callId) this.removeWaitingCall(id, callId);
      }
      if (this.host.state.task(id).stopOutcome === null)
        await this.host.state.change(id, {
          phase: 'executing',
          stage: 'tool',
          reason: '',
        });
    }
  }

  isClockRunning(id: string): boolean {
    return this.clocks.has(id);
  }

  pauseClock(id: string): Promise<void> {
    if (!this.clocks.has(id)) return Promise.resolve();
    this.pausedClocks.add(id);
    return this.stopClock(id);
  }

  resumeClock(id: string): void {
    if (this.pausedClocks.delete(id)) this.startClock(id);
  }

  setActiveTools(id: string, tools: readonly string[]): void {
    this.sessions.get(id)?.setActiveToolsByName([...tools]);
  }

  async abort(id: string): Promise<void> {
    await this.sessions.get(id)?.abort();
  }

  async abortAll(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map(session => session.abort()),
    );
  }

  async run(id: string): Promise<void> {
    let session: AgentSession | undefined;
    try {
      if (this.host.state.task(id).stopOutcome !== null) return;
      await this.host.state.update(record => ({
        ...record,
        tasks: record.tasks.map(task =>
          task.id === id && task.stopOutcome === null
            ? {
                ...task,
                phase: 'starting',
                startedAt: Date.now(),
                reason: '',
                stage: 'initializing',
              }
            : task,
        ),
      }));
      if (this.host.state.task(id).stopOutcome !== null) {
        await this.settleStopped(id);
        await this.host.lifecycle.announce(id);
        return;
      }
      const task = this.host.state.task(id);
      const retained = this.host.state
        .snapshot()
        .agents.find(agent => agent.id === task.agentId)?.workspace;
      const previousTask = this.host.state
        .snapshot()
        .tasks.filter(
          candidate =>
            candidate.agentId === task.agentId && candidate.id !== id,
        )
        .findLast(candidate => candidate.endedAt !== null);
      const codeInputs = task.needs
        .map(inputId => this.host.state.task(inputId))
        .filter(input => input.commit !== null);
      if (codeInputs.length > 1 && task.configuration.baseline === null)
        throw new Error(
          'Multiple fixed code inputs require an explicit integration baseline. Artifacts remain available through read.',
        );
      const baseline = task.baselineRequest ?? codeInputs[0]?.commit;
      const request: WorkspaceRequest = {
        agentId: task.agentId,
        taskId: id,
        source: task.configuration.cwd,
        directory: join(this.host.storeDirectory, 'workspaces'),
        mode: task.configuration.workspace,
        include: [...task.configuration.include],
      };
      if (baseline) request.baseline = baseline;
      const processDirectory = join(
        this.host.storeDirectory,
        'sessions',
        task.agentId,
        'processes',
      );
      const workspace = await this.host.workspace.operation(() =>
        withExecutionTracking(processDirectory, () =>
          Effect.runPromise(prepareWorkspace(request, retained ?? undefined)),
        ),
      );
      const restoredFrom = workspace.restoredFrom;
      await this.host.state.update(record => ({
        ...record,
        agents: record.agents.map(agent =>
          agent.id === task.agentId ? {...agent, workspace} : agent,
        ),
        tasks: record.tasks.map(candidate =>
          candidate.id === id
            ? {
                ...candidate,
                workspaceDirectory: workspace.cwd,
                baseline: workspace.baseline,
                events:
                  restoredFrom === undefined
                    ? candidate.events
                    : [
                        ...candidate.events,
                        {
                          at: Date.now(),
                          kind: 'workspace-restored',
                          text: restorationMessage(
                            restoredFrom,
                            previousTask?.unsavedFiles ??
                              candidate.unsavedFiles,
                            previousTask?.ignoredFiles ??
                              candidate.ignoredFiles,
                          ),
                        },
                      ],
              }
            : candidate,
        ),
      }));
      const latestSessionFile =
        this.host.state
          .snapshot()
          .agents.find(agent => agent.id === task.agentId)?.sessionFile ??
        task.sessionFile;
      const parentHistory =
        !latestSessionFile && task.historyFile
          ? await Effect.runPromise(readParentHistory(task.historyFile))
          : undefined;
      const options: ChildSessionOptions = {
        configuration: {
          ...task.configuration,
          cwd: workspace.cwd,
          tools: [...this.host.session.effectiveTools(id)],
        },
        directory: join(this.host.storeDirectory, 'sessions', task.agentId),
        sessionFile: latestSessionFile,
        parent: this.host.session.context(),
        tool: this.host.session.childTool(id),
        allowed: tool => this.host.session.effectiveTools(id).includes(tool),
        onEvent: async event => this.onEvent(id, event, () => session),
        onEventError: error => this.host.scheduler.fail(error),
      };
      if (parentHistory) options.parentHistory = parentHistory;
      session = await Effect.runPromise(createChildSession(options));
      this.sessions.set(id, session);
      if (this.host.state.task(id).stopOutcome !== null) {
        await session.abort();
        await this.settleStopped(id);
        await this.host.lifecycle.announce(id);
        return;
      }
      const sessionFile = session.sessionFile ?? null;
      await this.host.state.update(record => ({
        ...record,
        tasks: record.tasks.map(candidate =>
          candidate.id === id
            ? {...candidate, phase: 'executing', stage: 'model', sessionFile}
            : candidate,
        ),
        agents: record.agents.map(agent =>
          agent.id === task.agentId ? {...agent, sessionFile} : agent,
        ),
      }));
      const upstream = task.needs
        .map(inputId => {
          const source = this.host.state.task(inputId);
          const preview = this.host.session.previewCharacters();
          const references = [
            `Saved input ${source.id}:`,
            source.report
              ? `report preview: ${source.report.slice(0, preview)}`
              : '',
            source.report.length > preview
              ? `full report: use subagent read with taskId ${source.id} and record report`
              : '',
            source.baseline ? `baseline: ${source.baseline}` : '',
            source.commit ? `fixed commit: ${source.commit}` : '',
            source.files.length ? `files: ${source.files.join(', ')}` : '',
            source.checks.length ? `checks: ${source.checks.join('; ')}` : '',
            source.diff ? `diff preview: ${source.diff.slice(0, preview)}` : '',
            source.diff.length > preview
              ? `full diff: use subagent read with taskId ${source.id} and record diff`
              : '',
          ].filter(Boolean);
          return references.join('\n');
        })
        .join('\n\n');
      const inbox = this.host.state
        .snapshot()
        .messages.filter(
          message =>
            message.taskId === id &&
            message.consumedAt === null &&
            message.kind !== 'question',
        );
      await this.prompt(
        id,
        session,
        `${upstream ? `${upstream}\n\n` : ''}${task.prompt}\n${inbox.map(message => `[Subagent ${message.kind} ${message.id}]\n${message.text}`).join('\n\n')}`,
      );
      let settled = false;
      while (!settled) {
        await this.host.state.waitForWrites();
        if (this.host.state.task(id).stopOutcome !== null) {
          await session.abort();
          await this.settleStopped(id);
          break;
        }
        const children = this.host.state
          .snapshot()
          .tasks.filter(child => child.parentTaskId === id);
        const unconsumed = children.filter(
          child =>
            !this.host.state.task(id).consumedChildren.includes(child.id),
        );
        if (unconsumed.length) {
          if (unconsumed.some(child => child.phase !== 'ended')) {
            await this.waitForTask(
              id,
              'owned descendants',
              'Joining owned assignments.',
              () =>
                this.host.state.task(id).stopOutcome !== null ||
                this.host.mailbox.pendingQuestions(id).length > 0 ||
                this.host.mailbox.pendingMessages(id).length > 0 ||
                this.host.state
                  .snapshot()
                  .tasks.filter(child => child.parentTaskId === id)
                  .every(child => child.phase === 'ended'),
              this.host.session.resultWaitMs(),
            );
            if (this.host.state.task(id).stopOutcome !== null) continue;
          }
          await this.drainMailbox(id, session);
          const ended = this.host.state
            .snapshot()
            .tasks.filter(
              child =>
                child.parentTaskId === id &&
                child.phase === 'ended' &&
                !this.host.state.task(id).consumedChildren.includes(child.id),
            );
          if (ended.length) {
            await this.host.state.change(id, {
              phase: 'executing',
              stage: 'consume child results',
              reason: '',
              outcome: null,
            });
            await this.prompt(
              id,
              session,
              `Owned child outcomes:\n${ended.map(child => `${child.id}: ${child.outcome}\n${child.report || child.reason}`).join('\n\n')}\nIncorporate these outcomes into this assignment and declare its outcome.`,
            );
            await this.host.state.change(id, {
              consumedChildren: [
                ...this.host.state.task(id).consumedChildren,
                ...ended.map(child => child.id),
              ],
            });
          }
          continue;
        }
        if (await this.drainMailbox(id, session)) continue;
        const pending = this.host.state
          .snapshot()
          .messages.filter(
            message =>
              message.kind === 'steer' &&
              message.taskId === id &&
              message.consumedAt === null,
          );
        if (pending.length) {
          await this.prompt(
            id,
            session,
            pending
              .map(message => `[Subagent steer ${message.id}]\n${message.text}`)
              .join('\n\n'),
          );
          continue;
        }
        await this.saveEvidence(id);
        await this.host.state.update(record => {
          if (this.host.state.task(id).stopOutcome !== null) return record;
          if (
            record.messages.some(
              message =>
                message.kind === 'steer' &&
                message.taskId === id &&
                message.consumedAt === null,
            )
          )
            return record;
          settled = true;
          return settleTask(
            record,
            id,
            this.host.state.task(id).outcome ?? 'incomplete',
          );
        });
      }
      await this.host.lifecycle.announce(id);
    } catch (error) {
      await this.host.lifecycle.cancelOwned(id);
      await this.saveEvidence(id);
      await this.host.state.update(record =>
        settleTask(
          record,
          id,
          this.host.state.task(id).stopOutcome ?? 'failed',
          error instanceof Error ? error.message : 'Subagent execution failed.',
        ),
      );
      await this.host.lifecycle.announce(id);
    } finally {
      this.sessions.delete(id);
      await this.stopClock(id);
      this.pausedClocks.delete(id);
      if (session) await Effect.runPromise(closeChildSession(session));
    }
  }

  private async onEvent(
    id: string,
    event: ChildActivity,
    session: () => AgentSession | undefined,
  ): Promise<void> {
    const task = this.host.state.task(id);
    const observed = observeActivity(task, event);
    if (observed !== task)
      await this.host.state.update(record => ({
        ...record,
        tasks: record.tasks.map(candidate =>
          candidate.id === id ? observeActivity(candidate, event) : candidate,
        ),
      }));
    const calls = this.toolCalls.get(id) ?? new Set<string>();
    const names = this.toolNames.get(id) ?? new Map<string, string>();
    this.toolCalls.set(id, calls);
    this.toolNames.set(id, names);
    if (event.type === 'tool_execution_start') {
      calls.add(event.toolCallId);
      names.set(event.toolCallId, event.toolName);
    }
    if (event.type === 'tool_execution_end') {
      calls.delete(event.toolCallId);
      names.delete(event.toolCallId);
      if (this.waitingCalls.get(id)?.size) this.host.scheduler.releaseSlot(id);
    }
    if (
      event.type !== 'message_start' ||
      event.message.role !== 'assistant' ||
      !session()
    )
      return;
    const context = session()!
      .agent.state.messages.map(message =>
        'content' in message ? JSON.stringify(message.content) : '',
      )
      .join('\n');
    await this.host.state.update(record => ({
      ...record,
      messages: record.messages.map(message =>
        message.taskId === id &&
        message.consumedAt === null &&
        context.includes(message.id)
          ? {...message, consumedAt: Date.now()}
          : message,
      ),
    }));
  }

  private startClock(id: string): void {
    if (this.clocks.has(id) || this.host.state.task(id).stopOutcome !== null)
      return;
    const limit = this.host.state.task(id).configuration.executionTimeoutMs;
    const started = Date.now();
    const timer =
      limit === null
        ? undefined
        : setTimeout(
            () => {
              void this.host.scheduler
                .expire(id)
                .catch(error =>
                  this.host.scheduler.fail(
                    error instanceof Error ? error : String(error),
                  ),
                );
            },
            Math.max(1, limit - this.host.state.task(id).executionMs),
          );
    this.clocks.set(id, {started, timer});
  }

  private async stopClock(id: string): Promise<void> {
    const clock = this.clocks.get(id);
    if (!clock) return;
    clearTimeout(clock.timer);
    this.clocks.delete(id);
    const elapsed = Math.max(0, Date.now() - clock.started);
    await this.host.state.update(record => ({
      ...record,
      tasks: record.tasks.map(task =>
        task.id === id
          ? {...task, executionMs: task.executionMs + elapsed}
          : task,
      ),
    }));
  }

  private async prompt(
    id: string,
    session: AgentSession,
    text: string,
  ): Promise<void> {
    if (this.host.state.task(id).stopOutcome !== null) return;
    this.startClock(id);
    try {
      await session.prompt(text, {expandPromptTemplates: false});
    } finally {
      await this.stopClock(id);
    }
  }

  private async drainMailbox(
    id: string,
    session: AgentSession,
  ): Promise<boolean> {
    const questions = this.host.mailbox.pendingQuestions(id);
    if (questions.length) {
      await this.host.state.change(id, {
        phase: 'executing',
        stage: 'child question',
        reason: '',
      });
      await this.prompt(
        id,
        session,
        `Questions awaiting your reply:\n${questions.map(question => `Question ${question.id}: ${question.text}`).join('\n')}\nAnswer with subagent reply in this assignment, then continue joining owned work.`,
      );
    }
    const messages = this.host.mailbox
      .pendingMessages(id)
      .filter(message => message.kind !== 'question');
    if (!messages.length) return questions.length > 0;
    await this.host.state.change(id, {
      phase: 'executing',
      stage: 'child message',
      reason: '',
    });
    await this.prompt(
      id,
      session,
      messages
        .map(
          message =>
            `[Subagent ${message.kind} ${message.id}]\n${message.text}`,
        )
        .join('\n\n'),
    );
    await this.host.mailbox.consume(messages.map(message => message.id));
    return true;
  }

  private async saveEvidence(id: string): Promise<void> {
    const task = this.host.state.task(id);
    const session = this.sessions.get(id);
    if (session && task.startedAt !== null) {
      try {
        await Effect.runPromise(verifyChildSession(session));
      } catch (error) {
        await this.host.state.change(id, {
          artifactError: `Required context is unavailable: ${String(error)}`,
        });
        return;
      }
    }
    const workspace = this.host.state
      .snapshot()
      .agents.find(agent => agent.id === task.agentId)?.workspace;
    if (!workspace || workspace.mode !== 'write') return;
    try {
      const artifact = await this.host.workspace.operation(() =>
        withExecutionTracking(
          join(this.host.storeDirectory, 'sessions', task.agentId, 'processes'),
          () =>
            Effect.runPromise(
              saveArtifact(
                {...workspace, baseline: task.baseline},
                id,
                [...task.files],
                [...task.checks],
              ),
            ),
        ),
      );
      await this.host.state.update(record => ({
        ...record,
        tasks: record.tasks.map(candidate =>
          candidate.id === id
            ? {
                ...candidate,
                commit: artifact.commit ?? candidate.commit,
                diff: artifact.diff || candidate.diff,
                files: artifact.files.length ? artifact.files : candidate.files,
                artifactError: null,
              }
            : candidate,
        ),
        agents: record.agents.map(agent =>
          agent.id === task.agentId && agent.workspace
            ? {
                ...agent,
                workspace: {
                  ...agent.workspace,
                  baseline: artifact.commit ?? artifact.baseline,
                },
              }
            : agent,
        ),
      }));
      const status = await this.host.workspace.operation(() =>
        withExecutionTracking(
          join(this.host.storeDirectory, 'sessions', task.agentId, 'processes'),
          () => Effect.runPromise(inspectWorkspace(workspace)),
        ),
      );
      await this.host.state.change(id, {
        unsavedFiles: status.files,
        ignoredFiles: status.ignored,
        artifactError: status.files.length
          ? 'Workspace has unsaved changes. Declare intended files before delivery.'
          : null,
      });
    } catch (error) {
      await this.host.state.change(id, {
        artifactError: `Artifact unavailable: ${String(error)}. Workspace retained.`,
      });
    }
  }

  private async settleStopped(id: string): Promise<void> {
    await this.host.lifecycle.cancelOwned(id);
    await this.saveEvidence(id);
    await this.host.state.update(record =>
      settleTask(
        record,
        id,
        this.host.state.task(id).stopOutcome ?? 'cancelled',
      ),
    );
  }
}
