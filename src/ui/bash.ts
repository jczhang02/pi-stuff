import {
  createBashToolDefinition,
  type BashToolOptions,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
} from '@earendil-works/pi-tui';
import type {UiSettings} from './settings';

// Pi owns disclosure and execution. This component only lays out retained text.
class BashResult implements Component {
  private width = -1;
  private lines: string[] = [];

  constructor(
    private readonly output: string,
    private readonly expanded: boolean,
    private readonly running: boolean,
    private readonly metadata: string[],
    private readonly theme: Theme,
    private readonly previewLines: number,
  ) {}

  invalidate() {
    this.width = -1;
  }

  render(width: number): string[] {
    if (width === this.width) return this.lines;
    const bodyWidth = Math.max(1, width - 4);
    const rows = wrapTextWithAnsi(this.output || '(no output)', bodyWidth);
    const count = this.running ? 2 : this.previewLines;
    const shown = this.expanded
      ? rows
      : this.running
        ? rows.slice(-count)
        : rows.slice(0, count);
    const lines = shown.map((line, index) =>
      truncateToWidth(
        `${index === 0 ? '  ⎿ ' : '    '}${this.theme.fg('toolOutput', line)}`,
        width,
      ),
    );
    const hidden = rows.length - shown.length;
    if (hidden > 0)
      lines.push(
        truncateToWidth(
          this.theme.fg(
            'muted',
            `    ${hidden} more ${hidden === 1 ? 'line' : 'lines'}`,
          ),
          width,
        ),
      );
    for (const text of this.metadata) {
      const wrapped = wrapTextWithAnsi(text, bodyWidth);
      lines.push(
        ...wrapped.map((line, index) =>
          truncateToWidth(
            this.theme.fg('muted', `${index === 0 ? '  ⎿ ' : '    '}${line}`),
            width,
          ),
        ),
      );
    }
    this.width = width;
    this.lines = lines;
    return lines;
  }
}

export function createBashDisplay(
  cwd: string,
  options: BashToolOptions,
  settings: UiSettings,
) {
  const tool = createBashToolDefinition(cwd, options);
  tool.renderShell = 'self';
  tool.renderCall = (args, theme, context) => {
    return {
      invalidate() {},
      render(width) {
        const rows = wrapTextWithAnsi(
          `Bash(${args.command ?? ''})`,
          Math.max(1, width - 2),
        );
        const shown = context.expanded ? rows : rows.slice(0, 2);
        return shown.map((row, index) => {
          const last = !context.expanded && index === 1 && rows.length > 2;
          const content = last
            ? truncateToWidth(`${row}…`, Math.max(1, width - 2), '…')
            : row;
          const dot = theme.fg(
            context.isError
              ? 'error'
              : context.isPartial
                ? 'warning'
                : 'success',
            '•',
          );
          return truncateToWidth(
            `${index === 0 ? `${dot} ` : '  '}${theme.fg('toolTitle', content)}`,
            width,
          );
        });
      },
    };
  };
  tool.renderResult = (result, options, theme, context) => {
    let output = result.content
      .map(block =>
        block.type === 'text' ? block.text : `[image: ${block.mimeType}]`,
      )
      .join('\n')
      .replace(/\n$/u, '');
    const metadata: string[] = [];
    if (context.args.timeout !== undefined)
      metadata.push(`timeout ${context.args.timeout}s`);
    const {truncation, fullOutputPath} = result.details ?? {};
    if (truncation?.truncated) {
      metadata.push(
        `Truncated: ${truncation.outputLines} of ${truncation.totalLines} lines retained`,
      );
      const footer = output.lastIndexOf('\n\n[');
      if (
        fullOutputPath &&
        footer >= 0 &&
        output.slice(footer).includes(fullOutputPath)
      )
        output = output.slice(0, footer);
    }
    if (fullOutputPath) metadata.push(`Full output: ${fullOutputPath}`);
    return new BashResult(
      output,
      options.expanded,
      options.isPartial,
      metadata,
      theme,
      settings.bashPreviewLines ?? 3,
    );
  };
  return tool;
}
