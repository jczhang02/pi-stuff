import {getMarkdownTheme, type Theme} from '@earendil-works/pi-coding-agent';
import {
  Markdown,
  truncateToWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import type {FleetRow} from './fleet';
import type {RequestRecord} from './records';
import {taskInfo} from './info';
import {Reading} from './reading';

/** Read-only supporting records, including immutable earlier requests. */
export class DocumentView {
  private readonly reading = new Reading();

  constructor(
    readonly row: FleetRow,
    readonly request?: RequestRecord,
  ) {}

  handleInput(data: string): boolean {
    return this.reading.handleInput(data);
  }

  render(width: number, height: number, theme: Theme): string[] {
    const current =
      this.row.run.tasks.find(task => task.id === this.row.task.id) ??
      this.row.task;
    const task = this.request ?? current;
    const body = this.request
      ? [
          `# ${task.task}`,
          `Status: ${task.status}`,
          task.finalText || 'No reply recorded.',
          taskInfo(task),
        ].join('\n\n')
      : taskInfo(task, current.cumulativeUsage);
    const title = `${task.agent} · ${this.request ? 'Retained request' : 'Info'}`;
    const help = wrapTextWithAnsi(
      theme.fg(
        'dim',
        `[/] page${task.sessionFile ? ' · t transcript' : ''}${this.request ? '' : ' · h history'}${this.reading.paused ? ' · f latest' : ''} · esc back`,
      ),
      width,
    );
    const content = this.reading.render(
      {
        revision: body,
        render: columns =>
          new Markdown(body, 0, 0, getMarkdownTheme()).render(columns),
      },
      width,
      height - help.length - 2,
    );
    return [
      truncateToWidth(theme.bold(title), width, '…'),
      ...content,
      theme.fg('dim', this.reading.position),
      ...help,
    ];
  }
}
