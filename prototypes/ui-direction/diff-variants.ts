// Throwaway layout candidates over the same edit, using Pi's syntax highlighter.
import {highlightCode, type Theme} from '@earendil-works/pi-coding-agent';
import {
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';

export type DiffVariant = 'unified' | 'split' | 'paired';
export const diffBefore = [
  'export function paginate(page: Page, previousIds: string[]) {',
  '  const items = uniqueById(page.items);',
  '  const nextCursor = page.cursor;',
  '  return {items, nextCursor};',
  '}',
];
export const diffAfter = [
  'export function paginate(page: Page, previousIds: string[]) {',
  '  const seen = new Set(previousIds);',
  '  const items = uniqueById(page.items)',
  '    .filter(item => !seen.has(item.id));',
  '  const nextCursor = page.cursor;',
  '  return {items, nextCursor};',
  '}',
];
const firstLine = 18;

function emphasize(
  line: string,
  source: string,
  changed: string,
  theme: Theme,
): string {
  const index = source.indexOf(changed);
  if (index < 0) return line;
  const start = visibleWidth(source.slice(0, index));
  const length = visibleWidth(changed);
  return (
    sliceByColumn(line, 0, start) +
    theme.underline(theme.bold(sliceByColumn(line, start, length))) +
    sliceByColumn(line, start + length, visibleWidth(line))
  );
}

function codeRows(prefix: string, code: string, columns: number): string[] {
  const gutterWidth = visibleWidth(prefix);
  return wrapTextWithAnsi(code, Math.max(1, columns - gutterWidth)).map(
    (line, index) => (index === 0 ? prefix : ' '.repeat(gutterWidth)) + line,
  );
}

export function diffVariantLines(
  theme: Theme,
  width: number,
  variant: DiffVariant,
): string[] {
  const before = highlightCode(diffBefore.join('\n'), 'typescript');
  const after = highlightCode(diffAfter.join('\n'), 'typescript').map(
    (line, index) => {
      const changed =
        index === 1
          ? 'new Set(previousIds)'
          : index === 3
            ? '!seen.has(item.id)'
            : '';
      return changed
        ? emphasize(line, diffAfter[index] ?? '', changed, theme)
        : line;
    },
  );
  const rows: {
    old?: number;
    next?: number;
    kind: 'context' | 'remove' | 'add';
  }[] = [
    {old: 0, next: 0, kind: 'context'},
    {old: 1, kind: 'remove'},
    {next: 1, kind: 'add'},
    {next: 2, kind: 'add'},
    {next: 3, kind: 'add'},
    {old: 2, next: 4, kind: 'context'},
    {old: 3, next: 5, kind: 'context'},
    {old: 4, next: 6, kind: 'context'},
  ];
  const lineNumber = (index: number | undefined) =>
    index === undefined ? '   ' : String(firstLine + index).padStart(3);
  const tone = (kind: 'context' | 'remove' | 'add') =>
    kind === 'add'
      ? 'toolDiffAdded'
      : kind === 'remove'
        ? 'toolDiffRemoved'
        : 'muted';
  const unified = () => [
    theme.fg('dim', '     old new    src/search/paginate.ts'),
    ...rows.flatMap(row => {
      const marker =
        row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' ';
      const prefix =
        '     ' +
        theme.fg(
          tone(row.kind),
          `${lineNumber(row.old)} ${lineNumber(row.next)} ${marker} `,
        );
      const code =
        row.next === undefined
          ? (before[row.old ?? 0] ?? '')
          : (after[row.next] ?? '');
      return codeRows(prefix, code, width);
    }),
  ];
  if (variant === 'unified' || (variant === 'split' && width < 110))
    return unified();
  if (variant === 'paired') {
    const block = (
      label: string,
      lines: readonly string[],
      start: number,
      kind: 'remove' | 'add',
    ) => [
      theme.fg(tone(kind), `     ${label}`),
      ...lines.flatMap((line, index) => {
        const changed =
          kind === 'remove' ? index === 1 : index >= 1 && index <= 3;
        return codeRows(
          '     ' +
            theme.fg(
              changed ? tone(kind) : 'muted',
              `${String(start + index).padStart(3)} ${changed ? (kind === 'add' ? '+' : '−') : ' '} `,
            ),
          line,
          width,
        );
      }),
    ];
    return [
      ...block('Before · lines 18–22', before, firstLine, 'remove'),
      '',
      ...block('After · lines 18–24', after, firstLine, 'add'),
    ];
  }
  const leftWidth = Math.floor((width - 7) / 2);
  const rightWidth = width - 7 - leftWidth;
  const fit = (line: string, columns: number) =>
    truncateToWidth(line, columns, '', true);
  const pairings: readonly [number | undefined, number | undefined][] = [
    [0, 0],
    [undefined, 1],
    [1, 2],
    [undefined, 3],
    [2, 4],
    [3, 5],
    [4, 6],
  ];
  return [
    '     ' +
      fit(theme.fg('toolDiffRemoved', 'Before'), leftWidth) +
      '│ ' +
      theme.fg('toolDiffAdded', 'After'),
    ...pairings.flatMap(([oldIndex, newIndex]) => {
      const left =
        oldIndex === undefined
          ? ['']
          : codeRows(
              theme.fg(
                oldIndex === 1 ? 'toolDiffRemoved' : 'muted',
                `${lineNumber(oldIndex)} ${oldIndex === 1 ? '−' : ' '} `,
              ),
              before[oldIndex] ?? '',
              leftWidth,
            );
      const right =
        newIndex === undefined
          ? ['']
          : codeRows(
              theme.fg(
                newIndex >= 1 && newIndex <= 3 ? 'toolDiffAdded' : 'muted',
                `${lineNumber(newIndex)} ${newIndex >= 1 && newIndex <= 3 ? '+' : ' '} `,
              ),
              after[newIndex] ?? '',
              rightWidth,
            );
      return Array.from(
        {length: Math.max(left.length, right.length)},
        (_, index) =>
          '     ' +
          fit(left[index] ?? '', leftWidth) +
          theme.fg('borderMuted', '│ ') +
          fit(right[index] ?? '', rightWidth),
      );
    }),
  ];
}
