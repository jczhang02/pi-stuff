import {ToolHeading} from './heading';
import {ResultBlock} from './result-block';
import type {UiSettings} from './settings';
import {
  createEditToolDefinition,
  getLanguageFromPath,
  highlightCode,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  truncateToWidth,
  wrapTextWithAnsi,
  stripTerminalSequences,
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
      source: stripTerminalSequences(line.slice(1)),
    });
    if (kind !== '+') oldLine++;
    if (kind !== '-') newLine++;
  }
  return hunks;
}

class EditDiff implements Component {
  private width = -1;
  private rows: string[] = [];
  private bodyWidth = -1;
  private body: string[] = [];
  private colored: DiffLine[][] | undefined;
  private added = 0;
  private removed = 0;
  private digits = 1;

  constructor(
    readonly patch: string,
    readonly path: string,
    private expanded: boolean,
    private theme: Theme,
    private readonly settings: UiSettings,
  ) {}

  update(expanded: boolean, theme: Theme) {
    if (theme !== this.theme) {
      this.colored = undefined;
      this.bodyWidth = -1;
    }
    if (expanded !== this.expanded || theme !== this.theme) this.width = -1;
    this.expanded = expanded;
    this.theme = theme;
  }

  invalidate() {
    // Native invalidation also covers theme proxies and late-loaded grammars.
    // Disclosure calls update() directly and can reuse syntax and layout.
    this.colored = undefined;
    this.bodyWidth = -1;
    this.width = -1;
  }

  private highlight(): DiffLine[][] {
    if (this.colored) return this.colored;
    const hunks = patchHunks(this.patch);
    const all = hunks.flat();
    this.added = all.filter(line => line.kind === '+').length;
    this.removed = all.filter(line => line.kind === '-').length;
    this.digits = all.reduce(
      (width, line) => Math.max(width, String(line.number).length),
      1,
    );
    const language =
      this.settings.codeHighlighting === false
        ? undefined
        : getLanguageFromPath(this.path);
    for (const hunk of hunks) {
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
        line.source =
          (line.kind === '-' ? oldColors[oldIndex] : newColors[newIndex]) ??
          line.source;
        if (line.kind !== '+') oldIndex++;
        if (line.kind !== '-') newIndex++;
      }
    }
    this.colored = hunks;
    return hunks;
  }

  render(width: number): string[] {
    if (width === this.width) return this.rows;
    const hunks = this.highlight();
    if (width !== this.bodyWidth) {
      const body: string[] = [];
      for (const [index, hunk] of hunks.entries()) {
        if (index > 0) body.push(this.theme.fg('muted', '    …'));
        for (const line of hunk) {
          const color =
            line.kind === '+'
              ? 'toolDiffAdded'
              : line.kind === '-'
                ? 'toolDiffRemoved'
                : 'toolDiffContext';
          const gutter =
            this.settings.diffLineNumbers === false
              ? `${line.kind} `
              : `${String(line.number).padStart(this.digits)} ${line.kind} `;
          const wrapped = wrapTextWithAnsi(
            line.source,
            Math.max(1, width - 4 - gutter.length),
          );
          for (const [part, row] of wrapped.entries()) {
            const content = `${this.theme.fg(color, part === 0 ? gutter : ' '.repeat(gutter.length))}${row}`;
            const painted =
              line.kind === ' ' || this.settings.diffBackgrounds === false
                ? content
                : this.theme.bg(
                    line.kind === '+' ? 'toolSuccessBg' : 'toolErrorBg',
                    content,
                  );
            body.push(truncateToWidth(`    ${painted}`, width));
          }
        }
      }
      this.bodyWidth = width;
      this.body = body;
    }
    const summary = `  ⎿ Added ${this.added} ${this.added === 1 ? 'line' : 'lines'}, removed ${this.removed} ${this.removed === 1 ? 'line' : 'lines'}`;
    const visible = this.expanded
      ? this.body
      : this.body.slice(0, this.settings.editPreviewLines ?? 6);
    const rows = wrapTextWithAnsi(
      this.theme.fg('muted', summary),
      Math.max(1, width),
    ).concat(visible);
    const hidden = this.body.length - visible.length;
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

export function createEditDisplay(cwd: string, settings: UiSettings) {
  const tool = createEditToolDefinition(cwd);
  tool.renderShell = 'self';
  tool.renderCall = (args, theme, context) =>
    new ToolHeading('Edit', args.path ?? '', theme, context);
  tool.renderResult = (result, options, theme, context) => {
    const patch = result.details?.patch;
    if (context.isError || !patch)
      return new ResultBlock(
        result.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n'),
        theme,
        context.isError ? 'error' : 'toolOutput',
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
    return new EditDiff(patch, path, options.expanded, theme, settings);
  };
  return tool;
}
