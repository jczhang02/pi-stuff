// Throwaway future UI preview for non-tool conversation messages.
// Fixtures are static: this renderer never executes tools or providers.
import {getMarkdownTheme, type Theme} from '@earendil-works/pi-coding-agent';
import {
  type Component,
  type DefaultTextStyle,
  Markdown,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import {type CatalogItem} from './catalog-fixtures';
const RESULT_PREFIX = '⎿  ';
const CONTINUATION = '   ';
const SHELL_PREVIEW_LINES = 8;
type MessageItem<K extends CatalogItem['kind']> = Extract<
  CatalogItem,
  {kind: K}
>;
type StatusColor =
  | 'toolOutput'
  | 'success'
  | 'warning'
  | 'error'
  | 'muted'
  | 'accent'
  | 'bashMode';
function linesComponent(render: (width: number) => string[]): Component {
  return {render, invalidate() {}};
}
function markdownLines(
  text: string,
  width: number,
  style?: DefaultTextStyle,
): string[] {
  if (!text.trim()) return [];
  return new Markdown(text.trim(), 0, 0, getMarkdownTheme(), style, {
    preserveOrderedListMarkers: true,
    preserveBackslashEscapes: true,
  }).render(Math.max(1, width));
}
function prefixedMarkdown(
  text: string,
  width: number,
  prefix: string,
  style?: DefaultTextStyle,
): string[] {
  const prefixWidth = visibleWidth(prefix);
  const continuation = ' '.repeat(prefixWidth);
  return markdownLines(text, width - prefixWidth, style).map(
    (line, index) => `${index === 0 ? prefix : continuation}${line}`,
  );
}
function prefixedText(
  text: string,
  width: number,
  prefix: string,
  continuation: string,
  color: (text: string) => string,
): string[] {
  const output: string[] = [];
  const contentWidth = Math.max(1, width - visibleWidth(prefix));
  let first = true;
  for (const sourceLine of text.split('\n')) {
    for (const line of wrapTextWithAnsi(color(sourceLine), contentWidth)) {
      output.push(`${first ? prefix : continuation}${line}`);
      first = false;
    }
  }
  return output;
}
function appendBlock(
  output: string[],
  block: readonly string[],
  marker: string,
): void {
  if (block.length === 0) return;
  if (output.length > 0) output.push('');
  const continuation = ' '.repeat(visibleWidth(marker));
  output.push(
    ...block.map(
      (line, index) => `${index === 0 ? marker : continuation}${line}`,
    ),
  );
}
function appendResult(
  output: string[],
  text: string,
  width: number,
  theme: Theme,
  color: StatusColor = 'toolOutput',
  prefix = theme.fg('muted', RESULT_PREFIX),
): void {
  output.push(
    ...prefixedText(text, width, prefix, CONTINUATION, value =>
      theme.fg(color, value),
    ),
  );
}
function renderUser(item: MessageItem<'user'>, theme: Theme): Component {
  return linesComponent(width =>
    prefixedMarkdown(item.text, width, theme.fg('mdQuote', ' '), {
      color: text => theme.fg('userMessageText', text),
    }),
  );
}
function assistantStatus(item: MessageItem<'assistant'>): string | undefined {
  if (item.message.content.some(content => content.type === 'toolCall')) return;
  switch (item.message.stopReason) {
    case 'length':
      return 'Response was truncated before completion.';
    case 'aborted':
      return item.message.errorMessage &&
        item.message.errorMessage !== 'Request was aborted'
        ? item.message.errorMessage
        : 'Operation aborted';
    case 'error':
      return `Error: ${item.message.errorMessage ?? 'Unknown error'}`;
    default:
      return undefined;
  }
}

function renderAssistant(
  item: MessageItem<'assistant'>,
  theme: Theme,
  expanded: boolean,
): Component {
  return linesComponent(width => {
    const output: string[] = [];
    const marker = theme.fg('accent', '• ');
    const content = item.message.content;
    for (let index = 0; index < content.length; index++) {
      const block = content[index];
      if (!block) continue;
      if (block.type === 'thinking') {
        const thinking = [block.thinking.trim()];
        while (index + 1 < content.length) {
          const next = content[index + 1];
          if (!next || next.type !== 'thinking') break;
          index++;
          thinking.push(next.thinking.trim());
        }
        const text = thinking.filter(Boolean).join('\n\n');
        if (text) {
          const lines = expanded
            ? markdownLines(text, width - visibleWidth(marker), {
                color: value => theme.fg('thinkingText', value),
                italic: true,
              }).map(line => theme.fg('thinkingText', line))
            : [theme.italic(theme.fg('thinkingText', 'Thinking...'))];
          appendBlock(output, lines, marker);
        }
      } else if (block.type === 'text') {
        const textBlocks = [block.text.trim()];
        while (index + 1 < content.length) {
          const next = content[index + 1];
          if (!next || next.type !== 'text') break;
          index++;
          textBlocks.push(next.text.trim());
        }
        appendBlock(
          output,
          markdownLines(
            textBlocks.filter(Boolean).join('\n\n'),
            width - visibleWidth(marker),
          ),
          marker,
        );
      }
    }
    const status = assistantStatus(item);
    if (status) {
      if (output.length === 0)
        output.push(
          ...prefixedText('Assistant response', width, marker, '  ', value =>
            theme.fg('muted', value),
          ),
        );
      output.push('');
      appendResult(output, status, width, theme, 'error');
    }
    return output;
  });
}

function renderBash(
  item: MessageItem<'bash'>,
  theme: Theme,
  expanded: boolean,
): Component {
  return linesComponent(width => {
    const output: string[] = [];
    const marker = theme.fg('accent', '• ');
    const excluded = item.excludeFromContext === true;
    const modeColor: 'dim' | 'bashMode' = excluded ? 'dim' : 'bashMode';
    output.push(
      ...prefixedText(
        `${excluded ? '!!' : '!'} ${item.command}`,
        width,
        marker,
        '  ',
        value => theme.bold(theme.fg(modeColor, value)),
      ),
    );
    const sourceLines = item.output.split('\n');
    const display = expanded
      ? item.output
      : sourceLines.slice(0, SHELL_PREVIEW_LINES).join('\n');
    if (display) appendResult(output, display, width, theme);
    const hidden =
      sourceLines.length - Math.min(sourceLines.length, SHELL_PREVIEW_LINES);
    if (!expanded && hidden > 0)
      appendResult(
        output,
        `… ${hidden} more lines · Ctrl+O to expand`,
        width,
        theme,
        'muted',
        CONTINUATION,
      );
    const status = item.cancelled
      ? {text: 'cancelled', color: 'warning' as const}
      : item.exitCode === undefined
        ? {text: 'Running...', color: 'bashMode' as const}
        : item.exitCode === 0
          ? {text: 'completed', color: 'success' as const}
          : {text: `exit ${item.exitCode}`, color: 'error' as const};
    if (display)
      appendResult(
        output,
        status.text,
        width,
        theme,
        status.color,
        CONTINUATION,
      );
    else appendResult(output, status.text, width, theme, status.color);
    if (item.truncation?.truncated === true) {
      const path = item.fullOutputPath
        ? ` Full output: ${item.fullOutputPath}`
        : '';
      appendResult(
        output,
        `Output truncated.${path}`,
        width,
        theme,
        'warning',
        display ? CONTINUATION : undefined,
      );
    }
    return output;
  });
}

function expandableSummary(
  kind: string,
  heading: string,
  summary: string,
  expanded: boolean,
  width: number,
  theme: Theme,
): string[] {
  const marker = theme.fg('accent', '• ');
  const label = theme.bold(theme.fg('customMessageLabel', `[${kind}]`));
  const output = prefixedText(
    `${label} ${theme.fg('customMessageText', heading)}`,
    width,
    marker,
    '  ',
    value => value,
  );
  if (!expanded) {
    output.push(`  ${theme.fg('dim', 'Ctrl+O to expand')}`);
    return output;
  }
  output.push('');
  output.push(
    ...prefixedMarkdown(summary, width, '  ', {
      color: text => theme.fg('customMessageText', text),
    }),
  );
  return output;
}
function renderSummary(
  kind: string,
  heading: string,
  summary: string,
  theme: Theme,
  expanded: boolean,
): Component {
  return linesComponent(width =>
    expandableSummary(kind, heading, summary, expanded, width, theme),
  );
}

function renderSkill(
  item: MessageItem<'skill'>,
  theme: Theme,
  expanded: boolean,
): Component {
  return linesComponent(width => {
    const body = [
      `**Location:** \`${item.block.location}\``,
      item.block.content.trim(),
    ].join('\n\n');
    const request = item.block.userMessage?.trim();
    const output = request
      ? prefixedMarkdown(request, width, theme.fg('mdQuote', ' '), {
          color: text => theme.fg('userMessageText', text),
        })
      : [];
    if (output.length > 0) output.push('');
    output.push(
      ...expandableSummary(
        'skill',
        item.block.name,
        body,
        expanded,
        width,
        theme,
      ),
    );
    return output;
  });
}
function renderNotice(
  item: MessageItem<'notice'> | MessageItem<'extension-error'>,
  theme: Theme,
): Component {
  return linesComponent(width => {
    const extension = item.kind === 'extension-error';
    const color: StatusColor = extension
      ? 'error'
      : item.type === 'error'
        ? 'error'
        : item.type === 'warning'
          ? 'warning'
          : 'accent';
    const label = extension
      ? 'Extension error'
      : item.type.charAt(0).toUpperCase() + item.type.slice(1);
    const body = extension
      ? item.message
      : item.type === 'info'
        ? item.message
        : `${label}: ${item.message}`;
    const output = prefixedText(
      label,
      width,
      theme.fg(color, '• '),
      '  ',
      value => theme.bold(theme.fg(color, value)),
    );
    output.push('');
    appendResult(output, body, width, theme, color);
    return output;
  });
}

export function renderFutureMessage(
  item: CatalogItem,
  theme: Theme,
  expanded: boolean,
): Component | undefined {
  switch (item.kind) {
    case 'user':
      return renderUser(item, theme);
    case 'assistant':
      return renderAssistant(item, theme, expanded);
    case 'bash':
      return renderBash(item, theme, expanded);
    case 'compaction':
      return renderSummary(
        'compaction',
        `Compacted from ${item.message.tokensBefore.toLocaleString('en-US')} tokens`,
        item.message.summary,
        theme,
        expanded,
      );
    case 'branch':
      return renderSummary(
        'branch',
        'Branch summary',
        item.message.summary,
        theme,
        expanded,
      );
    case 'skill':
      return renderSkill(item, theme, expanded);
    case 'notice':
      return renderNotice(item, theme);
    case 'extension-error':
      return renderNotice(item, theme);
    case 'custom':
      return undefined;
    case 'tool':
      return undefined;
  }
}
