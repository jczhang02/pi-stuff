import {getMarkdownTheme, type Theme} from '@earendil-works/pi-coding-agent';
import {
  Markdown,
  truncateToWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import type {FleetRow} from './fleet';
import {requestTime, requestTokens, taskState} from './fleet';
import {Reading} from './reading';

export class Inspection {
  private prompt = false;
  private readonly reading = new Reading();

  constructor(
    readonly row: FleetRow,
    private readonly queuedReason?: () => string | undefined,
  ) {}

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
    return this.reading.handleInput(data);
  }

  render(
    width: number,
    height: number,
    theme: Pick<Theme, 'fg' | 'bold'>,
    actions = '',
    composing = false,
  ): string[] {
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
      ...task.pendingInstructions.map(text => `Queued instruction\n\n${text}`),
    ]
      .filter(Boolean)
      .join('\n\n');
    const heading =
      theme.bold(task.agent) +
      ` · ${taskState(task, this.row.run.tasks) || 'Working'} · ${requestTime(task, Date.now())} · ${requestTokens(task)}`;
    const help = composing
      ? []
      : wrapTextWithAnsi(
          theme.fg(
            'dim',
            `${actions ? actions + '\n' : ''}p prompt${task.sessionFile ? ' · t transcript' : ''} · i info · [/] page${this.row.run.tasks.some(task => task.needs.length) ? ' · g graph' : ''}${this.reading.paused ? ' · f latest' : ''} · esc back`,
          ),
          width,
        );
    const wording = task.task;
    const lines = this.reading.render(
      {
        revision: JSON.stringify([wording, body]),
        render: columns => [
          ...(this.prompt
            ? new Markdown(wording, 0, 0, getMarkdownTheme()).render(columns)
            : [theme.fg('muted', '▸ Prompt')]),
          '',
          ...new Markdown(body, 0, 0, getMarkdownTheme()).render(columns),
        ],
      },
      width,
      height - help.length - 3,
    );
    return [
      truncateToWidth(heading, width, '…'),
      ...lines,
      theme.fg('dim', truncateToWidth(this.reading.position, width, '…')),
      ...help,
    ];
  }
}
