import {
  createWriteToolDefinition,
  getLanguageFromPath,
  highlightCode,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  Text,
  wrapTextWithAnsi,
  truncateToWidth,
  type Component,
} from '@earendil-works/pi-tui';

class WrittenContent implements Component {
  private width = -1;
  private rows: string[] = [];
  private highlighted: string[] | undefined;

  constructor(
    readonly source: string,
    readonly path: string,
    private expanded: boolean,
    private theme: Theme,
  ) {}

  update(expanded: boolean, theme: Theme) {
    if (theme !== this.theme) this.highlighted = undefined;
    this.expanded = expanded;
    this.theme = theme;
    this.width = -1;
  }

  invalidate() {
    this.highlighted = undefined;
    this.width = -1;
  }

  render(width: number): string[] {
    if (width === this.width) return this.rows;
    const source = this.source.replace(/\n$/u, '');
    this.highlighted ??= highlightCode(source, getLanguageFromPath(this.path));
    const body =
      this.source === ''
        ? []
        : this.highlighted.flatMap(line =>
            wrapTextWithAnsi(line, Math.max(1, width - 4)),
          );
    const count = this.source === '' ? 0 : source.split('\n').length;
    const visible = this.expanded ? body : body.slice(0, 3);
    const rows = [
      truncateToWidth(
        this.theme.fg(
          'muted',
          `  ⎿ Wrote ${count} ${count === 1 ? 'line' : 'lines'}`,
        ),
        width,
      ),
    ];
    rows.push(...visible.map(line => truncateToWidth(`    ${line}`, width)));
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

export function createWriteDisplay(cwd: string) {
  const tool = createWriteToolDefinition(cwd);
  tool.renderShell = 'self';
  tool.renderCall = (args, theme, context) =>
    new Text(
      `${theme.fg(context.isError ? 'error' : context.isPartial ? 'warning' : 'success', '•')} ${theme.fg('toolTitle', `Write(${args.path ?? ''})`)}`,
      0,
      0,
    );
  tool.renderResult = (result, options, theme, context) => {
    if (context.isError)
      return new Text(
        theme.fg(
          'error',
          `  ⎿ ${result.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n    ')}`,
        ),
        0,
        0,
      );
    const previous = context.lastComponent;
    const source = context.args.content ?? '';
    const path = context.args.path ?? '';
    if (
      previous instanceof WrittenContent &&
      previous.source === source &&
      previous.path === path
    ) {
      previous.update(options.expanded, theme);
      return previous;
    }
    return new WrittenContent(source, path, options.expanded, theme);
  };
  return tool;
}
