import type {Theme} from '@earendil-works/pi-coding-agent';
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';

export const RTK_BODY_ROWS = 18;

// Local corrections for Pi 0.85's built-in light palette on light backgrounds.
// Exclude sourced themes. Pi cannot distinguish an anonymous in-memory theme
// named light from the built-in; only matching original sequences are corrected.
export function readablePanelLines(
  lines: string[],
  theme: Pick<Theme, 'name' | 'sourcePath' | 'sourceInfo' | 'getColorMode'>,
): string[] {
  if (theme.name !== 'light' || theme.sourcePath || theme.sourceInfo)
    return lines;
  const replacements =
    theme.getColorMode() === 'truecolor'
      ? [
          ['\x1b[38;2;90;128;128m', '\x1b[38;2;66;101;101m'],
          ['\x1b[38;2;88;132;88m', '\x1b[38;2;63;105;63m'],
          ['\x1b[38;2;154;115;38m', '\x1b[38;2;127;91;25m'],
          ['\x1b[38;2;118;118;118m', '\x1b[38;2;108;108;108m'],
        ]
      : [
          ['\x1b[38;5;66m', '\x1b[38;5;23m'],
          ['\x1b[38;5;65m', '\x1b[38;5;22m'],
          ['\x1b[38;5;243m', '\x1b[38;5;242m'],
        ];
  return lines.map(line => {
    for (const [before, after] of replacements)
      if (before !== undefined && after !== undefined)
        line = line.replaceAll(before, after);
    return line;
  });
}

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
