import {
  keyHint,
  type ExtensionContext,
  type KeybindingsManager,
} from '@earendil-works/pi-coding-agent';
import {
  Editor,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
  type EditorTheme,
  type Focusable,
  type TUI,
} from '@earendil-works/pi-tui';
import type {FleetRow} from './fleet';
import type {ContinuationInput} from './protocol';
import type {TaskSnapshot} from './records';
import type {Runs} from './runs';

export type InterventionAction =
  | 'message'
  | 'resume'
  | 'follow-up'
  | 'reply'
  | 'stop';

interface InterventionTarget {
  readonly key: string;
  readonly action: InterventionAction;
  readonly runId: string;
  readonly taskId: string;
  readonly requestId: string;
  readonly agent: string;
  readonly questionId: string | undefined;
  readonly questionText: string | undefined;
  readonly downstream: readonly string[];
}

const LIVE_STATUSES: readonly TaskSnapshot['status'][] = [
  'queued',
  'starting',
  'running',
  'awaiting_parent',
];

function draftKey(
  runId: string,
  taskId: string,
  requestId: string,
  action: InterventionAction,
  questionId: string | undefined,
): string {
  return JSON.stringify([runId, taskId, requestId, action, questionId ?? '']);
}

function actionLabel(action: InterventionAction): string {
  switch (action) {
    case 'message':
      return 'Message';
    case 'resume':
      return 'Resume';
    case 'follow-up':
      return 'Follow-up';
    case 'reply':
      return 'Reply';
    case 'stop':
      return 'Stop';
  }
}

function errorText(error: Error | string): string {
  return error instanceof Error ? error.message : error;
}

export class Intervention implements Component, Focusable {
  private readonly editor: Editor;
  private readonly drafts = new Map<string, string>();
  private target: InterventionTarget | undefined;
  private generation = 0;
  private busyGeneration: number | undefined;
  private editorDraft = '';
  private submissionDraft: string | undefined;
  private suppressDraftChange = false;
  private disposed = false;

  constructor(
    private readonly tui: TUI,
    editorTheme: EditorTheme,
    private readonly keys: KeybindingsManager,
    private readonly runs: Runs,
    private readonly ctx: ExtensionContext,
    private readonly returnToDetail: (accepted: boolean) => void,
  ) {
    this.editor = new Editor(tui, editorTheme);
    this.editor.onChange = () => {
      if (this.suppressDraftChange) return;
      this.editorDraft = this.editor.getExpandedText();
      const target = this.target;
      if (target && target.action !== 'stop')
        this.drafts.set(target.key, this.editorDraft);
    };
    this.editor.onSubmit = text => {
      void this.submit(text);
    };
  }

  get active(): boolean {
    return this.target !== undefined;
  }

  get action(): InterventionAction | undefined {
    return this.target?.action;
  }

  get retainedQuestionText(): string | undefined {
    return this.target?.questionText;
  }

  get actionHelp(): string {
    const target = this.target;
    if (!target) return '';
    if (this.busyGeneration !== undefined) return 'Sending... · esc back';
    if (target.action === 'stop')
      return `${keyHint('tui.select.confirm', 'confirm')} · esc back`;
    return `${keyHint('tui.input.submit', 'send')} · ${keyHint('tui.input.newLine', 'newline')} · esc back`;
  }

  open(row: FleetRow, action: InterventionAction): void {
    if (this.disposed) return;
    const unavailable = this.unavailable(row, action);
    if (unavailable !== undefined) {
      this.ctx.ui.notify(unavailable, 'warning');
      return;
    }

    this.leave(false, false);
    const task = row.task;
    const question = action === 'reply' ? task.question : undefined;
    const questionId = question?.id;
    const target: InterventionTarget = {
      key: draftKey(row.run.id, task.id, task.requestId, action, questionId),
      action,
      runId: row.run.id,
      taskId: task.id,
      requestId: task.requestId,
      agent: task.agent,
      questionId,
      questionText: question?.text,
      downstream: row.run.tasks
        .filter(candidate => candidate.needs.includes(task.id))
        .map(candidate => candidate.agent),
    };
    this.target = target;
    this.editorDraft = this.drafts.get(target.key) ?? '';
    this.editor.disableSubmit = action === 'stop';
    this.setEditorText(action === 'stop' ? '' : this.editorDraft);
    this.tui.setFocus(this);
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    const target = this.target;
    if (!target) return;

    if (target.action === 'stop') {
      if (matchesKey(data, 'escape')) this.close();
      else if (this.keys.matches(data, 'tui.select.confirm')) this.submitStop();
      return;
    }

    if (
      matchesKey(data, 'escape') ||
      this.keys.matches(data, 'tui.select.cancel')
    ) {
      this.close();
      return;
    }

    // Native submit may also come from Pi's newline fallback. Capture input
    // before native handling; onSubmit decides whether it was a submission.
    this.submissionDraft = this.editor.getExpandedText();
    try {
      this.editor.handleInput(data);
    } finally {
      this.submissionDraft = undefined;
    }
  }

