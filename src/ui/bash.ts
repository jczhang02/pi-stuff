import type {ToolView} from './tool-lookup';
import {Schema} from 'effect';
import {ToolHeading} from './heading';
import {type Theme} from '@earendil-works/pi-coding-agent';
import {
  truncateToWidth,
  wrapTextWithAnsi,
  stripTerminalSequences,
  visibleWidth,
  type Component,
} from '@earendil-works/pi-tui';
import type {UiSettings} from './settings';

const BashArgs = Schema.Struct({
  command: Schema.optional(Schema.String),
});
const BashDetails = Schema.Struct({
  fullOutputPath: Schema.optional(Schema.String),
  truncation: Schema.optional(
    Schema.Struct({
      truncated: Schema.Boolean,
      outputLines: Schema.Number,
      totalLines: Schema.Number,
    }),
  ),
});
interface ResultNotice {
  text: string;
  color: 'muted' | 'error' | 'warning';
}

// Pi owns disclosure and execution. This component only lays out retained text.
class BashResult implements Component {
  private width = -1;
  private lines: string[] = [];

  constructor(
    private readonly output: string,
    private readonly expanded: boolean,
    private readonly running: boolean,
    private readonly metadata: ResultNotice[],
    private readonly theme: Theme,
    private readonly previewLines: number,
  ) {}

  invalidate() {
    this.width = -1;
  }

  render(width: number): string[] {
    if (width === this.width) return this.lines;
    const bodyWidth = Math.max(1, width - 5);
    const empty = this.output === '' || this.output === '(no output)';
    const rows = empty ? [] : wrapTextWithAnsi(this.output, bodyWidth);
    const count = this.previewLines;
    const shown = this.expanded
      ? rows
      : count === 0
        ? []
        : this.running
          ? rows.slice(-count)
          : rows.slice(0, count);
    const lines = shown.map((line, index) => {
      const prefix = index === 0 ? '  ⎿  ' : '     ';
      const text = `${prefix}${this.theme.fg('toolOutput', line)}`;
      // Measure the whole grapheme sequence; truncate before inserting color ANSI.
      return visibleWidth(`     ${line}`) <= width
        ? text
        : this.theme.fg(
            'toolOutput',
            truncateToWidth(`${prefix}${line}`, width),
          );
    });
    if (empty && !this.running)
      lines.push(
        truncateToWidth(this.theme.fg('muted', '  ⎿  (no output)'), width),
      );
    const hidden = rows.length - shown.length;
    if (hidden > 0)
      lines.push(
        truncateToWidth(
          this.theme.fg(
            'muted',
            `${shown.length === 0 ? '  ⎿  ' : '     '}${hidden} more ${hidden === 1 ? 'line' : 'lines'}`,
          ),
          width,
        ),
      );
    for (const notice of this.metadata) {
      const wrapped = wrapTextWithAnsi(notice.text, bodyWidth);
      lines.push(
        ...wrapped.map((line, index) =>
          truncateToWidth(
            this.theme.fg(
              notice.color,
              `${index === 0 ? '  ⎿  ' : '     '}${line}`,
            ),
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

export function displayBash(definition: ToolView, settings: UiSettings) {
  const tool: ToolView = {
    ...definition,
    renderShell: 'self',
    renderCall: (args, theme, context) =>
      new ToolHeading(
        'Bash',
        Schema.decodeUnknownSync(BashArgs)(args).command ?? '',
        theme,
        context,
      ),
    renderResult: (result, options, theme, context) => {
      let output = stripTerminalSequences(
        result.content
          .map(block =>
            block.type === 'text' ? block.text : `[image: ${block.mimeType}]`,
          )
          .join('\n'),
      ).replace(/\n$/u, '');
      const metadata: ResultNotice[] = [];
      let showError = false;
      if (!options.isPartial) {
        // These are Pi's own final error trailers, not a parser for command/test output.
        const trailer = context.isError
          ? /(?:^|\n\n)(Command exited with code (\d+)|Command aborted|Command timed out after [^\n]+ seconds)$/u.exec(
              output,
            )
          : null;
        // Setup/spawn errors are the result itself, not foldable command output.
        showError = context.isError && trailer === null;
        // Native success does not expose whether exitCode was zero or null.
        // Only report numeric status when Pi supplies its own error trailer.
        const label = trailer?.[2]
          ? `Exit code ${trailer[2]}`
          : trailer?.[1] === 'Command aborted'
            ? 'Cancelled'
            : trailer?.[1]?.startsWith('Command timed out')
              ? trailer[1]
                  .replace('Command timed out after ', 'Timed out after ')
                  .replace(/ seconds$/u, 's')
              : context.isError
                ? 'Failed'
                : 'Completed';
        if (trailer)
          output = output.slice(0, trailer.index).replace(/\n$/u, '');
        if (context.isError) metadata.push({text: label, color: 'error'});
      }
      const {truncation, fullOutputPath} = Schema.decodeUnknownSync(
        BashDetails,
      )(result.details ?? {});
      // Failed native Bash calls discard details but retain this final notice.
      const footer =
        context.isError || truncation?.truncated
          ? /\n\n\[(Showing (?:lines \d+-\d+ of \d+(?: \([^\n)]+ limit\))?|last [^\n]+ of line \d+ \(line is [^\n)]+\)))\. Full output: ([^\n]+)\]$/u.exec(
              output,
            )
          : null;
      if (footer) output = output.slice(0, footer.index).replace(/\n$/u, '');
      if (truncation?.truncated) {
        metadata.push({
          text: `Truncated: ${truncation.outputLines} of ${truncation.totalLines} lines retained`,
          color: 'warning',
        });
      } else if (footer)
        metadata.push({text: `Truncated: ${footer[1]}`, color: 'warning'});
      const logPath = fullOutputPath ?? footer?.[2];
      if (logPath)
        metadata.push({
          text: `Full output: ${logPath}`,
          color: 'warning',
        });
      return new BashResult(
        output,
        options.expanded || showError,
        options.isPartial,
        metadata,
        theme,
        options.isPartial
          ? (settings.bashRunningPreviewLines ?? 2)
          : (settings.bashPreviewLines ?? 3),
      );
    },
  };
  return tool;
}
