import {getMarkdownTheme, type Theme} from '@earendil-works/pi-coding-agent';
import {
  truncateToWidth,
  wrapTextWithAnsi,
  type TUI,
} from '@earendil-works/pi-tui';
import type {FleetRow} from './fleet';
import type {RequestRecord} from './records';
import type {Runs} from './runs';
import {Reading, type ReadingSource} from './reading';
import {Transcript} from './transcript';

export class TranscriptView {
  private readonly reading = new Reading(true);
  private source: ReadingSource = {
    revision: 'loading',
    render: () => ['Loading retained transcript...'],
  };
  private loading = false;
  private pending = false;
  private disposed = false;

  constructor(
    readonly row: FleetRow,
    private readonly runs: Runs,
    private readonly tui: TUI,
    readonly request?: RequestRecord,
  ) {
    this.refresh();
  }

  refresh(): void {
    if (this.disposed) return;
    if (this.loading) {
      this.pending = true;
      return;
    }
    this.loading = true;
    void this.runs
      .readSession(this.row.run.id, this.row.task.id)
      .then(native => {
        if (this.disposed) return;
        const task =
          this.row.run.tasks.find(task => task.id === this.row.task.id) ??
          this.row.task;
        const retained = [...task.history, task];
        const requests = structuredClone(
          this.request
            ? [
                retained.find(
                  record => record.requestId === this.request?.requestId,
                ) ?? this.request,
              ]
            : retained,
        );
        const revision = JSON.stringify([
          native.sessionManager.getLeafId(),
          requests.map(request => [
            request.requestId,
            request.endEntryId,
            request.status,
          ]),
        ]);
        if (this.source.revision === revision) return;
        const transcript = new Transcript({
          ...native,
          requests,
          cwd: task.workspace?.cwd ?? task.cwd,
          tui: this.tui,
          markdownTheme: getMarkdownTheme(),
        });
        this.source = {revision, render: width => transcript.render(width)};
      })
      .catch(error => {
        if (this.disposed) return;
        const message = `Transcript unavailable: ${error instanceof Error ? error.message : String(error)}`;
        this.source = {
          revision: message,
          render: width => wrapTextWithAnsi(message, width),
        };
      })
      .finally(() => {
        this.loading = false;
        if (this.disposed) return;
        this.tui.requestRender();
        if (this.pending) {
          this.pending = false;
          this.refresh();
        }
      });
  }

  handleInput(data: string): boolean {
    if (this.source.revision === 'loading') return false;
    return this.reading.handleInput(data);
  }

  render(width: number, height: number, theme: Theme): string[] {
    if (this.source.revision === 'loading')
      return [
        truncateToWidth(
          theme.bold(`${this.row.task.agent} · Transcript`),
          width,
          '…',
        ),
        ...wrapTextWithAnsi('Loading retained transcript...', width),
        theme.fg('dim', 'esc back'),
      ];
    const help = wrapTextWithAnsi(
      theme.fg('dim', '[/] page · f follow latest · esc back'),
      width,
    );
    const content = this.reading.render(
      this.source,
      width,
      height - help.length - 2,
    );
    return [
      truncateToWidth(
        theme.bold(`${this.row.task.agent} · Transcript`),
        width,
        '…',
      ),
      ...content,
      theme.fg('dim', truncateToWidth(this.reading.position, width, '…')),
      ...help,
    ];
  }

  dispose(): void {
    this.disposed = true;
  }
}
