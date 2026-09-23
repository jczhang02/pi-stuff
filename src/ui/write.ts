import type {ToolView} from './tool-lookup';
import {Schema} from 'effect';
import {ToolHeading} from './heading';
import {ResultBlock} from './result-block';
import type {UiSettings} from './settings';
import {
  getLanguageFromPath,
  highlightCode,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  wrapTextWithAnsi,
  truncateToWidth,
  stripTerminalSequences,
  type Component,
} from '@earendil-works/pi-tui';

class WrittenContent implements Component {
  private width = -1;
  private rows: string[] = [];
  private highlighted: string[] | undefined;
  private bodyWidth = -1;
  private body: string[] = [];

  constructor(
    readonly source: string,
    readonly path: string,
    private expanded: boolean,
    private theme: Theme,
    private readonly settings: UiSettings,
  ) {}

  update(expanded: boolean, theme: Theme) {
    if (theme !== this.theme) {
      this.highlighted = undefined;
      this.bodyWidth = -1;
    }
    if (expanded !== this.expanded || theme !== this.theme) this.width = -1;
    this.expanded = expanded;
    this.theme = theme;
  }

  invalidate() {
    this.highlighted = undefined;
    this.bodyWidth = -1;
    this.width = -1;
  }

  render(width: number): string[] {
    if (width === this.width) return this.rows;
    // Match native Write display normalization; retain the original tool args.
    const source = this.source.replace(/\r/gu, '').replace(/\n$/u, '');
    this.highlighted ??= highlightCode(
      stripTerminalSequences(source),
      this.settings.codeHighlighting === false
        ? undefined
        : getLanguageFromPath(this.path),
    );
    if (width !== this.bodyWidth) {
      this.body =
        this.source === ''
          ? []
          : this.highlighted.flatMap(line =>
              wrapTextWithAnsi(line, Math.max(1, width - 5)),
            );
      this.bodyWidth = width;
    }
    const count = this.source === '' ? 0 : source.split('\n').length;
    const visible = this.expanded
      ? this.body
      : this.body.slice(0, this.settings.writePreviewLines ?? 3);
    const rows = [
      truncateToWidth(
        this.theme.fg(
          'muted',
          `  ⎿  Wrote ${count} ${count === 1 ? 'line' : 'lines'}`,
        ),
        width,
      ),
      ...visible.map(line => truncateToWidth(`     ${line}`, width)),
    ];
    const hidden = this.body.length - visible.length;
    if (hidden > 0)
      rows.push(
        truncateToWidth(
          this.theme.fg(
            'muted',
            `     ${hidden} more ${hidden === 1 ? 'line' : 'lines'}`,
          ),
          width,
        ),
      );
    this.width = width;
    this.rows = rows;
    return rows;
  }
}

const WriteArgs = Schema.Struct({
  path: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
});

export function displayWrite(definition: ToolView, settings: UiSettings) {
  const tool = {...definition};
  tool.renderShell = 'self';
  tool.renderCall = (args, theme, context) =>
    new ToolHeading(
      'Write',
      Schema.decodeUnknownSync(WriteArgs)(args).path ?? '',
      theme,
      context,
    );
  tool.renderResult = (result, options, theme, context) => {
    if (context.isError)
      return new ResultBlock(
        result.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n'),
        theme,
        'error',
      );
    const previous = context.lastComponent;
    const args = Schema.decodeUnknownSync(WriteArgs)(context.args);
    const source = args.content ?? '';
    const path = args.path ?? '';
    if (
      previous instanceof WrittenContent &&
      previous.source === source &&
      previous.path === path
    ) {
      previous.update(options.expanded, theme);
      return previous;
    }
    return new WrittenContent(source, path, options.expanded, theme, settings);
  };
  return tool;
}
