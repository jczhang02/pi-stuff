import {getMarkdownTheme, type Theme} from '@earendil-works/pi-coding-agent';
import {
  Markdown,
  stripTerminalSequences,
  truncateToWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import type {FleetRow} from './fleet';
import {requestTime, requestTokens, taskState} from './fleet';

function contentCells(line: string): string[] {
  return stripTerminalSequences(line)
    .split('│')
    .map(cell => cell.replace(/[\s\u2500-\u257f]/g, ''));
}

export class Inspection {
  private prompt = false;
  private offset = 0;
  private budget = 1;
  private frozen: string | undefined;
  private latest = '';
  private width = 0;
  private previousLines: string[] = [];

  constructor(readonly row: FleetRow) {}

  handleInput(data: string): boolean {
    if (data === 'p') {
      this.prompt = !this.prompt;
      this.offset = 0;
      return true;
    }
    if (data === '[' || data === ']') {
      this.frozen ??= this.latest;
      this.offset = Math.max(
        0,
        this.offset + (data === '[' ? -this.budget : this.budget),
      );
      return true;
    }
    if (data === 'f') {
      this.frozen = undefined;
      this.offset = 0;
      return true;
    }
    return false;
  }

  render(width: number, height: number, theme: Theme): string[] {
    const task =
      this.row.run.tasks.find(task => task.id === this.row.task.id) ??
      this.row.task;
    const failure = [
      task.error,
      task.preservationError && `Commit failed: ${task.preservationError}`,
      task.cleanupError,
      ...(task.extensionErrors ?? []),
    ]
      .filter(value => value !== undefined && value !== '')
      .join('\n\n');
    const question = task.question?.text;
    this.latest = [
      failure,
      question
        ? `Waiting for main\n\n${question}`
        : task.finalText || 'No reply recorded yet.',
      ...task.pendingInstructions.map(text => `Queued instruction\n\n${text}`),
    ]
      .filter(Boolean)
      .join('\n\n');
    const body = this.frozen ?? this.latest;
    const heading =
      theme.bold(task.agent) +
      ` · ${taskState(task, this.row.run.tasks) || 'Working'} · ${requestTime(task, Date.now())} · ${requestTokens(task)}`;
    const prompt = this.prompt
      ? new Markdown(task.task, 0, 0, getMarkdownTheme()).render(width)
      : [theme.fg('muted', '▸ Prompt')];
    const lines = [
      ...prompt,
      '',
      ...new Markdown(body, 0, 0, getMarkdownTheme()).render(width),
    ];
    if (this.width !== width && this.offset > 0) {
      // Native tables interleave wrapped cells. Anchor within one content
      // column so a different wrap cannot reorder the text being matched.
      const previous = this.previousLines.map(contentCells);
      const column =
        previous
          .slice(this.offset)
          .find(row => row.some(Boolean))
          ?.findIndex(Boolean) ?? 0;
      const before = previous.map(row => row[column] ?? '');
      const current = lines.map(line => contentCells(line)[column] ?? '');
      const position = before.slice(0, this.offset).join('').length;
      const anchor = before.join('').slice(position, position + 64);
      const content = current.join('');
      let nearest = -1;
      if (anchor) {
        for (
          let match = content.indexOf(anchor);
          match !== -1;
          match = content.indexOf(anchor, match + 1)
        ) {
          if (
            nearest === -1 ||
            Math.abs(match - position) < Math.abs(nearest - position)
          )
            nearest = match;
        }
      }
      if (nearest !== -1) {
        let consumed = 0;
        this.offset = current.findIndex(line => {
          consumed += line.length;
          return consumed > nearest;
        });
      }
    }
    this.width = width;
    this.previousLines = lines;
    const help = wrapTextWithAnsi(
      theme.fg(
        'dim',
        `p prompt · [/] page${this.row.run.tasks.some(task => task.needs.length) ? ' · g graph' : ''}${this.frozen !== undefined ? ' · f latest' : ''} · esc back`,
      ),
      width,
    );
    this.budget = Math.max(1, height - help.length - 3);
    this.offset = Math.min(
      this.offset,
      Math.max(0, lines.length - this.budget),
    );
    const position = `${this.offset + 1}–${Math.min(lines.length, this.offset + this.budget)} / ${lines.length}${this.frozen !== undefined && this.frozen !== this.latest ? ' · New output' : ''}`;
    return [
      truncateToWidth(heading, width, '…'),
      ...lines.slice(this.offset, this.offset + this.budget),
      theme.fg('dim', truncateToWidth(position, width, '…')),
      ...help,
    ];
  }
}
