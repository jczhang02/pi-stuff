import {
  createEditToolDefinition,
  getLanguageFromPath,
  highlightCode,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  Text,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
} from '@earendil-works/pi-tui';

interface DiffLine {
  kind: ' ' | '+' | '-';
  number: number;
  source: string;
}

// The native result carries a standard patch. Reading the current file would
// corrupt historical context after subsequent edits, so only use that patch.
function patchHunks(patch: string): DiffLine[][] {
  const hunks: DiffLine[][] = [];
  let oldLine = 0;
  let newLine = 0;
  let current: DiffLine[] | undefined;
  for (const line of patch.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      current = [];
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    const kind = line[0];
    if (kind !== ' ' && kind !== '+' && kind !== '-') continue;
    current.push({
      kind,
      number: kind === '-' ? oldLine : newLine,
      source: line.slice(1),
    });
    if (kind !== '+') oldLine++;
    if (kind !== '-') newLine++;
  }
  return hunks;
}

class EditDiff implements Component {
  private width = -1;
  private rows: string[] = [];

  constructor(
    readonly patch: string,
    readonly path: string,
    private expanded: boolean,
    private theme: Theme,
  ) {}

  update(expanded: boolean, theme: Theme) {
    this.expanded = expanded;
    this.theme = theme;
    this.width = -1;
  }

  invalidate() {
    this.width = -1;
  }

  render(width: number): string[] {
    if (width === this.width) return this.rows;
    const hunks = patchHunks(this.patch);
    const all = hunks.flat();
    const added = all.filter(line => line.kind === '+').length;
    const removed = all.filter(line => line.kind === '-').length;
    const digits = all.reduce(
      (width, line) => Math.max(width, String(line.number).length),
      1,
    );
    const body: string[] = [];
    const language = getLanguageFromPath(this.path);
    for (const [index, hunk] of hunks.entries()) {
      if (index > 0) body.push(this.theme.fg('muted', '    …'));
      const oldColors = highlightCode(
        hunk
          .filter(line => line.kind !== '+')
          .map(line => line.source)
          .join('\n'),
        language,
      );
      const newColors = highlightCode(
        hunk
          .filter(line => line.kind !== '-')
          .map(line => line.source)
          .join('\n'),
        language,
      );
      let oldIndex = 0;
      let newIndex = 0;
      for (const line of hunk) {
        const text =
          (line.kind === '-' ? oldColors[oldIndex] : newColors[newIndex]) ??
          line.source;
        if (line.kind !== '+') oldIndex++;
        if (line.kind !== '-') newIndex++;
        const color =
          line.kind === '+'
            ? 'toolDiffAdded'
            : line.kind === '-'
              ? 'toolDiffRemoved'
              : 'toolDiffContext';
        const gutter = `${String(line.number).padStart(digits)} ${line.kind} `;
        const wrapped = wrapTextWithAnsi(
          text,
          Math.max(1, width - 4 - gutter.length),
        );
        for (const [part, row] of wrapped.entries()) {
          const content = `${this.theme.fg(color, part === 0 ? gutter : ' '.repeat(gutter.length))}${row}`;
          const painted =
            line.kind === ' '
              ? content
              : this.theme.bg(
                  line.kind === '+' ? 'toolSuccessBg' : 'toolErrorBg',
                  content,
                );
          body.push(truncateToWidth(`    ${painted}`, width));
        }
      }
    }
    const summary = `  ⎿ Added ${added} ${added === 1 ? 'line' : 'lines'}, removed ${removed} ${removed === 1 ? 'line' : 'lines'}`;
    const visible = this.expanded ? body : body.slice(0, 6);
    const rows = wrapTextWithAnsi(
      this.theme.fg('muted', summary),
      Math.max(1, width),
    );
    rows.push(...visible);
    const hidden = body.length - visible.length;
    if (hidden > 0)
      rows.push(
        truncateToWidth(
          this.theme.fg(
            'muted',
            `    ${hidden} more ${hidden === 1 ? 'line' : 'lines'}`,
          ),
          width,
        ),
      );
    this.width = width;
    this.rows = rows;
    return rows;
  }
}

export function createEditDisplay(cwd: string) {
  const tool = createEditToolDefinition(cwd);
  tool.renderShell = 'self';
  tool.renderCall = (args, theme, context) =>
    new Text(
      `${theme.fg(context.isError ? 'error' : context.isPartial ? 'warning' : 'success', '•')} ${theme.fg('toolTitle', `Edit(${args.path ?? ''})`)}`,
      0,
      0,
    );
  tool.renderResult = (result, options, theme, context) => {
    const patch = result.details?.patch;
    if (context.isError || !patch)
      return new Text(
        theme.fg(
          context.isError ? 'error' : 'toolOutput',
          `  ⎿ ${result.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n    ')}`,
        ),
        0,
        0,
      );
    const previous = context.lastComponent;
    const path = context.args.path ?? '';
    if (
      previous instanceof EditDiff &&
      previous.patch === patch &&
      previous.path === path
    ) {
      previous.update(options.expanded, theme);
      return previous;
    }
    return new EditDiff(patch, path, options.expanded, theme);
  };
  return tool;
}
