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

  render(lines: string[], width: number, rows: number, theme: Theme): string[] {
    const wrapped = lines.flatMap(line => wrapTextWithAnsi(line, width));
    const contentRows = Math.max(1, rows - 1);
    this.pages = Math.max(1, Math.ceil(wrapped.length / contentRows));
    this.page = Math.min(this.page, this.pages - 1);
    const start = this.page * contentRows;
    return [
      ...fillRows(wrapped.slice(start, start + contentRows), contentRows),
      theme.fg(
        'dim',
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
    `${left}${theme.fg('dim', gap >= 5 ? ` ${'.'.repeat(gap - 2)} ` : ' '.repeat(gap))}${value}`,
    width,
    '...',
  );
}
