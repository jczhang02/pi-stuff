import {Schema} from 'effect';
import {ToolHeading} from './heading';
import {ResultBlock} from './result-block';
import type {RetrievalGroups} from './groups';
import type {Static, TSchema} from 'typebox';
import type {
  Theme,
  ToolDefinition,
  ToolRenderResultOptions,
} from '@earendil-works/pi-coding-agent';
import {
  wrapTextWithAnsi,
  truncateToWidth,
  stripTerminalSequences,
  visibleWidth,
} from '@earendil-works/pi-tui';

export const RetrievalDetails = Schema.Struct({
  truncation: Schema.optional(Schema.Struct({truncated: Schema.Boolean})),
  matchLimitReached: Schema.optional(Schema.Number),
  resultLimitReached: Schema.optional(Schema.Number),
  entryLimitReached: Schema.optional(Schema.Number),
  linesTruncated: Schema.optional(Schema.Boolean),
});
type RetrievalDetails = typeof RetrievalDetails.Type;

export interface RetrievalPart {
  kind: 'body' | 'metadata' | 'warning' | 'status';
  text: string;
}

// Retain only the current width's layout through Pi's native result slot.
class RetrievalContent {
  private width = -1;
  private wrapped: {
    part: RetrievalPart;
    rows?: string[];
    styled?: string[];
  }[] = [];
  private body: string[] | undefined;

  constructor(
    private parts: RetrievalPart[],
    private options: ToolRenderResultOptions,
    private theme: Theme,
    private readonly groups: RetrievalGroups | undefined,
    private readonly id: string,
  ) {}

  update(
    parts: RetrievalPart[],
    options: ToolRenderResultOptions,
    theme: Theme,
  ) {
    if (
      theme !== this.theme ||
      parts.length !== this.parts.length ||
      parts.some(
        (part, index) =>
          part.kind !== this.parts[index]?.kind ||
          part.text !== this.parts[index]?.text,
      )
    ) {
      this.parts = parts;
      this.theme = theme;
      this.invalidate();
    }
    if (
      options.expanded !== this.options.expanded ||
      options.isPartial !== this.options.isPartial
    )
      this.body = undefined;
    this.options = options;
  }

  invalidate() {
    this.width = -1;
    this.wrapped = [];
    this.body = undefined;
  }

  render(width: number): string[] {
    if (this.groups && !this.groups.visible(this.id)) return [];
    if (width !== this.width) {
      this.wrapped = this.parts.map(part => ({part}));
      this.body = undefined;
      this.width = width;
    }
    if (this.body) return this.body;
    const body: string[] = [];
    for (const block of this.wrapped) {
      const {part} = block;
      if (part.kind === 'metadata' && !this.options.expanded) continue;
      if (part.kind === 'body' && part.text === '') continue;
      const rows = (block.rows ??= wrapTextWithAnsi(
        part.text,
        Math.max(1, width - 4),
      ));
      const visible =
        this.options.expanded || this.options.isPartial || part.kind !== 'body';
      const color =
        part.kind === 'warning'
          ? 'warning'
          : part.kind === 'metadata'
            ? 'muted'
            : 'toolOutput';
      if (visible) {
        block.styled ??= rows.map((line, index) => {
          const text = `${index === 0 ? '  ⎿ ' : '    '}${this.theme.fg(color, line)}`;
          // Measure the unstyled body to avoid scanning ANSI on every fitting row.
          return visibleWidth(line) <= width - 4
            ? text
            : truncateToWidth(text, width);
        });
        body.push(...block.styled);
      } else {
        body.push(
          truncateToWidth(
            this.theme.fg(
              'muted',
              `  ⎿ ${rows.length} more ${rows.length === 1 ? 'line' : 'lines'}`,
            ),
            width,
          ),
        );
      }
    }
    this.body = body;
    return body;
  }
}

function nativeParts(
  output: string,
  details: RetrievalDetails | undefined,
  name: string,
): RetrievalPart[] {
  const limited =
    details?.truncation?.truncated ||
    details?.matchLimitReached !== undefined ||
    details?.resultLimitReached !== undefined ||
    details?.entryLimitReached !== undefined ||
    details?.linesTruncated;
  if (limited) {
    // Native tools append a final notice only when these details report a limit.
    // Keep its continuation instructions, without counting them as source rows.
    const footer = /\n\n(\[[^\n]*\])$/u.exec(output);
    if (footer?.[1])
      return [
        {kind: 'body', text: output.slice(0, footer.index)},
        {kind: 'warning', text: footer[1]},
      ];
    return [{kind: 'warning', text: output}];
  }
  const empty =
    output === '' ||
    (name === 'grep' && output === 'No matches found') ||
    (name === 'find' && output === 'No files found matching pattern') ||
    (name === 'ls' && output === '(empty directory)');
  return [{kind: empty ? 'status' : 'body', text: output || '(no output)'}];
}

