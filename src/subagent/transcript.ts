import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  type SessionEntry,
  type SessionManager,
  type ToolDefinition,
  sessionEntryToContextMessages,
} from '@earendil-works/pi-coding-agent';
import type {AgentMessage} from '@earendil-works/pi-agent-core';
import type {Component, MarkdownTheme, TUI} from '@earendil-works/pi-tui';
import {Markdown} from '@earendil-works/pi-tui';
import {Schema} from 'effect';
import type {RequestRecord} from './records';

export interface TranscriptSource {
  readonly sessionManager: SessionManager;
  readonly requests: readonly RequestRecord[];
  readonly cwd: string;
  readonly tui: TUI;
  readonly markdownTheme: MarkdownTheme;
  readonly getToolDefinition?: (toolName: string) => ToolDefinition | undefined;
}

type TranscriptBlock = Component;

const RecordedContent = Schema.Struct({
  content: Schema.Union([
    Schema.String,
    Schema.Array(
      Schema.Struct({
        type: Schema.String,
        text: Schema.optional(Schema.String),
        mimeType: Schema.optional(Schema.String),
      }),
    ),
  ]),
});

interface RequestEntries {
  readonly request?: RequestRecord;
  readonly entries: readonly SessionEntry[];
  readonly unavailable?: string;
}

function markdown(text: string, theme: MarkdownTheme): TranscriptBlock {
  return new Markdown(text, 0, 0, theme);
}

function requestTime(timestamp: number | undefined): string {
  return timestamp === undefined
    ? 'time unavailable'
    : new Date(timestamp).toISOString();
}

function requestHeading(
  request: RequestRecord,
  theme: MarkdownTheme,
): TranscriptBlock {
  const ended =
    request.endedAt === undefined
      ? 'Ended: time unavailable'
      : `Ended: ${requestTime(request.endedAt)}`;
  return markdown(
    `### Request\n\n${request.task}\n\nStarted: ${requestTime(request.startedAt)}\n${ended}`,
    theme,
  );
}

function contentText(
  content: readonly {
    type: string;
    text?: string | undefined;
    mimeType?: string | undefined;
  }[],
): string {
  const pieces = content.map(part =>
    part.type === 'text'
      ? (part.text ?? '')
      : `[${part.type} content omitted from text projection${
          part.mimeType === undefined ? '' : `: ${part.mimeType}`
        }]`,
  );
  return pieces.join('\n');
}

function messageFallback(
  message: AgentMessage,
  theme: MarkdownTheme,
): TranscriptBlock {
  if (message.role === 'toolResult') {
    const error = message.isError ? '\n\nStatus: error' : '';
    return markdown(
      `#### Tool result: ${message.toolName}\n\n${contentText(message.content)}${error}`,
      theme,
    );
  }
  const decoded = Schema.decodeUnknownOption(RecordedContent)(message);
  const text =
    decoded._tag === 'Some'
      ? Schema.is(Schema.String)(decoded.value.content)
        ? decoded.value.content
        : contentText(decoded.value.content)
      : '';
  return markdown(
    `Message renderer unavailable for this saved message.${text ? `\n\n${text}` : ''}`,
    theme,
  );
}

function componentsForMessage(
  message: AgentMessage,
  source: TranscriptSource,
  theme: MarkdownTheme,
  tools: Map<string, TranscriptBlock>,
  recordedResults: ReadonlySet<string>,
): TranscriptBlock[] {
  if (message.role === 'assistant') {
    const component = new AssistantMessageComponent(message, false, theme);
    const toolComponents: TranscriptBlock[] = [];
    for (const part of message.content) {
      if (part.type !== 'toolCall') continue;
      if (!recordedResults.has(part.id)) {
        toolComponents.push(
          markdown(
            `#### Tool call: ${part.name}\n\n${JSON.stringify(part.arguments, null, 2)}\n\nTool result not recorded.`,
            theme,
          ),
        );
        continue;
      }
      const tool = new ToolExecutionComponent(
        part.name,
        part.id,
        part.arguments,
        {showImages: false},
        source.getToolDefinition?.(part.name),
        source.tui,
        source.cwd,
      );
      tool.markExecutionStarted();
      tool.setArgsComplete();
      tool.setExpanded(true);
      tools.set(part.id, tool);
      toolComponents.push(tool);
    }
    const blocks: TranscriptBlock[] = [component, ...toolComponents];
    if (message.errorMessage !== undefined)
      blocks.push(markdown(`Assistant error: ${message.errorMessage}`, theme));
    else if (message.stopReason === 'aborted')
      blocks.push(markdown('Assistant turn aborted.', theme));
    return blocks;
  }
  if (message.role === 'toolResult') {
    const tool = tools.get(message.toolCallId);
    if (tool instanceof ToolExecutionComponent) {
      tool.updateResult(message);
      tool.setExpanded(true);
      tools.delete(message.toolCallId);
      return [];
    }
    return [messageFallback(message, theme)];
  }
  if (message.role === 'user') {
    const text = Array.isArray(message.content)
      ? contentText(message.content)
      : message.content;
    return [new UserMessageComponent(text, theme)];
  }
  if (message.role === 'bashExecution') {
    const component = new BashExecutionComponent(
      message.command,
      source.tui,
      message.excludeFromContext,
    );
    if (message.output) component.appendOutput(message.output);
    component.setComplete(message.exitCode, message.cancelled);
    component.setExpanded(true);
    const blocks: TranscriptBlock[] = [component];
    if (message.truncated)
      blocks.push(
        markdown(
          message.fullOutputPath === undefined
            ? 'Native tool output was truncated; the full output path is unavailable.'
            : `Native tool output was truncated. Full output: ${message.fullOutputPath}`,
          theme,
        ),
      );
    return blocks;
  }
  if (message.role === 'custom') {
    const component = new CustomMessageComponent(message, undefined, theme);
    component.setExpanded(true);
    return [component];
  }
  if (message.role === 'branchSummary') {
    const component = new BranchSummaryMessageComponent(message, theme);
    component.setExpanded(true);
    return [component];
  }
  if (message.role === 'compactionSummary') {
    const component = new CompactionSummaryMessageComponent(message, theme);
    component.setExpanded(true);
    return [component];
  }
  return [messageFallback(message, theme)];
}

