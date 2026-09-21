import {stripTerminalSequences} from '@earendil-works/pi-tui';

export interface ReadingSource {
  readonly revision: string;
  render(width: number): string[];
}

function contentCells(line: string): string[] {
  return stripTerminalSequences(line)
    .split('│')
    .map(cell => cell.replace(/[\s\u2500-\u257f]/g, ''));
}

/** Paging policy for Pi's public editor slot, which does not lay out ScrollView. */
export class Reading {
  private offset = 0;
  private budget = 1;
  private frozen: ReadingSource | undefined;
  private latest: ReadingSource | undefined;
  private width = 0;
  private previousLines: string[] = [];
  private total = 0;

  constructor(private readonly followEnd = false) {}

  get paused(): boolean {
    return this.frozen !== undefined;
  }

  get position(): string {
    const changed =
      this.frozen && this.frozen.revision !== this.latest?.revision;
    return `${this.offset + 1}–${Math.min(this.total, this.offset + this.budget)} / ${this.total}${changed ? ' · New output' : ''}`;
  }

  freeze(): void {
    this.frozen ??= this.latest;
  }

  reset(): void {
    this.offset = 0;
    this.frozen = undefined;
  }

  rewind(): void {
    this.offset = 0;
  }

  handleInput(data: string): boolean {
    if (data === 'f') {
      this.reset();
      return true;
    }
    if (data !== '[' && data !== ']') return false;
    this.freeze();
    this.offset = Math.max(
      0,
      this.offset + (data === '[' ? -this.budget : this.budget),
    );
    return true;
  }

  render(source: ReadingSource, width: number, height: number): string[] {
    this.latest = source;
    const lines = (this.frozen ?? source).render(width);
    if (this.width !== width && this.offset > 0) {
      // Match within a table column: wrapping can interleave separate cells.
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
    this.budget = Math.max(1, height);
    this.total = lines.length;
    this.offset =
      this.followEnd && !this.paused
        ? Math.max(0, lines.length - this.budget)
        : Math.min(this.offset, Math.max(0, lines.length - this.budget));
    return lines.slice(this.offset, this.offset + this.budget);
  }
}