export function readParts(
  output: string,
  details: RetrievalDetails | undefined,
  offset = 1,
  limit?: number,
): RetrievalPart[] {
  if (details?.truncation?.truncated)
    return nativeParts(output, details, 'read');
  // User-requested Read limits have no structured details in Pi. Validate the
  // native suffix against the requested range before separating it from text.
  const footer =
    /\n\n\[([\d.eE+-]+) more lines in file\. Use offset=([\d.eE+-]+) to continue\.\]$/u.exec(
      output,
    );
  if (
    footer &&
    limit !== undefined &&
    Number.isSafeInteger(Number(footer[1])) &&
    Number.isSafeInteger(limit) &&
    limit > 0 &&
    Number(footer[2]) === Math.max(1, offset) + limit &&
    output.slice(0, footer.index).split('\n').length === limit
  )
    return [
      {kind: 'body', text: output.slice(0, footer.index)},
      {kind: 'warning', text: footer[0].slice(2)},
    ];
  if (footer && limit !== undefined) return [{kind: 'status', text: output}];
  return nativeParts(output, details, 'read');
}

// These tools share retained text and native disclosure, but keep their own
// schema, execution and metadata. The adapter never rewrites a tool result.
export function displayRetrieval<Params extends TSchema, Details, State>(
  tool: ToolDefinition<Params, Details, State>,
  label: string,
  target: (args: Static<Params>, expanded: boolean) => string,
  inspect?: (
    output: string,
    details: Details,
    args: Static<Params>,
  ) => RetrievalPart[],
  groups?: RetrievalGroups,
) {
  const nativeResult = tool.renderResult;
  tool.renderShell = 'self';
  tool.renderCall = (args, theme, context) => {
    // Pi updates call renderers on every global toggle, even when successive
    // toggles coalesce into one terminal frame. Clear local overrides here too.
    groups?.visible(context.toolCallId);
    const title = new ToolHeading(
      label,
      target(args, context.expanded),
      theme,
      context,
    );
    return {
      invalidate() {
        title.invalidate();
      },
      handleMouse(event) {
        if (event.y !== 0 || !groups?.summary(context.toolCallId)) return;
        if (event.type === 'click' && event.button === 'left') {
          groups.toggle(context.toolCallId);
          context.invalidate();
          return {handled: true};
        }
        return undefined;
      },
      render(width) {
        const summary = groups?.summary(context.toolCallId);
        const heading = summary
          ? [truncateToWidth(theme.fg('muted', `• ${summary}`), width)]
          : [];
        if (groups && !groups.visible(context.toolCallId)) return heading;
        return [...heading, ...title.render(width)];
      },
    };
  };
  tool.renderResult = (result, options, theme, context) => {
    if (nativeResult && result.content.some(block => block.type === 'image')) {
      // Pi renders images outside the tool's text component. Do not hide their
      // headings in a text group or replace its dimension/protocol fallback.
      groups?.finish(context.toolCallId, false);
      return nativeResult(result, options, theme, context);
    }
    const output = result.content
      .map(block =>
        block.type === 'text' ? block.text : `[image: ${block.mimeType}]`,
      )
      .join('\n');
    if (context.isError) {
      groups?.finish(context.toolCallId, false);
      return new ResultBlock(output, theme, 'error');
    }
    const parts = (
      inspect?.(output, result.details, context.args) ??
      nativeParts(
        output,
        Schema.decodeUnknownSync(RetrievalDetails)(result.details ?? {}),
        tool.name,
      )
    ).map(part => ({
      ...part,
      text: stripTerminalSequences(part.text).replace(/\n$/u, ''),
    }));
    if (!options.isPartial)
      groups?.finish(
        context.toolCallId,
        parts.some(part => part.kind === 'body' && part.text !== '') &&
          parts.every(part => part.kind === 'body' || part.kind === 'metadata'),
      );
    const previous = context.lastComponent;
    if (previous instanceof RetrievalContent) {
      previous.update(parts, options, theme);
      return previous;
    }
    return new RetrievalContent(
      parts,
      options,
      theme,
      groups,
      context.toolCallId,
    );
  };
  return tool;
}
