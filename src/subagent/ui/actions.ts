import type {Coordinator} from '../coordinator';
import {isPendingQuestion} from '../coordinator-mailbox';
import type {FleetRecord, TaskRecord} from '../records';
import type {SubagentInput} from '../protocol';
import {copyToClipboard} from '@earendil-works/pi-coding-agent';
import {descendants} from './navigation';
import type {DraftOperation, DraftTarget, InspectSurface} from './types';

export interface DraftEditorPort {
  beginDraft(target: DraftTarget, prefill: string): void;
  clearDraft(): void;
  draftTargetValue(): DraftTarget | undefined;
  draftText(): string;
  draftRevision(): number;
  draftSubmission():
    | {
        readonly target: DraftTarget;
        readonly text: string;
        readonly revision: number;
      }
    | undefined;
}

export interface TargetedActionHost {
  snapshot(): FleetRecord;
  selectedTask(): TaskRecord | undefined;
  selectedTaskId(): string | undefined;
  editor(): DraftEditorPort | undefined;
  coordinator(): Coordinator;
  pushFrame(): void;
  setSurface(surface: InspectSurface): void;
  setActionIndex(index: number): void;
  setNotice(notice: string | undefined): void;
  notify(message: string, type: 'info' | 'warning' | 'error'): void;
  readerText(task: TaskRecord): string;
  viewGeneration(): number;
  back(): void;
  backToDetail(): void;
  backToFleet(): void;
  requestRender(): void;
}

interface DraftOperationToken {
  readonly key: string;
  readonly generation: number;
  readonly text: string;
  readonly viewGeneration: number;
  readonly taskId: string | undefined;
  readonly editorRevision: number | undefined;
  readonly token: string;
}

/** Owns draft persistence and the coordinator-facing targeted operations. */
export class TargetedActionController {
  private readonly drafts = new Map<string, string>();
  private lateSteerText: string | undefined;
  private stopTaskIds: readonly string[] = [];
  private stopConfirm = false;
  private stopRootTaskId: string | undefined;
  private readonly draftGenerations = new Map<string, number>();
  private readonly inFlight = new Set<string>();

  constructor(private readonly host: TargetedActionHost) {}

  lateSteer(): string | undefined {
    return this.lateSteerText;
  }

  stopTaskIdsState(): readonly string[] {
    return this.stopTaskIds;
  }

  stopConfirmState(): boolean {
    return this.stopConfirm;
  }

  private bumpDraftGeneration(target: DraftTarget): number {
    const key = draftKey(target);
    const generation = (this.draftGenerations.get(key) ?? 0) + 1;
    this.draftGenerations.set(key, generation);
    return generation;
  }

  private ensureDraftGeneration(target: DraftTarget): number {
    const key = draftKey(target);
    const existing = this.draftGenerations.get(key);
    if (existing !== undefined) return existing;
    this.draftGenerations.set(key, 1);
    return 1;
  }

  private beginOperation(
    target: DraftTarget,
    text: string,
  ): DraftOperationToken | undefined {
    const key = draftKey(target);
    const generation = this.ensureDraftGeneration(target);
    const token = `${key}:${generation}`;
    if (this.inFlight.has(token)) {
      const notice = `${target.operation} is already in progress for this draft.`;
      this.host.setNotice(notice);
      this.host.notify(notice, 'warning');
      this.host.requestRender();
      return undefined;
    }
    this.inFlight.add(token);
    // Keep the submitted value recoverable while native Editor.submitValue has
    // already cleared the visible editor and before the coordinator settles.
    this.drafts.set(key, text);
    return {
      key,
      generation,
      text,
      viewGeneration: this.host.viewGeneration(),
      taskId: this.host.selectedTaskId(),
      editorRevision: this.host.editor()?.draftSubmission()?.revision,
      token,
    };
  }

  private finishOperation(operation: DraftOperationToken): void {
    this.inFlight.delete(operation.token);
  }

  private draftGenerationMatches(operation: DraftOperationToken): boolean {
    return this.draftGenerations.get(operation.key) === operation.generation;
  }

