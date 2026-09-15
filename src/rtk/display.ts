import type {Theme} from '@earendil-works/pi-coding-agent';
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';

export const RTK_BODY_ROWS = 18;

export function fillRows(lines: string[], rows: number): string[] {
  return [
    ...lines,
    ...Array<string>(Math.max(0, rows - lines.length)).fill(''),
  ];
}

export interface ReportSection {
  readonly header: readonly string[];
  readonly lines: readonly string[];
}

interface RenderedReportPage {
  readonly header: readonly string[];
  readonly lines: readonly string[];
  readonly contentRows: number;
}

// Page the rendered lines so wrapped text remains reachable at every width.
export class ReportPager {
  private page = 0;
  private pages = 1;

  reset() {
    this.page = 0;
    this.pages = 1;
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, Key.leftbracket))
      this.page = Math.max(0, this.page - 1);
    else if (matchesKey(data, Key.rightbracket))
      this.page = Math.min(this.pages - 1, this.page + 1);
    else return false;
    return true;
  }

  render(
    lines: readonly string[],
    width: number,
    rows: number,
    theme: Theme,
    header: readonly string[] = [],
  ): string[] {
    return this.renderSections([{header, lines}], width, rows, theme);
  }

  renderSections(
    sections: readonly ReportSection[],
    width: number,
    rows: number,
    theme: Theme,
  ): string[] {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeRows = Math.max(1, Math.floor(rows));
    const pages: RenderedReportPage[] = [];
    for (const section of sections) {
      const wrappedHeader = section.header.flatMap(line =>
        wrapTextWithAnsi(line, safeWidth),
      );
      const wrapped = section.lines.flatMap(line =>
        wrapTextWithAnsi(line, safeWidth),
      );
      const contentRows = Math.max(1, safeRows - wrappedHeader.length - 1);
      const sectionPages = Math.max(1, Math.ceil(wrapped.length / contentRows));
      for (let sectionPage = 0; sectionPage < sectionPages; sectionPage++) {
        const start = sectionPage * contentRows;
        pages.push({
          header: wrappedHeader,
          lines: wrapped.slice(start, start + contentRows),
          contentRows,
        });
      }
    }
    if (pages.length === 0) {
      const contentRows = Math.max(1, safeRows - 1);
      pages.push({header: [], lines: [], contentRows});
    }
    this.pages = pages.length;
    this.page = Math.min(this.page, this.pages - 1);
    const current = pages[this.page] ?? pages[0];
    if (current === undefined) return [];
    return [
      ...current.header,
      ...fillRows([...current.lines], current.contentRows),
      theme.fg(
        'muted',
        `Page ${this.page + 1}/${this.pages}${this.pages > 1 ? ' · [ Previous · ] Next' : ''}`,
      ),
    ];
  }
}

export function dataRow(
  theme: Theme,
  label: string,
  value: string,
  width: number,
) {
  const size = Math.min(width, 72);
  const left = `  ${theme.fg('muted', label)}`;
  const gap = Math.max(2, size - visibleWidth(left) - visibleWidth(value));
  return truncateToWidth(
    `${left}${theme.fg('muted', gap >= 5 ? ` ${'.'.repeat(gap - 2)} ` : ' '.repeat(gap))}${value}`,
    width,
    '...',
  );
}
