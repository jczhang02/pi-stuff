import {ToolHeading} from './heading';
import {
  createBashToolDefinition,
  createLocalBashOperations,
  type BashToolDetails,
  type ExtensionAPI,
  type ToolDefinition,
  type BashToolOptions,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
} from '@earendil-works/pi-tui';
import type {UiSettings} from './settings';

interface BashOutcome {
  exitCode?: number | null;
  elapsedMs?: number;
  failure?: 'Cancelled' | 'Timed out' | 'Failed';
}
interface BashState {
  outcome?: BashOutcome;
}
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
    const bodyWidth = Math.max(1, width - 4);
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
    const lines = shown.map((line, index) =>
      truncateToWidth(
        `${index === 0 ? '  ⎿ ' : '    '}${this.theme.fg('toolOutput', line)}`,
        width,
      ),
    );
    if (empty && !this.running)
      lines.push(
        truncateToWidth(this.theme.fg('muted', '  ⎿ (no output)'), width),
      );
    const hidden = rows.length - shown.length;
    if (hidden > 0)
      lines.push(
        truncateToWidth(
          this.theme.fg(
            'muted',
            `${shown.length === 0 ? '  ⎿ ' : '    '}${hidden} more ${hidden === 1 ? 'line' : 'lines'}`,
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
              `${index === 0 ? '  ⎿ ' : '    '}${line}`,
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

export class BashDisplay {
  private readonly outcomes = new Map<string, BashOutcome>();
  private generation = 0;

  constructor(pi: ExtensionAPI) {
    // Results move into the native row state when rendered. Unobserved results
    // (for example, a session closed during execution) never outlive the run.
    const clear = () => {
      this.generation++;
      this.outcomes.clear();
    };
    pi.on('agent_end', clear);
    pi.on('session_start', clear);
    pi.on('session_shutdown', clear);
  }

  create(cwd: string, options: BashToolOptions, settings: UiSettings) {
    const native = createBashToolDefinition(cwd, options);
    const operations = options.operations ?? createLocalBashOperations(options);
    const tool: ToolDefinition<
      typeof native.parameters,
      BashToolDetails | undefined,
      BashState
    > = {
      ...native,
      renderShell: 'self',
      execute: async (id, args, signal, onUpdate, ctx) => {
        const generation = this.generation;
        const outcome: BashOutcome = {};
        // Pi still owns spawning, output retention, cancellation and errors.
        // A per-call closure keeps observations separate during parallel calls.
        const observed = createBashToolDefinition(cwd, {
          ...options,
          operations: {
            async exec(...parameters) {
              const start = performance.now();
              try {
                const result = await operations.exec(...parameters);
                outcome.exitCode = result.exitCode;
                return result;
              } catch (error) {
                outcome.failure =
                  error instanceof Error && error.message === 'aborted'
                    ? 'Cancelled'
                    : error instanceof Error &&
                        error.message.startsWith('timeout:')
                      ? 'Timed out'
                      : 'Failed';
                throw error;
              } finally {
                outcome.elapsedMs = performance.now() - start;
              }
            },
          },
        });
        try {
          return await observed.execute(id, args, signal, onUpdate, ctx);
        } finally {
          if (generation === this.generation) this.outcomes.set(id, outcome);
        }
      },
      renderCall: (args, theme, context) =>
        new ToolHeading('Bash', args.command ?? '', theme, context),
      renderResult: (result, options, theme, context) => {
        let output = result.content
          .map(block =>
            block.type === 'text' ? block.text : `[image: ${block.mimeType}]`,
          )
          .join('\n')
          .replace(/\n$/u, '');
        const metadata: ResultNotice[] = [];
        let showError = false;
        if (!options.isPartial) {
          const observed = this.outcomes.get(context.toolCallId);
          if (observed) {
            context.state.outcome = observed;
            this.outcomes.delete(context.toolCallId);
          }
          const outcome = context.state.outcome;
          // These are Pi's own final error trailers, not a parser for command/test output.
          const trailer = context.isError
            ? /(?:^|\n\n)(Command exited with code (\d+)|Command aborted|Command timed out after [^\n]+ seconds)$/u.exec(
                output,
              )
            : null;
          // Setup/spawn errors are the result itself, not foldable command output.
          showError = context.isError && trailer === null;
          let label =
            outcome?.exitCode !== undefined
              ? outcome.exitCode === null
                ? 'Exit status unavailable'
                : `Exit code ${outcome.exitCode}`
              : outcome?.failure;
          if (!label && trailer)
            label = trailer[2] ? `Exit code ${trailer[2]}` : trailer[1];
          if (!label && context.isError) label = 'Failed';
          if (trailer)
            output = output.slice(0, trailer.index).replace(/\n$/u, '');
          if (label)
            metadata.push({
              text: `${label}${outcome?.elapsedMs === undefined ? '' : ` · ${(outcome.elapsedMs / 1000).toFixed(1)}s`}`,
              color: context.isError ? 'error' : 'muted',
            });
        }
        if (context.args.timeout !== undefined)
          metadata.push({
            text: `timeout ${context.args.timeout}s`,
            color: 'muted',
          });
        const {truncation, fullOutputPath} = result.details ?? {};
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
}