  private operationStillOwnsDraft(
    target: DraftTarget,
    operation: DraftOperationToken,
  ): boolean {
    if (!this.draftGenerationMatches(operation)) return false;
    if (this.host.viewGeneration() !== operation.viewGeneration) return false;
    if (this.host.selectedTaskId() !== operation.taskId) return false;
    const editor = this.host.editor();
    if (editor === undefined) return false;
    const currentTarget = editor.draftTargetValue();
    if (
      currentTarget === undefined ||
      draftKey(currentTarget) !== draftKey(target)
    )
      return false;
    if (
      operation.editorRevision !== undefined &&
      editor.draftRevision() !== operation.editorRevision
    )
      return false;
    if (editor.draftText() === operation.text) return true;
    const submission = editor.draftSubmission();
    return (
      submission !== undefined &&
      operation.editorRevision === submission.revision &&
      submission.text === operation.text &&
      draftKey(submission.target) === draftKey(target)
    );
  }

  private retainFailedDraft(
    target: DraftTarget,
    text: string,
    operation: DraftOperationToken,
  ): void {
    if (!this.draftGenerationMatches(operation)) return;
    const editor = this.host.editor();
    const currentTarget = editor?.draftTargetValue();
    const submission = editor?.draftSubmission();
    const submittedRevisionIsCurrent =
      editor !== undefined &&
      operation.editorRevision !== undefined &&
      editor.draftRevision() === operation.editorRevision;
    const submittedTextIsCurrent =
      submission !== undefined &&
      operation.editorRevision === submission.revision &&
      submission.text === text &&
      draftKey(submission.target) === draftKey(target);
    if (
      editor === undefined ||
      currentTarget === undefined ||
      (draftKey(currentTarget) === draftKey(target) &&
        (editor.draftText() === text || submittedTextIsCurrent) &&
        (operation.editorRevision === undefined || submittedRevisionIsCurrent))
    )
      this.drafts.set(draftKey(target), text);
  }

  private restoreRejectedDraft(target: DraftTarget, text: string): void {
    const editor = this.host.editor();
    const submission = editor?.draftSubmission();
    if (
      editor === undefined ||
      submission === undefined ||
      draftKey(submission.target) !== draftKey(target) ||
      submission.text !== text ||
      editor.draftRevision() !== submission.revision ||
      editor.draftText() !== ''
    )
      return;
    this.drafts.set(draftKey(target), text);
    editor.beginDraft(target, text);
  }

  /** Recompute the owned cancellation branch after every coordinator snapshot. */
  refreshStopPreview(): void {
    const task =
      this.stopRootTaskId === undefined
        ? undefined
        : this.host
            .snapshot()
            .tasks.find(candidate => candidate.id === this.stopRootTaskId);
    if (task === undefined) {
      if (this.stopRootTaskId !== undefined) this.stopTaskIds = [];
      return;
    }
    this.stopTaskIds = [
      task.id,
      ...descendants(this.host.snapshot(), task.id).map(child => child.id),
    ];
  }

  startStop(task: TaskRecord): void {
    this.stopRootTaskId = task.id;
    this.stopTaskIds = [
      task.id,
      ...descendants(this.host.snapshot(), task.id).map(child => child.id),
    ];
    this.stopConfirm = false;
    this.host.setSurface('stop');
    this.host.requestRender();
  }

  toggleStopConfirmation(): void {
    this.stopConfirm = !this.stopConfirm;
    this.host.requestRender();
  }

  cancelStop(): void {
    this.stopTaskIds = [];
    this.stopConfirm = false;
    this.stopRootTaskId = undefined;
    this.host.back();
  }

  async confirmStop(): Promise<void> {
    const taskId = this.stopRootTaskId ?? this.host.selectedTaskId();
    if (taskId === undefined) {
      const notice = 'The assignment is no longer retained; stop was not sent.';
      this.host.setNotice(notice);
      this.host.notify(notice, 'warning');
      this.host.requestRender();
      return;
    }
    await this.executeCommand(
      {command: 'cancel', taskId},
      'Cancellation accepted. Cancelling remains visible until stopping settles.',
      'detail',
    );
  }