  render(width: number, maxHeight?: number): string[] {
    const target = this.target;
    if (!target) return [];

    const height =
      maxHeight === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(1, Math.floor(maxHeight));
    const safeWidth = Math.max(1, width);

    const heading = truncateToWidth(
      `${actionLabel(target.action)} ${target.agent}`,
      Math.max(0, width),
      '…',
    );
    if (target.action === 'stop') {
      const help = wrapTextWithAnsi(this.actionHelp, safeWidth);
      const context = [
        'Confirming requests cancellation of this child. Its recorded output and any partial work remain subject to finalization.',
        target.downstream.length
          ? `Direct dependent tasks that may be skipped: ${target.downstream.join(', ')}. Independent tasks continue.`
          : 'No direct dependent tasks are affected.',
      ].join('\n');
      const contextLines = this.boundedContext(
        context,
        safeWidth,
        Math.max(0, height - 1 - help.length),
        '(stop consequence continues in detail)',
      );
      return [heading, ...contextLines, ...help];
    }

    const editorLines = this.editor.render(width);
    const help = wrapTextWithAnsi(this.actionHelp, safeWidth);
    const lines = [heading];
    if (target.action === 'reply' && target.questionText !== undefined) {
      lines.push(
        ...this.boundedContext(
          `Question: ${target.questionText}`,
          safeWidth,
          Math.max(0, height - 1 - editorLines.length - help.length),
          '(question continues in detail)',
        ),
      );
    }
    lines.push(...editorLines, ...help);
    return lines;
  }

  invalidate(): void {
    this.editor.invalidate();
  }

