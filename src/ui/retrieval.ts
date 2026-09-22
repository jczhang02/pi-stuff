import {ToolHeading} from './heading';
import {ResultBlock} from './result-block';
import type {RetrievalGroups} from './groups';
import type {Static, TSchema} from 'typebox';
import type {
  ToolDefinition,
  TruncationResult,
} from '@earendil-works/pi-coding-agent';
import {
  wrapTextWithAnsi,
  truncateToWidth,
  stripTerminalSequences,
} from '@earendil-works/pi-tui';

interface RetrievalDetails {
  truncation?: TruncationResult;
  matchLimitReached?: number;
  resultLimitReached?: number;
  entryLimitReached?: number;
  linesTruncated?: boolean;
}

export interface RetrievalPart {
  kind: 'body' | 'metadata' | 'warning' | 'status';
  text: string;
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
export function displayRetrieval<
  Params extends TSchema,
  Details extends RetrievalDetails | undefined,
  State,
>(
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
      nativeParts(output, result.details, tool.name)
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
    let cachedWidth = -1;
    let cached: string[] = [];
    return {
      invalidate() {
        cachedWidth = -1;
      },
      render(width) {
        if (groups && !groups.visible(context.toolCallId)) return [];
        if (width === cachedWidth) return cached;
        const body: string[] = [];
        for (const part of parts) {
          if (part.kind === 'metadata' && !options.expanded) continue;
          if (part.kind === 'body' && part.text === '') continue;
          const rows = wrapTextWithAnsi(part.text, Math.max(1, width - 4));
          const visible =
            options.expanded || options.isPartial || part.kind !== 'body';
          const color =
            part.kind === 'warning'
              ? 'warning'
              : part.kind === 'metadata'
                ? 'muted'
                : 'toolOutput';
          body.push(
            ...(visible
              ? rows.map((line, index) =>
                  truncateToWidth(
                    `${index === 0 ? '  ⎿ ' : '    '}${theme.fg(color, line)}`,
                    width,
                  ),
                )
              : [
                  truncateToWidth(
                    theme.fg(
                      'muted',
                      `  ⎿ ${rows.length} more ${rows.length === 1 ? 'line' : 'lines'}`,
                    ),
                    width,
                  ),
                ]),
          );
        }
        cachedWidth = width;
        cached = body;
        return body;
      },
    };
  };
  return tool;
}