  async release(task: TaskRecord): Promise<void> {
    await this.executeCommand(
      {command: 'release', agentId: task.agentId},
      'release accepted.',
      'detail',
    );
  }

  async runQueue(
    task: TaskRecord,
    queueAction: 'continue' | 'cancel',
  ): Promise<void> {
    await this.executeCommand(
      {command: 'queue', agentId: task.agentId, queueAction},
      queueAction === 'continue'
        ? 'Queued work resumed.'
        : 'Queued work cancelled.',
      'detail',
    );
  }

  async acknowledge(task: TaskRecord): Promise<void> {
    const notice = this.host
      .snapshot()
      .notices.find(item => item.taskId === task.id && !item.acknowledged);
    if (notice === undefined) {
      const message = 'No unresolved notice is recorded for this assignment.';
      this.host.setNotice(message);
      this.host.notify(message, 'info');
      this.host.requestRender();
      return;
    }
    await this.executeCommand(
      {command: 'acknowledge', noticeId: notice.id},
      'acknowledge accepted.',
      'detail',
    );
  }

  async copyTask(task: TaskRecord): Promise<void> {
    const viewGeneration = this.host.viewGeneration();
    const taskId = this.host.selectedTaskId();
    try {
      await copyToClipboard(this.host.readerText(task));
      this.host.notify('Report and diff copied to the host clipboard.', 'info');
      if (
        this.host.viewGeneration() === viewGeneration &&
        this.host.selectedTaskId() === taskId
      )
        this.host.setNotice('Report and diff copied to the host clipboard.');
    } catch (error) {
      const notice = `Copy unavailable: ${
        error instanceof Error ? error.message : 'host clipboard is unavailable'
      }`;
      this.host.notify(notice, 'error');
      if (
        this.host.viewGeneration() === viewGeneration &&
        this.host.selectedTaskId() === taskId
      )
        this.host.setNotice(notice);
    }
    this.host.requestRender();
  }

  private async executeCommand(
    input: SubagentInput,
    acceptedNotice: string,
    returnSurface: 'detail' | 'fleet' | 'none',
  ): Promise<void> {
    const viewGeneration = this.host.viewGeneration();
    const taskId = this.host.selectedTaskId();
    try {
      await this.host.coordinator().execute(input);
      this.host.notify(acceptedNotice, 'info');
      if (
        this.host.viewGeneration() === viewGeneration &&
        this.host.selectedTaskId() === taskId
      ) {
        this.host.setNotice(acceptedNotice);
        if (returnSurface === 'detail') this.host.backToDetail();
        else if (returnSurface === 'fleet') this.host.backToFleet();
      }
    } catch (error) {
      const notice = `${input.command} unavailable: ${
        error instanceof Error ? error.message : 'operation unavailable'
      }`;
      this.host.notify(notice, 'error');
      if (
        this.host.viewGeneration() === viewGeneration &&
        this.host.selectedTaskId() === taskId
      )
        this.host.setNotice(notice);
    }
    this.host.requestRender();
  }

  saveDraft(target: DraftTarget, text: string): void {
    this.bumpDraftGeneration(target);
    this.drafts.set(draftKey(target), text);
    this.host.editor()?.clearDraft();
    this.host.setNotice(
      text.trim() ? 'Draft saved for this task and operation.' : undefined,
    );
    this.host.back();
    this.host.requestRender();
  }

  private beginDraft(target: DraftTarget): void {
    this.bumpDraftGeneration(target);
    this.host
      .editor()
      ?.beginDraft(target, this.drafts.get(draftKey(target)) ?? '');
  }

