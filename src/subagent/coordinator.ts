import {join} from 'node:path';
import {Effect} from 'effect';
import {
  getAgentDir,
  type ExtensionContext,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type {FleetRecord, TaskRecord} from './records';
import type {SubagentInput} from './protocol';
import {FleetStore} from './store';
import {captureParentHistory, writeParentHistory} from './session';
import type {SubagentSettings} from './settings';
import {dependencyReadiness} from './dependencies';
import {canReuseAgent, ownedBranch, ownsTask} from './authority';
import {settleTask} from './settlement';
import {newAssignment, prepareAdmission} from './admission';
import {discoverRoles, resolveFollowup} from './configuration';
import {FleetJournal} from './coordinator-journal';
import {TaskExecutionRuntime} from './coordinator-runtime';
import {CoordinatorMailbox} from './coordinator-mailbox';
import {inspectFleet, readTask} from './coordinator-view';
import {CoordinatorControls} from './coordinator-controls';
import {CoordinatorRecovery} from './coordinator-recovery';
import {DispatchSettlementNotifier} from './coordinator-notices';

export interface CoordinatorHost {
  context: ExtensionContext;
  tools: () => string[];
  childTool: (taskId: string) => ToolDefinition;
  notify: (task: TaskRecord) => void;
  notifyCommunication?: (task: TaskRecord | null, text: string) => void;
}

export class Coordinator {
  private readonly journal: FleetJournal;
  private readonly mailbox: CoordinatorMailbox;
  private readonly controls: CoordinatorControls;
  private readonly runtime: TaskExecutionRuntime;
  private readonly recovery: CoordinatorRecovery;
  private readonly notices: DispatchSettlementNotifier;
  private readonly executions = new Map<string, Promise<void>>();
  private readonly slots = new Set<string>();
  private readonly resumes = new Map<string, Set<() => void>>();
  private readonly openedWritable: boolean;
  private workspaceTail = Promise.resolve();
  private closing = false;

  constructor(
    private readonly store: FleetStore,
    private readonly host: CoordinatorHost,
    private readonly settings: SubagentSettings,
  ) {
    this.openedWritable = store.writable;
    this.journal = new FleetJournal(store, {
      onPersistenceFailure: error => this.storageFailure(error),
      onObserverFailure: error =>
        this.host.context.ui.notify(
          `Subagent observer failed: ${String(error)}`,
          'error',
        ),
    });
    this.mailbox = new CoordinatorMailbox({
      snapshot: () => this.record,
      update: transform => this.update(transform),
      notify: (task, text) => this.notifyCommunication(task, text),
    });
    this.notices = new DispatchSettlementNotifier({
      snapshot: () => this.record,
      update: transform => this.update(transform),
      notify: (task, text) => this.notifyCommunication(task, text),
    });
    this.runtime = new TaskExecutionRuntime({
      storeDirectory: store.directory,
      state: {
        task: id => this.task(id),
        snapshot: () => this.record,
        update: transform => this.update(transform),
        change: (id, patch) => this.change(id, patch),
        waitForWrites: () => this.journal.waitForWrites(),
      },
      session: {
        context: () => this.host.context,
        childTool: taskId => this.host.childTool(taskId),
        effectiveTools: id => this.effectiveTools(id),
        previewCharacters: () => this.settings.previewCharacters ?? 2000,
        resultWaitMs: () => this.settings.resultWaitMs ?? 60000,
      },
      scheduler: {
        waitFor: (predicate, milliseconds) =>
          this.until(predicate, milliseconds),
        releaseSlot: id => this.releaseSlot(id),
        acquireSlot: id => this.acquireSlot(id),
        expire: async id => {
          await this.cancel(
            {command: 'cancel', taskId: id},
            null,
            'cancelled',
            'Execution deadline expired.',
          );
        },
        fail: error => this.storageFailure(error),
      },
      workspace: {operation: operation => this.workspaceOperation(operation)},
      lifecycle: {
        cancelOwned: id => this.cancelOwned(id),
        announce: id => this.announce(id),
      },
      mailbox: this.mailbox,
    });
    this.controls = new CoordinatorControls({
      storeDirectory: store.directory,
      snapshot: () => this.record,
      task: id => this.task(id),
      update: transform => this.update(transform),
      effectiveTools: id => this.effectiveTools(id),
      cancelTask: (id, caller) =>
        this.cancel({command: 'cancel', taskId: id}, caller, 'cancelled').then(
          () => undefined,
        ),
      schedule: () => this.schedule(),
      isAgentActive: agentId =>
        [...this.executions.keys()].some(
          id => this.task(id).agentId === agentId,
        ),
      workspaceOperation: operation => this.workspaceOperation(operation),
      runtime: {
        session: id => this.runtime.session(id),
        setActiveTools: (id, tools) => this.runtime.setActiveTools(id, tools),
        activeToolNames: id => this.runtime.activeToolNames(id),
      },
    });
    this.recovery = new CoordinatorRecovery({
      store,
      journal: this.journal,
      context: () => this.host.context,
      abortAll: () => this.runtime.abortAll(),
      stopAdmission: () => {
        this.closing = true;
      },
      wakeWaiters: () => this.wakeWaiters(),
    });
  }

  get snapshot() {
    return this.journal.snapshot;
  }

  setContext(context: ExtensionContext) {
    this.host.context = context;
  }

  /** Reconcile persisted state before the UI or scheduler can observe it. */
  async initialize(): Promise<FleetRecord> {
    return this.recovery.initialize();
  }

  subscribe(listener: () => void) {
    return this.journal.subscribe(listener);
  }

  private update(transform: (record: FleetRecord) => FleetRecord) {
    return this.journal.update(transform);
  }

  private storageFailure(error: Error | string) {
    this.recovery.fail(error);
  }

  private get record(): FleetRecord {
    return this.journal.snapshot;
  }

  private notifyCommunication(task: TaskRecord | null, text: string) {
    if (!this.host.notifyCommunication) return;
    try {
      this.host.notifyCommunication(task, text);
    } catch (error) {
      try {
        this.host.context.ui.notify(
          `Subagent communication notification failed: ${String(error)}`,
          'error',
        );
      } catch {
        /* Durable communication remains authoritative. */
      }
    }
  }

  private task(id: string) {
    const task = this.record.tasks.find(task => task.id === id);
    if (!task)
      throw new Error('Unknown task. Use inspect to obtain an identity.');
    return task;
  }

  private change(id: string, patch: Partial<TaskRecord>) {
    return this.update(record => ({
      ...record,
      tasks: record.tasks.map(task =>
        task.id === id ? {...task, ...patch} : task,
      ),
    }));
  }

  async execute(
    input: SubagentInput,
    caller: string | null = null,
    callId?: string,
  ) {
    if (
      !this.store.writable &&
      !['inspect', 'read', 'roles', 'wait'].includes(input.command)
    )
      throw new Error(
        'Another or unknown executor owns this fleet. Inspection only.',
      );
    if (
      !this.store.writable &&
      ['inspect', 'read', 'wait'].includes(input.command)
    )
      await this.journal.refresh();
    switch (input.command) {
      case 'inspect':
        return this.inspect(input, caller);
      case 'dispatch':
        return this.dispatch(input, caller);
      case 'finish': {
        if (!caller || !input.outcome || input.text === undefined)
          throw new Error(
            'finish requires a child task, explicit outcome and report text.',
          );
        await this.update(record => {
          const task = this.task(caller);
          if (task.phase === 'ended' || task.stopOutcome !== null)
            throw new Error('Task no longer accepts fulfillment.');
          return {
            ...record,
            tasks: record.tasks.map(candidate =>
              candidate.id === caller
                ? {
                    ...candidate,
                    outcome: input.outcome ?? null,
                    declaration: input.outcome ?? null,
                    report: input.text ?? '',
                    files: input.files ?? [],
                    checks: input.checks ?? [],
                  }
                : candidate,
            ),
          };
        });
        return {
          status: 'accepted',
          message:
            'Declaration recorded. Delivery waits for execution and owned children to settle.',
        };
      }
      case 'wait':
        return this.wait(input, caller, callId);
      case 'steer':
        return this.communicate(input, caller, 'steer');
      case 'message':
        return this.communicate(input, caller, 'message');
      case 'report':
        return this.communicate(input, caller, 'report');
      case 'followup':
        return this.followup(input, caller);
      case 'cancel':
        return this.cancel(input, caller, 'cancelled');
      case 'ask':
        return this.ask(input, caller, callId);
      case 'reply':
        return this.reply(input, caller);
      case 'read':
        return this.read(input, caller);
      case 'accept': {
        if (caller || !input.taskId || input.accepted === undefined)
          throw new Error('Main must specify taskId and accepted.');
        this.task(input.taskId);
        await this.change(input.taskId, {acceptance: input.accepted});
        return {status: 'accepted'};
      }
      case 'acknowledge': {
        if (!input.noticeId) throw new Error('acknowledge requires noticeId.');
        const notice = this.record.notices.find(
          candidate => candidate.id === input.noticeId,
        );
        if (!notice) throw new Error('Unknown notice.');
        if (!ownsTask(this.record, caller, notice.taskId))
          throw new Error('Notice belongs to another assignment.');
        await this.update(record => ({
          ...record,
          notices: record.notices.map(notice =>
            notice.id === input.noticeId &&
            ownsTask(record, caller, notice.taskId)
              ? {...notice, acknowledged: true}
              : notice,
          ),
        }));
        return {status: 'accepted'};
      }
      case 'queue':
        return this.controls.queue(input, caller);
      case 'restrict':
        return this.controls.restrict(input, caller);
      case 'roles':
        return Effect.runPromise(
          discoverRoles(
            caller
              ? (this.task(caller).workspaceDirectory ??
                  this.task(caller).configuration.cwd)
              : this.host.context.cwd,
            getAgentDir(),
            this.settings,
          ),
        );
      case 'release':
        return this.controls.release(input, caller);
      default:
        throw new Error(`Unsupported operation: ${input.command}`);
    }
  }

  private inspect(input: SubagentInput, caller: string | null) {
    return inspectFleet(
      this.record,
      input,
      caller,
      this.settings.previewCharacters ?? 2000,
    );
  }

  private read(input: SubagentInput, caller: string | null) {
    return readTask(this.record, input, caller);
  }

  private effectiveTools(id: string): string[] {
    const task = this.task(id);
    const parent = task.parentTaskId
      ? this.effectiveTools(task.parentTaskId)
      : this.host.tools();
    const retained =
      this.record.agents.find(agent => agent.id === task.agentId)
        ?.currentTools ?? [];
    return task.currentTools.filter(
      tool => parent.includes(tool) && retained.includes(tool),
    );
  }

  private async ask(
    input: SubagentInput,
    caller: string | null,
    callId?: string,
  ) {
    if (!caller || !input.text || !callId)
      throw new Error('ask requires an active child and question text.');
    const task = this.task(caller);
    const timeout = input.timeoutMs ?? this.settings.answerWaitMs ?? 600000;
    const question = await this.mailbox.ask(task, input.text, timeout);
    await this.runtime.waitForCall(
      caller,
      callId,
      'answer',
      input.text,
      () =>
        this.task(caller).stopOutcome !== null ||
        this.mailbox.answer(question.id) !== undefined,
      timeout,
    );
    if (this.task(caller).stopOutcome !== null)
      throw new Error('Question interrupted by cancellation.');
    const answer = this.mailbox.answer(question.id);
    if (answer) await this.mailbox.consume([answer.id]);
    return {
      status: answer ? 'answered' : 'expired',
      questionId: question.id,
      answer: answer?.text ?? null,
    };
  }

  private async reply(input: SubagentInput, caller: string | null) {
    if (!input.questionId || input.text === undefined)
      throw new Error('reply requires questionId and text.');
    const delivery = await this.mailbox.reply(
      caller,
      input.questionId,
      input.text,
    );
    return {status: 'accepted', late: delivery.late, text: input.text};
  }

  private async followup(input: SubagentInput, caller: string | null) {
    const targetId =
      input.agentId ??
      (input.taskId ? this.task(input.taskId).agentId : undefined);
    const agent = this.record.agents.find(agent => agent.id === targetId);
    if (!agent || !canReuseAgent(this.record, caller, agent.id))
      throw new Error('Follow-up requires a known retained descendant agent.');
    if (agent.released)
      throw new Error(
        'Retained workspace was explicitly released. Create a new agent.',
      );
    if (!input.text) throw new Error('Follow-up requires assignment text.');
    if (input.overrides?.copyHistory !== undefined)
      throw new Error(
        'A follow-up retains its own history; parent history copying only applies to new agents.',
      );
    const previous = this.record.tasks.findLast(
      task => task.agentId === agent.id,
    );
    if (!previous)
      throw new Error('Retained agent has no recoverable assignment.');
    if (agent.held && !input.recovery)
      throw new Error('Agent queue is held. Select explicit recovery first.');
    const ceiling = (
      caller ? this.effectiveTools(caller) : this.host.tools()
    ).filter(tool => agent.currentTools.includes(tool));
    const parent = caller
      ? this.task(caller).configuration
      : {...agent.configuration, workspace: 'direct' as const};
    const configuration = await Effect.runPromise(
      resolveFollowup(
        {name: agent.name, prompt: input.text, ...input.overrides},
        {
          ...agent.configuration,
          tools: agent.configuration.tools.filter(tool =>
            ceiling.includes(tool),
          ),
        },
        {
          cwd: agent.configuration.cwd,
          agentDir: getAgentDir(),
          user: this.settings,
          parent: {...parent, tools: ceiling, ceiling},
          availableTools: ceiling,
        },
      ),
    );
    const task = {
      ...newAssignment(
        {...agent, configuration, currentTools: configuration.tools},
        input.text,
        input.text,
        caller,
        this.settings,
      ),
      baselineRequest: input.overrides?.baseline ?? null,
      historyFile: previous.historyFile,
    };
    await this.update(record => {
      if (this.closing)
        throw new Error('Session is departing; admission is closed.');
      if (
        this.controls.isReleasing(agent.id) ||
        record.agents.find(candidate => candidate.id === agent.id)?.released
      )
        throw new Error('Workspace is releasing or released.');
      const currentCeiling = caller
        ? this.effectiveTools(caller)
        : this.host.tools();
      if (
        task.currentTools.some(
          tool =>
            !currentCeiling.includes(tool) ||
            !record.agents
              .find(candidate => candidate.id === agent.id)
              ?.currentTools.includes(tool),
        )
      )
        throw new Error('Tool permissions changed before follow-up admission.');
      if (caller) {
        const parent = this.task(caller);
        if (parent.phase === 'ended' || parent.phase === 'cancelling')
          throw new Error('Parent no longer accepts work.');
      }
      const dispatch = record.dispatches.find(
        dispatch => dispatch.id === agent.dispatchId,
      );
      if (
        !dispatch ||
        dispatch.admitted >= (this.settings.tasksPerDispatch ?? 64)
      )
        throw new Error('Original dispatch allowance exhausted.');
      const position = input.recovery
        ? record.tasks.findIndex(
            queued => queued.agentId === agent.id && queued.phase === 'queued',
          )
        : -1;
      const tasks = [...record.tasks];
      tasks.splice(position < 0 ? tasks.length : position, 0, task);
      return {
        ...record,
        tasks,
        agents: record.agents.map(candidate =>
          candidate.id === agent.id && input.recovery
            ? {...candidate, held: false}
            : candidate,
        ),
        dispatches: record.dispatches.map(candidate =>
          candidate.id === dispatch.id
            ? {...candidate, admitted: candidate.admitted + 1}
            : candidate,
        ),
      };
    });
    this.schedule();
    return {
      status: 'accepted',
      tasks: [{taskId: task.id, agentId: agent.id}],
      dispatchId: agent.dispatchId,
    };
  }

  private async cancel(
    input: SubagentInput,
    caller: string | null,
    outcome: 'cancelled' | 'interrupted',
    reason?: string,
  ) {
    let ids: string[] = [];
    await this.update(record => {
      const targets = input.taskId
        ? ownedBranch(record, input.taskId)
        : caller && !input.dispatchId
          ? ownedBranch(record, caller)
          : record.tasks.filter(
              task => !input.dispatchId || task.dispatchId === input.dispatchId,
            );
      if (!targets.length) throw new Error('No matching cancellation target.');
      if (targets.some(task => !ownsTask(record, caller, task.id)))
        throw new Error('Cancellation requires current task ownership.');
      ids = targets.filter(task => task.phase !== 'ended').map(task => task.id);
      return {
        ...record,
        agents: record.agents.map(agent =>
          targets.some(
            task => task.agentId === agent.id && ids.includes(task.id),
          )
            ? {...agent, held: true}
            : agent,
        ),
        notices: [
          ...record.notices,
          ...targets
            .filter(
              task => ids.includes(task.id) && !this.executions.has(task.id),
            )
            .map(task => ({
              id: `ended:${task.id}`,
              taskId: task.id,
              text: `${task.description}: ${outcome}.`,
              acknowledged: false,
            })),
        ],
        tasks: record.tasks.map(task => {
          if (!ids.includes(task.id)) return task;
          const running = this.executions.has(task.id);
          return {
            ...task,
            phase: running ? 'cancelling' : 'ended',
            stopOutcome: outcome,
            outcome: running ? null : outcome,
            endedAt: running ? null : Date.now(),
            durability: running ? 'pending' : 'saved',
            reason:
              reason ??
              (outcome === 'interrupted'
                ? 'Parent session is departing.'
                : 'Cancellation requested.'),
          };
        }),
      };
    });
    for (const id of ids) {
      const waiters = this.resumes.get(id);
      this.resumes.delete(id);
      for (const resume of waiters ?? []) resume();
      const session = this.runtime.session(id);
      if (session)
        void session.abort().catch(error => {
          try {
            this.host.context.ui.notify(
              `Subagent stopping failed: ${String(error)}`,
              'error',
            );
          } catch {
            /* The cancellation state remains authoritative. */
          }
        });
      if (!this.executions.has(id)) await this.announce(id);
    }
    return {
      status: ids.length ? 'accepted' : 'already-ended',
      message: ids.length ? 'cancellation accepted.' : 'Task already ended.',
      tasks: ids,
    };
  }

  private async communicate(
    input: SubagentInput,
    caller: string | null,
    kind: 'steer' | 'message' | 'report',
  ) {
    if (input.text === undefined)
      throw new Error('Communication requires text.');
    const source = caller ? this.task(caller) : undefined;
    const targetId =
      kind === 'report'
        ? (source?.parentTaskId ?? null)
        : (input.taskId ?? null);
    if (kind === 'report' && source === undefined)
      throw new Error('Only a child assignment can report to its parent.');
    if (kind !== 'report' && targetId === null)
      throw new Error('Communication requires a target taskId.');
    const delivery = await this.mailbox.deliver(
      kind,
      caller,
      targetId,
      input.text,
    );
    const message = `[Subagent ${kind} ${delivery.message.id}]\n${input.text}`;
    const session = targetId ? this.runtime.session(targetId) : undefined;
    if (session) {
      const custom = {
        customType: 'subagent-message',
        content: message,
        display: true,
      };
      if (kind === 'steer' && session.isStreaming) {
        await session.steer(message);
      } else if (session.isStreaming) {
        await session.sendCustomMessage(custom, {deliverAs: 'steer'});
      } else {
        await session.sendCustomMessage(custom, {triggerTurn: false});
      }
    }
    return {
      status: 'accepted',
      messageId: delivery.message.id,
      consumed: false,
    };
  }

  private async dispatch(input: SubagentInput, caller: string | null) {
    if (this.closing) {
      const failure = this.record.storageError;
      throw new Error(
        failure
          ? `Session is departing because saving failed: ${failure}`
          : 'Session is departing or saving failed; admission is closed.',
      );
    }
    if (!input.tasks?.length) throw new Error('dispatch requires tasks.');
    const parentManager = caller
      ? this.runtime.session(caller)?.sessionManager
      : this.host.context.sessionManager;
    if (!parentManager)
      throw new Error('The parent context is not available for delegation.');
    const {dispatchId, agents, tasks} = await prepareAdmission(
      input.tasks,
      caller,
      this.record,
      this.settings,
      this.host.context,
      caller ? this.effectiveTools(caller) : this.host.tools(),
    );
    const needsHistory = tasks.some(task => task.configuration.copyHistory);
    const history = needsHistory
      ? captureParentHistory({sessionManager: parentManager})
      : undefined;
    const admittedTasks: TaskRecord[] = [];
    for (const task of tasks) {
      const historyFile = task.configuration.copyHistory
        ? join(this.store.directory, 'history', `${task.id}.json`)
        : null;
      if (historyFile && history)
        await Effect.runPromise(writeParentHistory(history, historyFile));
      admittedTasks.push({...task, historyFile});
    }
    await this.update(record => {
      if (this.closing)
        throw new Error('Session is departing; admission is closed.');
      if (
        caller &&
        (this.task(caller).stopOutcome !== null ||
          this.task(caller).phase === 'ended')
      )
        throw new Error('Parent no longer accepts descendants.');
      const count =
        record.dispatches.find(dispatch => dispatch.id === dispatchId)
          ?.admitted ?? 0;
      if (count + tasks.length > (this.settings.tasksPerDispatch ?? 64))
        throw new Error('Dispatch task allowance exceeded.');
      if (
        caller &&
        tasks.some(task =>
          task.currentTools.some(
            tool => !this.effectiveTools(caller).includes(tool),
          ),
        )
      )
        throw new Error('Parent tool ceiling changed before admission.');
      return {
        ...record,
        agents: [...record.agents, ...agents],
        tasks: [...record.tasks, ...admittedTasks],
        dispatches: caller
          ? record.dispatches.map(dispatch =>
              dispatch.id === dispatchId
                ? {...dispatch, admitted: dispatch.admitted + tasks.length}
                : dispatch,
            )
          : [...record.dispatches, {id: dispatchId, admitted: tasks.length}],
      };
    });
    this.schedule();
    return {
      status: 'accepted',
      dispatchId,
      tasks: tasks.map(task => ({taskId: task.id, agentId: task.agentId})),
    };
  }

  private schedule() {
    if (this.closing) return;
    for (const [id, waiters] of this.resumes) {
      if (this.slots.size >= (this.settings.concurrency ?? 8)) break;
      this.slots.add(id);
      this.resumes.delete(id);
      for (const resume of waiters) resume();
    }
    for (const task of this.record.tasks) {
      if (this.slots.size >= (this.settings.concurrency ?? 8)) break;
      if (task.phase !== 'queued' || this.executions.has(task.id)) continue;
      if (this.controls.isReleasing(task.agentId)) continue;
      if (this.record.agents.find(agent => agent.id === task.agentId)?.held)
        continue;
      if (
        [...this.executions.keys()].some(
          id => this.task(id).agentId === task.agentId,
        )
      )
        continue;
      const readiness = dependencyReadiness(task, this.record.tasks);
      if (readiness === 'waiting') continue;
      if (readiness !== 'ready') {
        const skip = this.update(record =>
          settleTask(
            record,
            task.id,
            'skipped',
            'A prerequisite has no saved fulfilled result.',
          ),
        )
          .then(() => this.announce(task.id))
          .catch(error => {
            this.storageFailure(error instanceof Error ? error : String(error));
          })
          .finally(() => {
            this.executions.delete(task.id);
            this.schedule();
          });
        this.executions.set(task.id, skip);
        continue;
      }
      this.slots.add(task.id);
      const execution = this.runtime
        .run(task.id)
        .catch(error => {
          this.storageFailure(error instanceof Error ? error : String(error));
        })
        .finally(() => {
          this.executions.delete(task.id);
          this.slots.delete(task.id);
          this.schedule();
        });
      this.executions.set(task.id, execution);
    }
  }

  private releaseSlot(id: string) {
    const calls = this.runtime.activeToolCalls(id);
    if (calls.some(call => !this.runtime.isWaitingCall(id, call))) return;
    void this.runtime
      .pauseClock(id)
      .catch(error =>
        this.storageFailure(error instanceof Error ? error : String(error)),
      );
    this.slots.delete(id);
    this.schedule();
  }

  private async acquireSlot(id: string) {
    if (this.task(id).stopOutcome !== null) return;
    if (this.slots.has(id)) return;
    await new Promise<void>(resolve => {
      const waiters = this.resumes.get(id) ?? new Set<() => void>();
      waiters.add(resolve);
      this.resumes.set(id, waiters);
      this.schedule();
    });
    if (this.task(id).stopOutcome === null) this.runtime.resumeClock(id);
  }

  private wakeWaiters() {
    const waiters = [...this.resumes.values()].flatMap(group => [...group]);
    this.resumes.clear();
    for (const resume of waiters) resume();
  }

  private async until(predicate: () => boolean, milliseconds?: number) {
    if (predicate()) return;
    await new Promise<void>(resolve => {
      const finish = () => {
        if (timeout) clearTimeout(timeout);
        unsubscribe();
        resolve();
      };
      const unsubscribe = this.subscribe(() => {
        if (predicate()) finish();
      });
      const timeout =
        milliseconds === undefined
          ? undefined
          : setTimeout(finish, milliseconds);
    });
  }

  private async cancelOwned(id: string) {
    const children = this.record.tasks.filter(
      task => task.parentTaskId === id && task.phase !== 'ended',
    );
    for (const child of children)
      await this.cancel(
        {command: 'cancel', taskId: child.id},
        null,
        this.task(id).stopOutcome ?? 'cancelled',
      );
    await this.until(() =>
      this.record.tasks
        .filter(task => task.parentTaskId === id)
        .every(task => task.phase === 'ended'),
    );
  }

  private async announce(id: string): Promise<void> {
    const task = this.task(id);
    try {
      this.host.notify(task);
    } catch (error) {
      try {
        this.host.context.ui.notify(
          `Subagent saved; notification failed: ${String(error)}`,
          'error',
        );
      } catch {
        /* Durable task state remains authoritative. */
      }
    }
    await this.notices.announce(task.dispatchId);
  }

  private async workspaceOperation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.workspaceTail;
    let release!: () => void;
    this.workspaceTail = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async wait(
    input: SubagentInput,
    caller: string | null,
    callId?: string,
  ) {
    const selected = () =>
      this.record.tasks.filter(
        task =>
          (caller === null || task.parentTaskId === caller) &&
          (!input.taskId || task.id === input.taskId) &&
          (!input.dispatchId || task.dispatchId === input.dispatchId),
      );
    if (input.taskId && !selected().some(task => task.id === input.taskId))
      throw new Error(
        'Wait target is unavailable or not owned by this assignment.',
      );
    const relevant = () => this.mailbox.addressed(caller);
    const ended = new Set(
      selected()
        .filter(task => task.phase === 'ended')
        .map(task => task.id),
    );
    if (!selected().every(task => task.phase === 'ended') && !relevant()) {
      if (caller && callId) {
        await this.runtime.waitForCall(
          caller,
          callId,
          'explicit result wait',
          'Waiting for owned results.',
          () =>
            this.task(caller).stopOutcome !== null ||
            relevant() !== undefined ||
            selected().some(
              task => task.phase === 'ended' && !ended.has(task.id),
            ),
          input.timeoutMs ?? this.settings.resultWaitMs ?? 60000,
        );
        if (this.task(caller).stopOutcome !== null)
          throw new Error('Wait interrupted by cancellation.');
      } else {
        await this.until(
          () =>
            relevant() !== undefined ||
            selected().some(
              task => task.phase === 'ended' && !ended.has(task.id),
            ),
          input.timeoutMs ?? this.settings.resultWaitMs ?? 60000,
        );
      }
    }
    const message = relevant();
    if (message && this.store.writable)
      await this.mailbox.consume([message.id]);
    const changed = selected().some(
      task => task.phase === 'ended' && !ended.has(task.id),
    );
    const waitStatus = message
      ? message.kind === 'question'
        ? 'question'
        : 'message'
      : selected().every(task => task.phase === 'ended')
        ? 'settled'
        : changed
          ? 'changed'
          : 'expired';
    if (caller && (waitStatus === 'settled' || waitStatus === 'changed'))
      await this.change(caller, {
        consumedChildren: [
          ...new Set([
            ...this.task(caller).consumedChildren,
            ...selected()
              .filter(task => task.phase === 'ended')
              .map(task => task.id),
          ]),
        ],
      });
    return {
      ...this.inspect(input, caller),
      waitStatus,
      wakeMessageId: message?.id ?? null,
      wakeMessageKind: message?.kind ?? null,
    };
  }

  async close() {
    this.closing = true;
    if (!this.openedWritable) {
      this.journal.close();
      await Effect.runPromise(this.store.close());
      return;
    }
    let failure: Error | undefined;
    const attempt = async (operation: () => Promise<void>) => {
      try {
        await operation();
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error(String(error));
      }
    };
    await attempt(() => this.journal.waitForWrites());
    if (this.snapshot.storageError !== null)
      await attempt(() => this.journal.retry());
    if (this.record.tasks.some(task => task.phase !== 'ended'))
      await attempt(() =>
        this.cancel({command: 'cancel'}, null, 'interrupted').then(
          () => undefined,
        ),
      );
    await attempt(() => this.runtime.abortAll());
    await attempt(() => Promise.all(this.executions.values()).then(() => {}));
    await attempt(() => this.journal.waitForWrites());
    if (this.snapshot.storageError !== null)
      failure ??= new Error(
        'Subagent records have not been durably saved; departure remains blocked.',
      );
    if (failure) throw failure;
    this.journal.close();
    await Effect.runPromise(this.store.close());
  }
}
