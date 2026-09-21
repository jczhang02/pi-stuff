import {
  getMarkdownTheme,
  sessionEntryToContextMessages,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  Markdown,
  truncateToWidth,
  wrapTextWithAnsi,
  visibleWidth,
  type TUI,
} from '@earendil-works/pi-tui';
import type {FleetRow} from './fleet';
import {requestTime, requestTokens, taskState} from './fleet';
import {Reading} from './reading';
import {Activity} from './activity';
import {requestEntries} from './transcript';
import type {Runs} from './runs';

export class Inspection {
  private prompt = false;
  private readonly reading = new Reading();
  private activity: Activity | undefined;
  private activityRevision = '';
  private activityError: string | undefined;
  private activityExpanded: boolean | undefined;
  private loading = false;
  private pending = false;
  private disposed = false;
  private composing = false;
  private displayedActivity = false;

  constructor(
    readonly row: FleetRow,
    private readonly queuedReason?: () => string | undefined,
    private readonly native?: {runs: Runs; tui: TUI},
  ) {
    this.refresh();
  }

  refresh(): void {
    const owner = this.native;
    if (!owner || this.disposed) return;
    if (this.loading) {
      this.pending = true;
      return;
    }
    const task = this.currentRow().task;
    if (!task.sessionFile) return;
    this.loading = true;
    void owner.runs
      .readSession(this.row.run.id, task.id)
      .then(native => {
        if (this.disposed) return;
        if (task.requestId !== this.currentRow().task.requestId) {
          this.pending = true;
          return;
        }
        const range = requestEntries(native.sessionManager, task);
        if (range.unavailable) throw new Error(range.unavailable);
        const revision = JSON.stringify([
          task.requestId,
          native.sessionManager.getLeafId(),
          [...native.pendingToolCalls],
        ]);
        this.activityError = undefined;
        if (revision === this.activityRevision) return;
        this.activity = new Activity({
          ...native,
          messages: structuredClone(
            range.entries.flatMap(sessionEntryToContextMessages),
          ),
          cwd: task.workspace?.cwd ?? task.cwd,
          tui: owner.tui,
        });
        this.activityRevision = revision;
        this.activityError = undefined;
      })
      .catch(error => {
        if (this.disposed) return;
        this.activityError = `Activity unavailable: ${error instanceof Error ? error.message : String(error)}`;
      })
      .finally(() => {
        this.loading = false;
        if (this.disposed) return;
        this.native?.tui.requestRender();
        if (this.pending) {
          this.pending = false;
          this.refresh();
        }
      });
  }

  dispose(): void {
    this.disposed = true;
  }

  currentRow(): FleetRow {
    return {
      run: this.row.run,
      task:
        this.row.run.tasks.find(task => task.id === this.row.task.id) ??
        this.row.task,
    };
  }

  freeze(): void {
    this.reading.freeze();
  }

  handleInput(data: string): boolean {
    if (data === 'p') {
      this.prompt = !this.prompt;
      this.reading.rewind();
      return true;
    }
    if (data === 'a') {
      this.activityExpanded = !this.displayedActivity;
      this.reading.rewind();
      return true;
    }
    return this.reading.handleInput(data);
  }

  render(
    width: number,
    height: number,
    theme: Pick<Theme, 'fg' | 'bold'>,
    actions = '',
    composing = false,
  ): string[] {
    this.composing = composing;
    const task = this.currentRow().task;
    const failure = [
      task.error,
      task.preservationError && `Commit failed: ${task.preservationError}`,
      task.cleanupError,
      ...(task.extensionErrors ?? []),
    ]
      .filter(value => value !== undefined && value !== '')
      .join('\n\n');
    const question = task.question?.text;
    const body = [
      failure,
      this.queuedReason?.(),
      question
        ? `Waiting for main\n\n${question}`
        : task.finalText || 'No reply recorded yet.',
      task.finalText && (task.status === 'failed' || task.status === 'stopped')
        ? 'Retained output is incomplete.'
        : undefined,
      task.git?.status === 'committed'
        ? `Code saved: ${task.git.commitSha}`
        : task.git?.status === 'empty'
          ? 'No code changes to save.'
          : undefined,
      ...task.pendingInstructions.map(text => `Queued instruction\n\n${text}`),
    ]
      .filter(Boolean)
      .join('\n\n');
    const state = taskState(task, this.row.run.tasks) || 'Working';
    const name = truncateToWidth(
      task.agent,
      Math.max(
        1,
        Math.min(24, Math.floor(width / 3), width - visibleWidth(state) - 3),
      ),
      '…',
    );
    const identity = `${theme.bold(name)} · ${state}`;
    const metrics = `${requestTime(task, Date.now())} · ${requestTokens(task)}`;
    const heading =
      visibleWidth(identity) + visibleWidth(metrics) + 3 <= width
        ? `${identity} · ${metrics}`
        : identity;
    const help = composing
      ? []
      : wrapTextWithAnsi(
          theme.fg(
            'dim',
            `${actions ? actions + '\n' : ''}p prompt${task.sessionFile ? ' · a activity · t transcript' : ''} · i info · [/] page${this.row.run.tasks.some(task => task.needs.length) ? ' · g graph' : ''}${this.reading.paused ? ' · f latest' : ''} · esc back`,
          ),
          width,
        );
    const wording = task.task;
    const activity = this.activity;
    const activityError = this.activityError;
    const hasSession = Boolean(task.sessionFile);
    const activityDefault = !task.endedAt && !task.question;
    const activityOpen = () => {
      this.displayedActivity =
        !this.composing && (this.activityExpanded ?? activityDefault);
      return this.displayedActivity;
    };
    const lines = this.reading.render(
      {
        revision: JSON.stringify([
          wording,
          body,
          this.activityRevision,
          activityError,
        ]),
        render: columns => [
          ...(this.prompt
            ? new Markdown(wording, 0, 0, getMarkdownTheme()).render(columns)
            : [theme.fg('muted', '▸ Prompt')]),
          '',
          ...new Markdown(body, 0, 0, getMarkdownTheme()).render(columns),
          ...(hasSession
            ? [
                '',
                theme.fg('muted', `${activityOpen() ? '▾' : '▸'} Activity`),
                ...(activityOpen()
                  ? activityError
                    ? wrapTextWithAnsi(activityError, columns)
                    : (activity?.render(columns) ?? ['Loading activity...'])
                  : []),
              ]
            : []),
        ],
      },
      width,
      height - help.length - 3,
    );
    return [
      truncateToWidth(heading, width, '…'),
      theme.fg(
        'muted',
        truncateToWidth(
          `${task.task.replace(/[\r\n]/g, ' ')}${task.model ? ` · ${task.model}` : ''}`,
          width,
          '…',
        ),
      ),
      ...lines,
      theme.fg('dim', truncateToWidth(this.reading.position, width, '…')),
      ...help,
    ];
  }
}
