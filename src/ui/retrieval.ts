import {ToolHeading} from './heading';
import {ResultBlock} from './result-block';
import type {RetrievalGroups} from './groups';
import type {Static, TSchema} from 'typebox';
import type {
  ToolDefinition,
  TruncationResult,
} from '@earendil-works/pi-coding-agent';
import {wrapTextWithAnsi, truncateToWidth} from '@earendil-works/pi-tui';

interface RetrievalDetails {
  truncation?: TruncationResult;
  matchLimitReached?: number;
  resultLimitReached?: number;
  entryLimitReached?: number;
  linesTruncated?: boolean;
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
  inspect?: (output: string) => string[],
  groups?: RetrievalGroups,
) {
  tool.renderShell = 'self';
  tool.renderCall = (args, theme, context) => {
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
    const output = result.content
      .map(block =>
        block.type === 'text' ? block.text : `[image: ${block.mimeType}]`,
      )
      .join('\n')
      .replace(/\n$/u, '');
    if (context.isError) {
      groups?.finish(context.toolCallId, false);
      return new ResultBlock(output, theme, 'error');
    }
    const notices = inspect?.(output) ?? [];
    const details = result.details;
    if (details?.truncation?.truncated)
      notices.push(
        `Output truncated: ${details.truncation.outputLines} of ${details.truncation.totalLines} lines retained`,
      );
    const limit =
      details?.matchLimitReached ??
      details?.resultLimitReached ??
      details?.entryLimitReached;
    if (limit !== undefined) notices.push(`Result limit reached: ${limit}`);
    if (details?.linesTruncated)
      notices.push('Long result lines were truncated');
    const empty =
      output === '' ||
      output === 'No matches found' ||
      output === 'No files found matching pattern' ||
      output === '(empty directory)';
    if (!options.isPartial)
      groups?.finish(context.toolCallId, notices.length === 0 && !empty);
    const noticeBlocks = notices.map(
      notice => new ResultBlock(notice, theme, 'warning'),
    );
    let cachedWidth = -1;
    let cached: string[] = [];
    return {
      invalidate() {
        cachedWidth = -1;
        for (const block of noticeBlocks) block.invalidate();
      },
      render(width) {
        if (groups && !groups.visible(context.toolCallId)) return [];
        if (width === cachedWidth) return cached;
        const rows = wrapTextWithAnsi(
          output || '(no output)',
          Math.max(1, width - 4),
        );
        const visible = options.expanded || empty || options.isPartial;
        const body = visible
          ? rows.map((line, index) =>
              truncateToWidth(
                `${index === 0 ? '  ⎿ ' : '    '}${theme.fg('toolOutput', line)}`,
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
            ];
        for (const block of noticeBlocks) body.push(...block.render(width));
        cachedWidth = width;
        cached = body;
        return body;
      },
    };
  };
  return tool;
}
