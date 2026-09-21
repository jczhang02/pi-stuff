import {
  ToolExecutionComponent,
  createReadToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  createBashToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  getMarkdownTheme,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type {AgentMessage} from '@earendil-works/pi-agent-core';
import type {ToolCall} from '@earendil-works/pi-ai';
import {
  Markdown,
  truncateToWidth,
  type Component,
  type TUI,
} from '@earendil-works/pi-tui';
import {Schema} from 'effect';

/** Built-in renderers are safe to recreate without starting a child session. */
export function recordedToolDefinition(name: string, cwd: string) {
  switch (name) {
    case 'read':
      return createReadToolDefinition(cwd);
    case 'edit':
      return createEditToolDefinition(cwd);
    case 'write':
      return createWriteToolDefinition(cwd);
    case 'bash':
      return createBashToolDefinition(cwd);
    case 'grep':
      return createGrepToolDefinition(cwd);
    case 'find':
      return createFindToolDefinition(cwd);
    case 'ls':
      return createLsToolDefinition(cwd);
    default:
      return undefined;
  }
}

/** Only executing native calls can describe current activity. */
export function currentActivity(
  messages: readonly AgentMessage[],
  pending: ReadonlySet<string>,
): string | undefined {
  const calls = messages
    .flatMap(message =>
      message.role === 'assistant'
        ? message.content.filter(part => part.type === 'toolCall')
        : [],
    )
    .filter(call => pending.has(call.id));
  const call = calls.at(-1);
  if (!call) return undefined;
  const args = call.arguments;
  const target = [args.path, args.file_path, args.pattern, args.command].find(
    value => Schema.is(Schema.String)(value),
  );
  const labels = new Map([
    ['read', 'Reading'],
    ['grep', 'Searching'],
    ['find', 'Finding'],
    ['ls', 'Listing'],
    ['bash', 'Running'],
    ['edit', 'Editing'],
    ['write', 'Writing'],
  ]);
  return `${labels.get(call.name) ?? call.name}${target ? ` ${target.replace(/[\r\n\t]/g, ' ')}` : ''}${calls.length > 1 ? ` (+${calls.length - 1})` : ''}`;
}

interface ActivitySource {
  readonly messages: readonly AgentMessage[];
  readonly tui: TUI;
  readonly cwd: string;
  readonly getToolDefinition?: (toolName: string) => ToolDefinition | undefined;
  readonly pendingToolCalls?: ReadonlySet<string>;
}

interface ToolCallRecord {
  readonly call: ToolCall;
  readonly result: Extract<AgentMessage, {role: 'toolResult'}> | undefined;
}

function toolCalls(messages: readonly AgentMessage[]): ToolCallRecord[] {
  const results = new Map<
    string,
    Extract<AgentMessage, {role: 'toolResult'}>
  >();
  const calls: ToolCall[] = [];
  for (const message of messages) {
    if (message.role === 'toolResult') {
      results.set(message.toolCallId, message);
      continue;
    }
    if (message.role !== 'assistant') continue;
    for (const part of message.content) {
      if (part.type === 'toolCall') calls.push(part);
    }
  }
  return calls.slice(-3).map(call => ({
    call,
    result: results.get(call.id),
  }));
}

function createItem(record: ToolCallRecord, source: ActivitySource): Component {
  if (
    record.result === undefined &&
    !source.pendingToolCalls?.has(record.call.id)
  )
    return new Markdown(
      `Tool call: ${record.call.name}\n\n${JSON.stringify(record.call.arguments, null, 2)}\n\nTool result not recorded.`,
      0,
      0,
      getMarkdownTheme(),
    );
  const component = new ToolExecutionComponent(
    record.call.name,
    record.call.id,
    record.call.arguments,
    {showImages: false},
    source.getToolDefinition?.(record.call.name) ??
      recordedToolDefinition(record.call.name, source.cwd),
    source.tui,
    source.cwd,
  );
  component.setExpanded(false);
  component.markExecutionStarted();
  component.setArgsComplete();
  if (record.result !== undefined) component.updateResult(record.result);
  return component;
}

/** A short, read-only native projection of the latest recorded tool calls. */
export class Activity {
  private readonly blocks: readonly Component[];

  constructor(source: ActivitySource) {
    this.blocks = toolCalls(source.messages).map(record =>
      createItem(record, source),
    );
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const columns = Math.max(1, Math.floor(width));
    for (const block of this.blocks) {
      const rendered = block.render(columns);
      lines.push(...rendered.slice(0, 8));
      if (rendered.length > 8)
        lines.push(
          truncateToWidth(
            `(${rendered.length - 8} more lines in Transcript)`,
            columns,
            '…',
          ),
        );
    }
    return lines.length ? lines : ['No recorded tool calls for this request.'];
  }
}