  startDraft(operation: DraftOperation, task: TaskRecord): void {
    const snapshot = this.host.snapshot();
    const agent = snapshot.agents.find(item => item.id === task.agentId);
    const question = snapshot.messages.find(
      message =>
        isPendingQuestion(snapshot, message) &&
        (message.taskId === task.id ||
          (message.taskId === null && message.fromTaskId === task.id)),
    );
    const repliesToMain = operation === 'reply' && question?.taskId === null;
    const baseTarget = {
      operation,
      taskId: repliesToMain ? '' : task.id,
      recipient: agent?.name ?? task.id,
      summary:
        question === undefined
          ? `${task.description || task.prompt} · ${this.taskState(task)}`
          : `Question: ${question.text} · ${task.description || task.prompt}`,
    };
    const target: DraftTarget =
      operation === 'reply' && question !== undefined
        ? {...baseTarget, questionId: question.id}
        : baseTarget;
    this.host.pushFrame();
    this.host.setSurface('targeted');
    this.beginDraft(target);
  }

  startRecovery(task: TaskRecord): void {
    const snapshot = this.host.snapshot();
    const agent = snapshot.agents.find(item => item.id === task.agentId);
    const target: DraftTarget = {
      operation: 'followup',
      taskId: task.id,
      recovery: true,
      recipient: agent?.name ?? task.id,
      summary:
        'Recovery creates a retained follow-up and clears the held queue. Describe the work to resume.',
    };
    this.host.pushFrame();
    this.host.setSurface('targeted');
    this.beginDraft(target);
  }

  startMainReply(
    messageId: string,
    questionId: string,
    question: string,
  ): void {
    const snapshot = this.host.snapshot();
    const source = snapshot.messages.find(message => message.id === questionId);
    const sourceTask = source?.fromTaskId
      ? snapshot.tasks.find(task => task.id === source.fromTaskId)
      : undefined;
    const recipient = source?.fromTaskId ? sourceTask?.agentId : undefined;
    const recipientName = recipient
      ? snapshot.agents.find(agent => agent.id === recipient)?.name
      : undefined;
    const target: DraftTarget = {
      operation: 'reply',
      taskId: '',
      questionId,
      recipient: recipientName ?? source?.fromTaskId ?? 'child',
      summary: `Pending child question: ${question}`,
    };
    this.host.pushFrame();
    this.host.setSurface('targeted');
    this.beginDraft(target);
    this.host.setNotice(`Replying to question ${messageId}.`);
  }

