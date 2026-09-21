import {
  ToolExecutionComponent,
  getMarkdownTheme,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type {AgentMessage} from '@earendil-works/pi-agent-core';
import type {ToolCall} from '@earendil-works/pi-ai';
import {Markdown, type Component, type TUI} from '@earendil-works/pi-tui';

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
    source.getToolDefinition?.(record.call.name),
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
      lines.push(...block.render(columns));
    }
    return lines.length ? lines : ['No recorded tool calls for this request.'];
  }
}