function requestEntries(
  source: TranscriptSource,
  request: RequestRecord,
): RequestEntries {
  const currentFile = source.sessionManager.getSessionFile();
  if (
    request.sessionFile !== undefined &&
    currentFile !== undefined &&
    request.sessionFile !== currentFile
  ) {
    return {
      request,
      entries: [],
      unavailable: 'The saved request belongs to another session file.',
    };
  }
  try {
    const entries = request.endEntryId
      ? source.sessionManager.getBranch(request.endEntryId)
      : source.sessionManager.getBranch();
    const endIndex =
      request.endEntryId === undefined
        ? entries.length - 1
        : entries.findIndex(entry => entry.id === request.endEntryId);
    if (request.endEntryId !== undefined && endIndex === -1)
      return {
        request,
        entries: [],
        unavailable: `Saved end entry ${request.endEntryId} is unavailable.`,
      };
    const startEntryIndex =
      request.startEntryId === undefined
        ? -1
        : entries.findIndex(entry => entry.id === request.startEntryId);
    if (request.startEntryId !== undefined && startEntryIndex === -1)
      return {
        request,
        entries: [],
        unavailable: `Saved start entry ${request.startEntryId} is unavailable.`,
      };
    const startIndex = startEntryIndex + 1;
    if (startIndex > endIndex + 1)
      return {
        request,
        entries: [],
        unavailable: 'Saved request entry range is invalid.',
      };
    return {request, entries: entries.slice(startIndex, endIndex + 1)};
  } catch (error) {
    return {
      request,
      entries: [],
      unavailable:
        error instanceof Error
          ? `Saved transcript could not be read: ${error.message}`
          : 'Saved transcript could not be read.',
    };
  }
}

export class Transcript {
  private readonly blocks: readonly TranscriptBlock[];

  constructor(source: TranscriptSource) {
    const theme = source.markdownTheme;
    const selected = source.requests;
    const sections: RequestEntries[] =
      selected.length > 0
        ? selected.map(request => requestEntries(source, request))
        : [
            {
              entries: source.sessionManager.getBranch(),
            },
          ];
    const blocks: TranscriptBlock[] = [];
    for (const section of sections) {
      if (section.request !== undefined)
        blocks.push(requestHeading(section.request, theme));
      if (section.unavailable !== undefined)
        blocks.push(markdown(`> ${section.unavailable}`, theme));
      const tools = new Map<string, TranscriptBlock>();
      const recordedResults = new Set(
        section.entries
          .flatMap(entry => sessionEntryToContextMessages(entry))
          .filter(message => message.role === 'toolResult')
          .map(message => message.toolCallId),
      );
      for (const entry of section.entries) {
        const messages = sessionEntryToContextMessages(entry);
        if (messages.length === 0) {
          if (entry.type === 'custom')
            blocks.push(markdown(`Custom entry: ${entry.customType}`, theme));
          continue;
        }
        for (const message of messages) {
          blocks.push(
            ...componentsForMessage(
              message,
              source,
              theme,
              tools,
              recordedResults,
            ),
          );
        }
      }
      if (section.entries.length === 0 && section.unavailable === undefined)
        blocks.push(markdown('> No retained transcript entries.', theme));
    }
    this.blocks = blocks;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    for (const block of this.blocks) {
      const rendered = block.render(Math.max(1, Math.floor(width)));
      if (rendered.length === 0) continue;
      if (lines.length > 0) lines.push('');
      lines.push(...rendered);
    }
    return lines;
  }
}