  async submit(target: DraftTarget, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      this.host.setNotice('The operation needs text.');
      this.restoreRejectedDraft(target, text);
      this.host.requestRender();
      return;
    }
    const snapshot = this.host.snapshot();
    const task = snapshot.tasks.find(item => item.id === target.taskId);
    const mainQuestion =
      target.operation === 'reply' && target.questionId !== undefined
        ? snapshot.messages.find(
            message =>
              message.id === target.questionId ||
              message.questionId === target.questionId,
          )
        : undefined;
    if (task === undefined && mainQuestion?.taskId === null) {
      const operation = this.beginOperation(target, text);
      if (operation !== undefined)
        await this.executeMainReply(target, text, operation);
      else this.restoreRejectedDraft(target, text);
      return;
    }
    if (task === undefined) {
      const notice = 'The assignment is no longer retained; draft was kept.';
      this.host.setNotice(notice);
      this.host.notify(notice, 'warning');
      this.drafts.set(draftKey(target), text);
      this.restoreRejectedDraft(target, text);
      this.host.requestRender();
      return;
    }
    if (target.operation === 'steer' && task.phase === 'ended') {
      this.lateSteerText = text;
      this.drafts.set(draftKey(target), text);
      this.host.editor()?.clearDraft();
      this.host.setSurface('late-steer');
      this.host.setActionIndex(0);
      this.host.requestRender();
      return;
    }
    const operation = this.beginOperation(target, text);
    if (operation === undefined) {
      this.restoreRejectedDraft(target, text);
      return;
    }
    try {
      const input = this.inputForDraft(target, text);
      await this.host.coordinator().execute(input);
      const notice = `${target.operation} accepted for ${target.recipient}.`;
      this.host.notify(notice, 'info');
      if (this.operationStillOwnsDraft(target, operation)) {
        this.host.setNotice(notice);
        this.drafts.delete(draftKey(target));
        this.host.editor()?.clearDraft();
        this.host.backToDetail();
      }
    } catch (error) {
      const notice = `${target.operation} failed: ${
        error instanceof Error ? error.message : 'operation unavailable'
      }`;
      this.host.notify(notice, 'error');
      if (this.draftGenerationMatches(operation)) {
        const ownsDraft = this.operationStillOwnsDraft(target, operation);
        this.host.setNotice(notice);
        this.retainFailedDraft(target, text, operation);
        if (ownsDraft) this.host.editor()?.beginDraft(target, text);
      }
    } finally {
      this.finishOperation(operation);
    }
    this.host.requestRender();
  }

  convertLateSteer(): void {
    const task = this.host.selectedTask();
    if (task === undefined || this.lateSteerText === undefined) return;
    const text = this.lateSteerText;
    this.lateSteerText = undefined;
    this.startDraft('followup', task);
    this.host.editor()?.clearDraft();
    this.host.editor()?.beginDraft(
      {
        operation: 'followup',
        taskId: task.id,
        recipient:
          this.host.snapshot().agents.find(agent => agent.id === task.agentId)
            ?.name ?? task.id,
        summary: `${task.description || task.prompt} · explicit Follow-up conversion`,
      },
      text,
    );
  }

  keepLateSteer(): void {
    const taskId = this.host.selectedTaskId();
    if (taskId !== undefined && this.lateSteerText !== undefined) {
      this.drafts.set(
        draftKey({
          operation: 'steer',
          taskId,
          recipient: '',
          summary: '',
        }),
        this.lateSteerText,
      );
    }
    this.lateSteerText = undefined;
    this.host.backToDetail();
  }

  private async executeMainReply(
    target: DraftTarget,
    text: string,
    operation: DraftOperationToken,
  ): Promise<void> {
    try {
      await this.host.coordinator().execute(this.inputForDraft(target, text));
      const notice = `Reply accepted for ${target.recipient}.`;
      this.host.notify(notice, 'info');
      if (this.operationStillOwnsDraft(target, operation)) {
        this.host.setNotice(notice);
        this.drafts.delete(draftKey(target));
        this.host.editor()?.clearDraft();
        if (operation.taskId === undefined) this.host.backToFleet();
        else this.host.backToDetail();
      }
    } catch (error) {
      const notice = `reply failed: ${
        error instanceof Error ? error.message : 'operation unavailable'
      }`;
      this.host.notify(notice, 'error');
      if (this.draftGenerationMatches(operation)) {
        const ownsDraft = this.operationStillOwnsDraft(target, operation);
        this.host.setNotice(notice);
        this.retainFailedDraft(target, text, operation);
        if (ownsDraft) this.host.editor()?.beginDraft(target, text);
      }
    } finally {
      this.finishOperation(operation);
    }
    this.host.requestRender();
  }

  private inputForDraft(target: DraftTarget, text: string): SubagentInput {
    if (target.operation === 'reply') {
      if (target.questionId === undefined)
        throw new Error('No pending question is available.');
      return {
        command: 'reply',
        taskId: target.taskId,
        questionId: target.questionId,
        text,
      };
    }
    if (target.operation === 'followup') {
      const task = this.host
        .snapshot()
        .tasks.find(candidate => candidate.id === target.taskId);
      const followup: SubagentInput = {command: 'followup', text};
      if (task === undefined) followup.taskId = target.taskId;
      else followup.agentId = task.agentId;
      if (target.recovery) followup.recovery = true;
      return followup;
    }
    if (target.operation === 'message')
      return {command: 'message', taskId: target.taskId, text};
    return {command: 'steer', taskId: target.taskId, text};
  }

  private taskState(task: TaskRecord): string {
    return task.phase === 'ended' ? (task.outcome ?? task.phase) : task.phase;
  }
}

export function draftKey(target: DraftTarget): string {
  return `${target.operation}:${target.taskId}:${target.questionId ?? ''}`;
}