  close(): void {
    this.leave(false, true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.leave(false, false);
  }

  get focused(): boolean {
    return this.editor.focused;
  }

  set focused(value: boolean) {
    this.editor.focused = value;
  }

  unavailable(row: FleetRow, action: InterventionAction): string | undefined {
    const task = row.task;
    if (action === 'message') {
      if (task.finalizing)
        return `${task.agent} is finalizing and cannot receive a message.`;
      if (task.status !== 'running')
        return `Message is unavailable while ${task.agent} is ${task.status}.`;
      if (row.run.status !== 'running')
        return `Message is unavailable because run ${row.run.id} has settled.`;
    }
    if (action === 'reply') {
      if (task.question === undefined)
        return `${task.agent} has no pending question.`;
      if (task.status !== 'awaiting_parent')
        return `${task.agent} is not awaiting a parent reply.`;
      if (task.finalizing) return `${task.agent} is stopping or finalizing.`;
      if (task.question.expiresAt <= Date.now())
        return `The question from ${task.agent} has expired.`;
    }
    if (action === 'resume' || action === 'follow-up') {
      const expected =
        action === 'resume' ? ['failed', 'stopped'] : ['completed'];
      if (!expected.includes(task.status))
        return `${actionLabel(action)} is unavailable while ${task.agent} is ${task.status}.`;
      if (task.finalizing)
        return `${task.agent} is finalizing and cannot be continued yet.`;
      if (row.run.status === 'running')
        return `Wait for run ${row.run.id} to settle before continuing ${task.agent}.`;
      if (!task.sessionFile || !task.sessionId)
        return `${task.agent} has no saved session to continue.`;
    }
    if (action === 'stop') {
      if (!LIVE_STATUSES.includes(task.status))
        return `Stop is unavailable while ${task.agent} is ${task.status}.`;
      if (task.finalizing)
        return `${task.agent} is finalizing and cannot be stopped again.`;
    }
    return undefined;
  }

  private leave(accepted: boolean, returnToDetail: boolean): void {
    const hadTarget = this.target !== undefined;
    if (hadTarget) this.rememberDraft();
    this.clearTarget();
    if (returnToDetail && hadTarget) this.returnToDetail(accepted);
  }

  private clearTarget(): void {
    this.target = undefined;
    this.busyGeneration = undefined;
    this.submissionDraft = undefined;
    this.generation += 1;
    this.editor.disableSubmit = false;
    this.editor.focused = false;
    this.tui.requestRender();
  }

  private boundedContext(
    text: string,
    width: number,
    maxHeight: number,
    marker: string,
  ): string[] {
    if (maxHeight <= 0) return [];
    const lines = wrapTextWithAnsi(text, width);
    if (lines.length <= maxHeight) return lines;
    const continuation = truncateToWidth(marker, width, '…');
    return maxHeight === 1
      ? [continuation]
      : [...lines.slice(0, maxHeight - 1), continuation];
  }

  private rememberDraft(): void {
    const target = this.target;
    if (!target || target.action === 'stop') return;
    this.drafts.set(target.key, this.editorDraft);
  }

  private setEditorText(text: string): void {
    this.suppressDraftChange = true;
    this.editor.setText(text);
    this.suppressDraftChange = false;
    this.editorDraft = text;
  }

  private currentTask(target: InterventionTarget): TaskSnapshot {
    const result = this.runs.result(target.runId, target.taskId);
    if ('tasks' in result)
      throw new Error(`Expected task ${target.taskId}, but received its run.`);
    return result;
  }

  private validateTarget(target: InterventionTarget): void {
    const task = this.currentTask(target);
    if (task.requestId !== target.requestId)
      throw new Error('This request changed. Reopen the child before sending.');
    if (
      target.action === 'reply' &&
      (target.questionId === undefined ||
        task.question?.id !== target.questionId ||
        task.status !== 'awaiting_parent' ||
        task.finalizing)
    )
      throw new Error('This question is no longer awaiting a reply.');
    if (target.action === 'stop' && !LIVE_STATUSES.includes(task.status))
      throw new Error(
        `Stop is no longer available while ${task.agent} is ${task.status}.`,
      );
  }

  private isCurrent(target: InterventionTarget, generation: number): boolean {
    return (
      !this.disposed && this.target === target && this.generation === generation
    );
  }

  private async runText(
    target: InterventionTarget,
    message: string,
  ): Promise<void> {
    this.validateTarget(target);
    switch (target.action) {
      case 'message':
        await this.runs.steer(target.runId, target.taskId, message);
        return;
      case 'resume':
      case 'follow-up': {
        const input: ContinuationInput = {
          command: target.action,
          runId: target.runId,
          taskId: target.taskId,
          message,
        };
        await this.runs.continueTask(input, this.ctx);
        return;
      }
      case 'reply':
        if (target.questionId === undefined)
          throw new Error('This child has no pending question.');
        this.runs.reply(
          target.runId,
          target.taskId,
          target.questionId,
          message,
        );
        return;
      case 'stop':
        throw new Error('Stop confirmation does not accept a message.');
    }
  }

  private submit(text: string): Promise<void> {
    const target = this.target;
    if (
      !target ||
      target.action === 'stop' ||
      this.busyGeneration !== undefined
    )
      return Promise.resolve();
    const submittedDraft = this.submissionDraft ?? this.editorDraft;
    this.editorDraft = submittedDraft;
    this.drafts.set(target.key, submittedDraft);
    if (text.length === 0) {
      this.setEditorText(submittedDraft);
      this.ctx.ui.notify('A message is required.', 'warning');
      return Promise.resolve();
    }

    const generation = this.generation;
    this.busyGeneration = generation;
    this.editor.disableSubmit = true;
    const operation = this.runText(target, text)
      .then(() => {
        if (this.disposed) return;
        const unchangedDraft = this.drafts.get(target.key) === submittedDraft;
        if (unchangedDraft) this.drafts.delete(target.key);
        if (!this.isCurrent(target, generation)) {
          if (
            unchangedDraft &&
            this.target?.key === target.key &&
            this.editorDraft === submittedDraft
          )
            this.setEditorText('');
          this.tui.requestRender();
          return;
        }
        this.busyGeneration = undefined;
        this.editor.disableSubmit = false;
        if (this.editorDraft !== submittedDraft || !unchangedDraft) {
          this.tui.requestRender();
          return;
        }
        this.editor.addToHistory(text);
        this.drafts.delete(target.key);
        this.setEditorText('');
        this.clearTarget();
        this.returnToDetail(true);
      })
      .catch(error => {
        if (!this.isCurrent(target, generation)) return;
        this.busyGeneration = undefined;
        this.editor.disableSubmit = false;
        if (
          this.editorDraft === submittedDraft &&
          this.drafts.get(target.key) === submittedDraft
        ) {
          this.drafts.set(target.key, submittedDraft);
          this.setEditorText(submittedDraft);
        }
        this.ctx.ui.notify(
          errorText(error instanceof Error ? error : String(error)),
          'error',
        );
        this.tui.requestRender();
      });
    return operation;
  }

  private submitStop(): void {
    const target = this.target;
    if (
      !target ||
      target.action !== 'stop' ||
      this.busyGeneration !== undefined
    )
      return;
    const generation = this.generation;
    this.busyGeneration = generation;
    try {
      this.validateTarget(target);
      this.runs.cancel(target.runId, target.taskId);
      if (!this.isCurrent(target, generation)) return;
      this.clearTarget();
      this.returnToDetail(true);
    } catch (error) {
      if (!this.isCurrent(target, generation)) return;
      this.busyGeneration = undefined;
      this.ctx.ui.notify(
        errorText(error instanceof Error ? error : String(error)),
        'error',
      );
      this.tui.requestRender();
    }
  }
}
