import type {Theme} from '@earendil-works/pi-coding-agent';
import {
  truncateToWidth,
  wrapTextWithAnsi,
  stripTerminalSequences,
  type Component,
} from '@earendil-works/pi-tui';

interface HeadingState {
  expanded: boolean;
  isError: boolean;
  isPartial: boolean;
}

// Every tool shares the same marker, continuation column and two-row limit.
// The host still owns disclosure, including when both states look identical.
export class ToolHeading implements Component {
  private width = -1;
  private rows: string[] = [];
  constructor(
    private readonly label: string,
    private readonly target: string,
    private readonly theme: Theme,
    private readonly state: HeadingState,
  ) {}

  invalidate() {
    this.width = -1;
  }

  render(width: number): string[] {
    if (this.width === width) return this.rows;
    const inner = Math.max(1, width - 2);
    const rows = wrapTextWithAnsi(
      `${this.theme.bold(this.label)}(${stripTerminalSequences(this.target)})`,
      inner,
    );
    const shown = this.state.expanded ? rows : rows.slice(0, 2);
    const dot = this.theme.fg(
      this.state.isError
        ? 'error'
        : this.state.isPartial
          ? 'warning'
          : 'success',
      '•',
    );
    this.rows = shown.map((row, index) => {
      const shortened = !this.state.expanded && index === 1 && rows.length > 2;
      const content = shortened ? truncateToWidth(`${row}…`, inner, '…') : row;
      return truncateToWidth(
        `${index === 0 ? `${dot} ` : '  '}${this.theme.fg('toolTitle', content)}`,
        width,
      );
    });
    this.width = width;
    return this.rows;
  }
}
