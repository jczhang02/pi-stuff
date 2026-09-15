// Throwaway execution adapter for the FleetView prototype.
//
// The task lifecycle below is a focused rewrite of the runtime path in
// @arhen/pi-core-subagent 1.3.54, src/manager.ts, commit
// de1c8783c2a39b1cbb0f86b412307193de9774c1. It deliberately leaves the
// upstream widget, sidecar persistence and worktree code out of this visual
// prototype. Pi still owns each child AgentSession, its event stream and its
// cancellation boundary.

import type {AgentMessage} from '@earendil-works/pi-agent-core';
import type {ImageContent, TextContent} from '@earendil-works/pi-ai';
import {Schema} from 'effect';
import type {
  AgentSession,
  AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import {
  createPrototypeSession,
  type ChildSessionFactory,
  resetPrototypeResponse,
  type AskParent,
  type NotifyParent,
  type PrototypeSession,
} from './prototype-provider';
import {applyUpstream, resolveNeeds} from './prototype-graph';
import type {
  Activity,
  FleetAgent,
  FleetController,
  FleetTask,
  Question,
  Steering,
  TaskAction,
  TaskStatus,
} from './prototype-model';

type ParentNotice = (message: string, kind: 'info' | 'error') => void;

interface MutableTask {
  id: string;
  agentName: string;
  description: string;
  prompt: string;
  status: TaskStatus;
  startedAt: number | undefined;
  endedAt: number | undefined;
  outputTokens: number;
  activity: Activity[];
  steering: Steering[];
  question: Question | undefined;
  result: string | undefined;
  detail: string;
  progress: string;
  model: string;
  parentTaskId: string | undefined;
  needs: readonly string[];
  settled: Promise<void> | undefined;
  awaitingDescendants: boolean;
  error: string | undefined;
}

interface AgentRecord {
  readonly name: string;
  readonly tasks: MutableTask[];
  holder: ChildHolder | undefined;
}

interface ChildHolder {
  readonly session: AgentSession;
  readonly provider: PrototypeSession['provider'];
  readonly setActiveTask: PrototypeSession['setActiveTask'];
  unsubscribe: () => void;
  activeTask: MutableTask;
}

interface PendingQuestion {
  readonly questionId: string;
  readonly complete: (answer: string) => void;
  readonly cancel: () => void;
}

const GRAPH_CONCURRENCY = 3;
const QUESTION_TIMEOUT_MS = 600_000;
const INSPECTION_ARGS = Schema.Struct({path: Schema.String});

export type PrototypeFleetErrorCode =
  | 'unknown_task'
  | 'task_not_active'
  | 'stale_question'
  | 'no_completed_task';

export class PrototypeFleetError extends Error {
  readonly code: PrototypeFleetErrorCode;

  constructor(code: PrototypeFleetErrorCode, message: string) {
    super(message);
    this.name = 'PrototypeFleetError';
    this.code = code;
  }
}

type ContentBlock = TextContent | ImageContent;

function isContentBlocks(
  content: string | readonly ContentBlock[],
): content is readonly ContentBlock[] {
  return Array.isArray(content);
}

function contentText(
  content: string | readonly (TextContent | ImageContent)[],
): string {
  if (isContentBlocks(content))
    return content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('');
  return content;
}

function messageText(message: AgentMessage): string {
  if (message.role === 'user') return contentText(message.content);
  if (message.role === 'assistant')
    return message.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('');
  if (message.role === 'toolResult') return contentText(message.content);
  return '';
}

function errorMessage(error: Error): string {
  return error.message || 'The subagent failed without an error message.';
}

function isTerminal(status: TaskStatus): boolean {
  return (
    status === 'completed' ||
    status === 'cancelled' ||
    status === 'failed' ||
    status === 'skipped'
  );
}

function isFailedDependency(status: TaskStatus): boolean {
  return status === 'cancelled' || status === 'failed' || status === 'skipped';
}

function canSteer(task: MutableTask, holder: ChildHolder | undefined): boolean {
  return (
    holder?.activeTask === task &&
    (task.status === 'running' ||
      (task.status === 'waiting' && task.startedAt !== undefined)) &&
    !task.awaitingDescendants
  );
}

function canFollowUp(agent: AgentRecord, task: MutableTask): boolean {
  return (
    agent.tasks.at(-1) === task &&
    task.status === 'completed' &&
    agent.holder?.session.isIdle === true
  );
}

function displayTask(
  task: MutableTask,
  actions: readonly TaskAction[],
): FleetTask {
  const end = task.endedAt ?? Date.now();
  const elapsedSeconds =
    task.startedAt === undefined
      ? 0
      : Math.max(0, Math.floor((end - task.startedAt) / 1000));
  return {
    id: task.id,
    description: task.description,
    prompt: task.prompt,
    status: task.status,
    elapsedSeconds,
    outputTokens: task.outputTokens,
    activity: [...task.activity],
    steering: [...task.steering],
    question: task.question,
    result: task.result,
    detail: task.detail,
    progress: task.progress,
    model: task.model,
    actions,
    parentTaskId: task.parentTaskId,
  };
}

export class PrototypeFleet implements FleetController {
  private readonly agentsByName = new Map<string, AgentRecord>();
  private readonly tasksById = new Map<string, MutableTask>();
  private readonly needs = new Map<string, readonly string[]>();
  private readonly changedCallback: () => void;
  private readonly notifyCallback: ParentNotice;
  private readonly cwd: string;
  private readonly agentDir: string;
  private readonly scenario: string;
  private readonly childSessionFactory: ChildSessionFactory;
  private started = false;
  private stopped = false;
  private stopPromise: Promise<void> | undefined;
  private schedulerPromise: Promise<void> | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private probeTimer: ReturnType<typeof setTimeout> | undefined;
  private questionSequence = 1;
  private followUpSequence = 1;
  private readonly pendingQuestions = new Map<string, PendingQuestion>();

  constructor(
    cwd: string,
    agentDir: string,
    scenario: string,
    changed: () => void,
    notify: ParentNotice,
    childSessionFactory: ChildSessionFactory = createPrototypeSession,
  ) {
    this.cwd = cwd;
    this.agentDir = agentDir;
    this.scenario = scenario;
    this.changedCallback = changed;
    this.notifyCallback = notify;
    this.childSessionFactory = childSessionFactory;
    this.prepareScenario();
  }

  agents(): readonly FleetAgent[] {
    return [...this.agentsByName.values()].map(agent => ({
      name: agent.name,
      tasks: agent.tasks.map(task => {
        const actions: TaskAction[] = [];
        if (this.pendingQuestions.has(task.id) && task.status === 'waiting')
          actions.push('reply');
        if (canSteer(task, agent.holder)) actions.push('steer');
        if (canFollowUp(agent, task)) actions.push('followUp');
        if (!isTerminal(task.status) && task.status !== 'cancelling')
          actions.push('cancel');
        return displayTask(task, actions);
      }),
    }));
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.refreshTimer = setInterval(() => this.render(), 1000);
    this.schedulerPromise = this.runGraph();
    if (this.scenario === 'cancel') {
      this.probeTimer = setTimeout(() => {
        const probe = this.tasksById.get('T4');
        if (!probe || this.stopped || probe.status !== 'queued') return;
        void this.launchTask(probe, probe.prompt, false);
      }, 350);
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopAll();
    return this.stopPromise;
  }

  steer(taskId: string, text: string): void {
    const task = this.tasksById.get(taskId);
    if (!task)
      throw new PrototypeFleetError(
        'unknown_task',
        'The selected task no longer exists.',
      );
    const holder = this.agentsByName.get(task.agentName)?.holder;
    if (!holder || !canSteer(task, holder)) {
      throw new PrototypeFleetError(
        'task_not_active',
        `${task.agentName} is no longer accepting steering for this task.`,
      );
    }
    const steering: Steering = {text, state: 'pending'};
    task.steering.push(steering);
    task.detail = 'Steering queued for the next model turn.';
    this.render();
    void holder.session.steer(text).catch((error: Error) => {
      const index = task.steering.indexOf(steering);
      if (index >= 0) task.steering[index] = {text, state: 'unprocessed'};
      this.notice(
        `Steering could not be delivered to ${task.agentName}: ${errorMessage(error)}`,
        'error',
      );
      this.render();
    });
  }

  reply(taskId: string, questionId: string, text: string): void {
    const task = this.tasksById.get(taskId);
    if (!task)
      throw new PrototypeFleetError(
        'unknown_task',
        'The selected task no longer exists.',
      );
    const pending = this.pendingQuestions.get(taskId);
    if (
      !task ||
      !pending ||
      task.question?.id !== questionId ||
      task.status !== 'waiting'
    ) {
      throw new PrototypeFleetError(
        'stale_question',
        `${task.agentName} is no longer waiting for this answer.`,
      );
    }
    task.question = {...task.question, answer: text};
    task.status = 'running';
    task.detail = 'Parent answer received. Resuming.';
    pending.complete(text);
    this.render();
  }

  followUp(agentName: string, text: string): void {
    const agent = this.agentsByName.get(agentName);
    const previous = agent?.tasks.at(-1);
    const holder = agent?.holder;
    if (!agent || !previous || !holder || !canFollowUp(agent, previous)) {
      throw new PrototypeFleetError(
        'no_completed_task',
        `No completed idle task is available for ${agentName}.`,
      );
    }
    const taskId = `${previous.id}-followup-${this.followUpSequence++}`;
    const task = this.addTask(agentName, taskId, text, text, [], undefined);
    task.detail = 'Starting follow-up with retained context.';
    this.notice(`Follow-up started for ${agentName}.`, 'info');
    void this.launchTask(task, text, true);
  }

  cancel(taskId: string): void {
    const task = this.tasksById.get(taskId);
    if (!task) {
      throw new PrototypeFleetError(
        'unknown_task',
        'The selected task no longer exists.',
      );
    }
    if (isTerminal(task.status)) {
      throw new PrototypeFleetError(
        'task_not_active',
        `${task.agentName} has already stopped this task.`,
      );
    }
    const branch = this.branchTasks(task);
    for (const branchTask of branch) this.requestCancellation(branchTask);
    this.notice(`Cancellation requested for ${task.agentName}.`, 'info');
    this.render();
  }

  private prepareScenario(): void {
    this.addTask(
      'lifecycle',
      'T1',
      'Trace cancellation behavior',
      'Inspect cancellation.ts and report when a cancellation request becomes a stopped task.',
      [],
      undefined,
    );
    this.addTask(
      'packages',
      'T2',
      'Compare existing package behavior',
      'Inspect packages.md and report how existing subagent packages handle task control.',
      [],
      undefined,
    );
    this.addTask(
      'reviewer',
      'T3',
      'Review both findings',
      'Compare the lifecycle and package findings, then state the resulting cancellation recommendation. {previous}',
      ['T1', 'T2'],
      undefined,
    );
    if (this.scenario === 'cancel') {
      this.addTask(
        'probe',
        'T4',
        'Probe descendant cancellation',
        'Inspect cancellation.test.ts while the lifecycle task owns this descendant.',
        [],
        'T1',
      );
    }
    resolveNeeds([...this.tasksById.keys()], this.needs);
  }

  private addTask(
    agentName: string,
    taskId: string,
    description: string,
    prompt: string,
    needs: readonly string[],
    parentTaskId: string | undefined,
  ): MutableTask {
    const task: MutableTask = {
      id: taskId,
      agentName,
      description,
      prompt,
      status: needs.length > 0 ? 'waiting' : 'queued',
      startedAt: undefined,
      endedAt: undefined,
      outputTokens: 0,
      activity: [],
      steering: [],
      question: undefined,
      result: undefined,
      detail:
        needs.length > 0
          ? `Waiting for ${needs.map(id => this.tasksById.get(id)?.agentName ?? 'another agent').join(', ')}.`
          : 'Queued.',
      progress: '',
      model: '',
      parentTaskId,
      needs,
      settled: undefined,
      awaitingDescendants: false,
      error: undefined,
    };
    let agent = this.agentsByName.get(agentName);
    if (!agent) {
      agent = {name: agentName, tasks: [], holder: undefined};
      this.agentsByName.set(agentName, agent);
    }
    agent.tasks.push(task);
    this.tasksById.set(taskId, task);
    this.needs.set(taskId, needs);
    return task;
  }

  private async runGraph(): Promise<void> {
    const pending = new Set(
      [...this.tasksById.keys()].filter(taskId => taskId !== 'T4'),
    );
    const outputs = new Map<string, string>();
    const active = new Map<string, Promise<void>>();
    while (pending.size > 0 || active.size > 0) {
      if (this.stopped) {
        for (const taskId of pending)
          this.markSkipped(
            this.tasksById.get(taskId),
            'Session stopped before dispatch.',
          );
        pending.clear();
      }
      for (const taskId of pending) {
        const task = this.tasksById.get(taskId);
        if (!task || (task.status !== 'queued' && task.status !== 'waiting')) {
          pending.delete(taskId);
          continue;
        }
        const dependencies = this.needs.get(taskId) ?? [];
        const waitingFor = dependencies
          .filter(id => this.tasksById.get(id)?.status !== 'completed')
          .map(id => this.tasksById.get(id)?.agentName ?? 'another agent');
        if (waitingFor.length > 0)
          task.detail = `Waiting for ${waitingFor.join(', ')}.`;
        const failed = dependencies.find(dependency =>
          isFailedDependency(
            this.tasksById.get(dependency)?.status ?? 'failed',
          ),
        );
        if (failed) {
          pending.delete(taskId);
          this.markSkipped(
            task,
            `${this.tasksById.get(failed)?.agentName ?? 'An upstream agent'} did not complete.`,
          );
          continue;
        }
        if (
          active.size >= GRAPH_CONCURRENCY ||
          !dependencies.every(
            dependency =>
              this.tasksById.get(dependency)?.status === 'completed',
          )
        )
          continue;
        pending.delete(taskId);
        const effectivePrompt = applyUpstream(
          task.prompt,
          dependencies,
          outputs,
          new Map(
            dependencies.map(id => [
              id,
              this.tasksById.get(id)?.agentName ?? 'another agent',
            ]),
          ),
        );
        const execution = this.launchTask(task, effectivePrompt, false).then(
          () => {
            if (task.status === 'completed' && task.result)
              outputs.set(task.id, task.result);
          },
        );
        active.set(taskId, execution);
      }
      if (active.size === 0) {
        for (const taskId of pending)
          this.markSkipped(
            this.tasksById.get(taskId),
            'No runnable dependency wave remains.',
          );
        pending.clear();
        break;
      }
      const finished = await Promise.race(
        [...active.entries()].map(async ([taskId, execution]) => {
          await execution;
          return taskId;
        }),
      );
      active.delete(finished);
    }
    this.render();
  }

  private launchTask(
    task: MutableTask,
    prompt: string,
    resetResponse: boolean,
  ): Promise<void> {
    if (task.settled || isTerminal(task.status)) return Promise.resolve();
    task.status = 'running';
    task.prompt = prompt;
    task.startedAt = Date.now();
    task.detail = 'Starting Pi session.';
    const execution = this.driveTask(task, prompt, resetResponse);
    task.settled = execution;
    return execution;
  }

  private async driveTask(
    task: MutableTask,
    prompt: string,
    resetResponse: boolean,
  ): Promise<void> {
    let holder: ChildHolder | undefined;
    try {
      holder = await this.ensureHolder(task);
      holder.activeTask = task;
      holder.setActiveTask(task.id);
      const model = holder.session.model;
      task.model =
        model && !holder.provider
          ? `${model.provider}/${model.id} · ${holder.session.thinkingLevel}`
          : '';
      if (resetResponse && holder.provider)
        resetPrototypeResponse(
          holder.provider,
          task.agentName,
          task.id,
          this.scenario,
        );
      if (task.status === 'cancelling' || task.status === 'cancelled') {
        await holder.session.abort();
      } else {
        await holder.session.prompt(prompt, {source: 'extension'});
      }
      await this.waitForOwnedTasksAfterLoop(task);
      if (task.status === 'cancelling' || task.status === 'cancelled') {
        this.completeCancellation(task);
      } else if (task.error) {
        this.failTask(task, new Error(task.error));
      } else if (task.status === 'running' || task.status === 'waiting') {
        this.completeTask(task);
      }
    } catch (error) {
      await this.waitForOwnedTasksAfterLoop(task);
      if (task.status === 'cancelling' || task.status === 'cancelled') {
        this.completeCancellation(task);
      } else {
        this.failTask(
          task,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }

  private async ensureHolder(task: MutableTask): Promise<ChildHolder> {
    const agent = this.agentsByName.get(task.agentName);
    if (!agent) throw new Error(`Unknown subagent ${task.agentName}.`);
    if (agent.holder) return agent.holder;
    const askParent: AskParent = (taskId, question, signal) =>
      this.waitForParent(taskId, question, signal);
    const notifyParent: NotifyParent = (taskId, message, level) => {
      this.notice(
        `${this.tasksById.get(taskId)?.agentName ?? agent.name}: ${message}`,
        level === 'error' ? 'error' : 'info',
      );
    };
    const created = await this.childSessionFactory(
      this.cwd,
      this.agentDir,
      task.agentName,
      task.id,
      this.scenario,
      askParent,
      notifyParent,
    );
    const holder: ChildHolder = {
      session: created.session,
      provider: created.provider,
      setActiveTask: created.setActiveTask,
      unsubscribe: () => undefined,
      activeTask: task,
    };
    holder.unsubscribe = created.session.subscribe((event: AgentSessionEvent) =>
      this.onSessionEvent(holder, event),
    );
    agent.holder = holder;
    return holder;
  }

  private onSessionEvent(holder: ChildHolder, event: AgentSessionEvent): void {
    const task = holder.activeTask;
    if (event.type === 'message_start' && event.message.role === 'assistant') {
      task.progress = '';
      if (task.status === 'running') task.detail = 'Thinking...';
      this.render();
    }
    if (event.type === 'message_update' && event.message.role === 'assistant') {
      task.progress = messageText(event.message).slice(-1200);
      if (task.status === 'running' && task.progress)
        task.detail = 'Writing response...';
      this.render();
    }
    if (event.type === 'auto_retry_start') {
      if (task.status === 'running') task.detail = 'Retrying model request...';
      this.render();
    }
    if (event.type === 'message_start' && event.message.role === 'user') {
      const text = messageText(event.message);
      const index = task.steering.findIndex(
        steering => steering.state === 'pending' && steering.text === text,
      );
      if (index >= 0) {
        const steering = task.steering[index];
        if (steering)
          task.steering[index] = {text: steering.text, state: 'consumed'};
        task.detail = 'Steering consumed by the next model turn.';
        this.render();
      }
    }
    if (event.type === 'tool_execution_start') {
      const title =
        event.toolName === 'inspect_cancellation'
          ? 'Inspect cancellation'
          : event.toolName;
      const text =
        event.toolName === 'inspect_cancellation' &&
        Schema.is(INSPECTION_ARGS)(event.args)
          ? `Reading ${event.args.path}`
          : 'Running operation.';
      task.activity.push({id: event.toolCallId, title, text});
      if (task.activity.length > 8) task.activity.shift();
      if (task.status === 'running') task.detail = text;
      this.render();
    }
    if (event.type === 'tool_execution_update') {
      this.render();
    }
    if (event.type === 'tool_execution_end') {
      const index = task.activity.findIndex(
        activity => activity.id === event.toolCallId,
      );
      const resultText = contentText(event.result.content);
      if (index >= 0) {
        const activity = task.activity[index];
        if (activity) {
          task.activity[index] = {
            ...activity,
            text: event.isError
              ? resultText || `Failed: ${event.toolName}`
              : resultText || `Completed ${event.toolName}.`,
          };
        }
      }
      if (task.status === 'running')
        task.detail = event.isError
          ? `Tool failed: ${event.toolName}`
          : 'Thinking...';
      this.render();
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const message = event.message;
      task.outputTokens += message.usage.output;
      const text = messageText(message);
      task.progress = text.slice(-1200);
      if (message.stopReason === 'stop' && text) task.result = text;
      task.error =
        message.stopReason === 'error'
          ? (message.errorMessage ?? 'The model returned an error.')
          : undefined;
      this.render();
    }
    if (event.type === 'agent_end' && !event.willRetry) this.render();
    if (event.type === 'agent_settled') this.render();
  }

  private async waitForOwnedTasksAfterLoop(task: MutableTask): Promise<void> {
    task.awaitingDescendants = true;
    try {
      const waits = this.branchTasks(task)
        .slice(1)
        .map(descendant => descendant.settled)
        .filter((settled): settled is Promise<void> => settled !== undefined);
      if (waits.length > 0) {
        if (task.status === 'running')
          task.detail = 'Waiting for child tasks to stop.';
        this.render();
        await Promise.all(waits);
      }
    } finally {
      task.awaitingDescendants = false;
    }
  }

  private async waitForParent(
    taskId: string,
    questionText: string,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const task = this.tasksById.get(taskId);
    if (!task || isTerminal(task.status))
      throw new Error('The task has already ended before asking its parent.');
    const questionId = `Q${this.questionSequence++}`;
    task.question = {id: questionId, text: questionText, answer: undefined};
    task.status = 'waiting';
    task.detail = 'Waiting for parent answer.';
    this.notice(`${task.agentName} asks: ${questionText}`, 'info');
    this.render();
    return new Promise<string>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        timer = undefined;
        signal?.removeEventListener('abort', onAbort);
      };
      const complete = (answer: string): void => {
        cleanup();
        this.pendingQuestions.delete(taskId);
        resolve(answer);
      };
      const cancel = (): void => {
        cleanup();
        this.pendingQuestions.delete(taskId);
        reject(
          new Error(
            'The task was cancelled while waiting for the parent answer.',
          ),
        );
      };
      const onTimeout = (): void => {
        cleanup();
        this.pendingQuestions.delete(taskId);
        task.status = 'running';
        task.detail = 'No answer received. Proceeding with best judgment.';
        this.render();
        resolve(
          'No answer arrived before the question timeout. Proceed with best judgment.',
        );
      };
      const onAbort = (): void => cancel();
      const pending: PendingQuestion = {questionId, complete, cancel};
      this.pendingQuestions.set(taskId, pending);
      timer = setTimeout(onTimeout, QUESTION_TIMEOUT_MS);
      signal?.addEventListener('abort', onAbort, {once: true});
      if (signal?.aborted) onAbort();
    });
  }

  private branchTasks(root: MutableTask): MutableTask[] {
    const branch = [root];
    for (let index = 0; index < branch.length; index += 1) {
      const parent = branch[index];
      if (!parent) continue;
      for (const task of this.tasksById.values()) {
        if (task.parentTaskId === parent.id && !branch.includes(task))
          branch.push(task);
      }
    }
    return branch;
  }

  private requestCancellation(task: MutableTask): void {
    if (isTerminal(task.status)) return;
    if (
      (task.status === 'queued' || task.status === 'waiting') &&
      task.startedAt === undefined
    ) {
      task.status = 'cancelled';
      task.endedAt = Date.now();
      task.detail = 'Cancelled before the task started.';
      return;
    }
    task.status = 'cancelling';
    task.detail = 'Stopping active work before cancellation completes.';
    this.pendingQuestions.get(task.id)?.cancel();
    const holder = this.agentsByName.get(task.agentName)?.holder;
    if (holder?.activeTask === task) {
      void holder.session
        .abort()
        .catch((error: Error) =>
          this.notice(
            `Cancellation could not stop ${task.agentName}: ${errorMessage(error)}`,
            'error',
          ),
        );
    }
  }

  private completeTask(task: MutableTask): void {
    if (isTerminal(task.status)) return;
    this.markPendingSteering(task);
    task.status = 'completed';
    task.endedAt = Date.now();
    task.detail = 'Completed.';
    if (!task.result)
      task.result = 'The subagent completed without a final report.';
    this.notice(
      `${task.agentName} finished. Report available in FleetView.`,
      'info',
    );
    this.render();
  }

  private completeCancellation(task: MutableTask): void {
    if (isTerminal(task.status)) return;
    this.markPendingSteering(task);
    task.status = 'cancelled';
    task.endedAt = Date.now();
    task.detail = 'Cancelled after active work stopped.';
    this.notice(
      `${task.agentName} cancelled. Active work has stopped.`,
      'info',
    );
    this.render();
  }

  private failTask(task: MutableTask, error: Error): void {
    if (isTerminal(task.status)) return;
    task.status = 'failed';
    task.error = errorMessage(error);
    task.endedAt = Date.now();
    task.detail = `Failed: ${task.error}`;
    this.markPendingSteering(task);
    this.notice(`${task.agentName} failed: ${task.error}`, 'error');
    this.render();
  }

  private markSkipped(task: MutableTask | undefined, reason: string): void {
    if (!task || isTerminal(task.status)) return;
    task.status = 'skipped';
    task.endedAt = Date.now();
    task.detail = `Skipped: ${reason}`;
    this.render();
  }

  private markPendingSteering(task: MutableTask): void {
    task.steering = task.steering.map(steering =>
      steering.state === 'pending'
        ? {text: steering.text, state: 'unprocessed'}
        : steering,
    );
  }

  private async stopAll(): Promise<void> {
    this.stopped = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.probeTimer) clearTimeout(this.probeTimer);
    for (const pending of this.pendingQuestions.values()) pending.cancel();
    for (const task of this.tasksById.values()) {
      if (!isTerminal(task.status)) this.requestCancellation(task);
    }
    const waits = [...this.tasksById.values()]
      .map(task => task.settled)
      .filter((settled): settled is Promise<void> => settled !== undefined);
    await Promise.all(waits);
    if (this.schedulerPromise) await this.schedulerPromise;
    for (const agent of this.agentsByName.values()) {
      agent.holder?.unsubscribe();
      agent.holder?.session.dispose();
    }
    this.render();
  }

  private notice(message: string, kind: 'info' | 'error'): void {
    try {
      this.notifyCallback(message, kind);
    } catch {
      // Notification failure must not change the task outcome.
    }
  }

  private render(): void {
    try {
      this.changedCallback();
    } catch {
      // A stale renderer must not stop child execution.
    }
  }
}

export async function createPrototypeFleet(
  cwd: string,
  agentDir: string,
  scenario: string,
  changed: () => void,
  notify: ParentNotice,
  childSessionFactory: ChildSessionFactory = createPrototypeSession,
): Promise<PrototypeFleet> {
  return new PrototypeFleet(
    cwd,
    agentDir,
    scenario,
    changed,
    notify,
    childSessionFactory,
  );
}
