// Real AgentSession events feed native Pi components; no synthetic tool results.
import type {AgentMessage} from '@earendil-works/pi-agent-core';
import type {
  AgentSession,
  AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import {
  AssistantMessageComponent,
  UserMessageComponent,
  ToolExecutionComponent,
  createBashToolDefinition,
  createReadToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {Text, type Component, type TUI} from '@earendil-works/pi-tui';
import {Schema} from 'effect';

type ToolProgress = Extract<
  AgentSessionEvent,
  {type: 'tool_execution_update' | 'tool_execution_end'}
>;

export class Transcript {
  readonly messages: AgentMessage[];
  readonly tools = new Map<string, ToolProgress>();
  private toolTimes = new Map<
    string,
    {start: number; end: number | undefined}
  >();
  private streamingIndex = -1;
  private streaming = false;
  private components = new Map<number | string, Component>();
  private activeTools = new Set<ToolExecutionComponent>();
  private tui: TUI | undefined;
  private unsubscribe;

  constructor(
    readonly session: AgentSession,
    private changed: () => void,
  ) {
    this.messages = [...session.messages];
    this.unsubscribe = session.subscribe(event => {
      if (event.type === 'tool_execution_start')
        this.toolTimes.set(event.toolCallId, {
          start: Date.now(),
          end: undefined,
        });
      if (event.type === 'tool_execution_end') {
        const timing = this.toolTimes.get(event.toolCallId);
        if (timing) timing.end = Date.now();
      }
      if (event.type === 'message_start') {
        this.streamingIndex = this.messages.push(event.message) - 1;
        this.streaming = event.message.role === 'assistant';
      } else if (
        event.type === 'message_update' ||
        event.type === 'message_end'
      ) {
        if (this.streamingIndex >= 0)
          this.messages[this.streamingIndex] = event.message;
        if (event.type === 'message_end') this.streaming = false;
      } else if (
        event.type === 'tool_execution_update' ||
        event.type === 'tool_execution_end'
      ) {
        this.tools.set(event.toolCallId, event);
        const component = this.components.get(event.toolCallId);
        if (component instanceof ToolExecutionComponent)
          this.updateTool(component, event);
      }
      this.changed();
    });
  }

  attach(tui: TUI): void {
    this.tui = tui;
  }

  render(width: number, expanded: boolean): string[] {
    const tui = this.tui;
    if (!tui) return [];
    const lines: string[] = [];
    for (const [index, message] of this.messages.entries()) {
      if (message.role === 'toolResult') continue;
      let component = this.components.get(index);
      if (!component) {
        if (message.role === 'user') {
          const text = Schema.is(Schema.String)(message.content)
            ? message.content
            : message.content
                .filter(part => part.type === 'text')
                .map(part => part.text)
                .join('\n');
          component = new UserMessageComponent(text);
        } else if (message.role === 'assistant')
          component = new AssistantMessageComponent();
        else if (message.role === 'custom' && message.display)
          component = new Text(String(message.content), 1, 1);
        if (component) this.components.set(index, component);
      }
      if (
        message.role === 'assistant' &&
        component instanceof AssistantMessageComponent
      ) {
        component.updateContent(
          message,
          this.streaming && this.streamingIndex === index,
        );
      }
      if (component) lines.push(...component.render(width));
      if (message.role !== 'assistant') continue;
      for (const call of message.content) {
        if (call.type !== 'toolCall') continue;
        let tool = this.components.get(call.id);
        if (!(tool instanceof ToolExecutionComponent)) {
          const cwd = this.session.sessionManager.getCwd();
          const definition =
            call.name === 'read'
              ? createReadToolDefinition(cwd)
              : call.name === 'bash'
                ? this.bashDefinition(cwd, call.id)
                : undefined;
          tool = new ToolExecutionComponent(
            call.name,
            call.id,
            call.arguments,
            {showImages: false},
            definition,
            tui,
            cwd,
          );
          this.components.set(call.id, tool);
        }
        if (!(tool instanceof ToolExecutionComponent)) continue;
        tool.updateArgs(call.arguments);
        tool.setArgsComplete();
        tool.setExpanded(expanded);
        const progress = this.tools.get(call.id);
        const result = this.messages.find(
          entry => entry.role === 'toolResult' && entry.toolCallId === call.id,
        );
        if (progress) this.updateTool(tool, progress);
        else if (result?.role === 'toolResult')
          tool.updateResult(result, false);
        else if (this.session.isStreaming) {
          tool.markExecutionStarted();
          this.activeTools.add(tool);
        }
        lines.push(...tool.render(width));
      }
    }
    return lines;
  }

  private bashDefinition(cwd: string, id: string) {
    const definition = createBashToolDefinition(cwd);
    const call = definition.renderCall;
    const result = definition.renderResult;
    // Native shell renderers otherwise start their clock when the viewer opens.
    // Seed their public renderer state from observed execution events.
    if (call)
      definition.renderCall = (args, theme, context) => {
        const timing = this.toolTimes.get(id);
        if (timing) {
          context.state.startedAt = timing.start;
          context.state.endedAt = timing.end;
        }
        return call(args, theme, context);
      };
    if (result)
      definition.renderResult = (value, options, theme, context) => {
        const timing = this.toolTimes.get(id);
        if (timing) {
          context.state.startedAt = timing.start;
          context.state.endedAt = timing.end;
        }
        return result(value, options, theme, context);
      };
    return definition;
  }

  private updateTool(
    component: ToolExecutionComponent,
    event: ToolProgress,
  ): void {
    if (event.type === 'tool_execution_update') {
      component.markExecutionStarted();
      component.updateResult({...event.partialResult, isError: false}, true);
      this.activeTools.add(component);
    } else {
      component.updateResult({...event.result, isError: event.isError}, false);
      this.activeTools.delete(component);
    }
  }

  detach(): void {
    // Native bash renderers own timers; release them without touching execution.
    for (const tool of this.activeTools)
      tool.updateResult({content: [], isError: false}, false);
    this.activeTools.clear();
    this.components.clear();
    this.tui = undefined;
  }

  dispose(): void {
    this.unsubscribe();
    this.detach();
  }
}
