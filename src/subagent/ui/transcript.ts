import type {AgentMessage} from '@earendil-works/pi-agent-core';
import type {ToolCall} from '@earendil-works/pi-ai';
import type {
  AgentSession,
  AgentSessionEvent,
  ToolExecutionEndEvent,
  ToolExecutionUpdateEvent,
} from '@earendil-works/pi-coding-agent';
import {
  AssistantMessageComponent,
  CompactionSummaryMessageComponent,
  BranchSummaryMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  createBashToolDefinition,
  sessionEntryToContextMessages,
} from '@earendil-works/pi-coding-agent';
import {Text, type Component, type TUI} from '@earendil-works/pi-tui';

type ToolProgress = ToolExecutionUpdateEvent | ToolExecutionEndEvent;

interface ToolTiming {
  start: number;
  end: number | undefined;
}

interface Notice {
  key: string;
  text: string;
}

/** Renders a child AgentSession using Pi's native conversation components. */
export class Transcript {
  readonly messages: AgentMessage[];
  readonly tools = new Map<string, ToolProgress>();
  private readonly timings = new Map<string, ToolTiming>();
  private readonly components = new Map<number | string, Component>();
  private readonly activeTools = new Set<ToolExecutionComponent>();
  private readonly notices: Notice[] = [];
  private streamingIndex = -1;
  private streaming = false;
  private tui: TUI | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    readonly session: AgentSession,
    private readonly changed: () => void,
  ) {
    this.messages = session.sessionManager
      .getBranch()
      .flatMap(sessionEntryToContextMessages);
    this.unsubscribe = session.subscribe(event => this.onEvent(event));
  }

  attach(tui: TUI): void {
    this.tui = tui;
  }

  render(width: number, expanded: boolean): string[] {
    if (!this.tui) return [];
    const lines: string[] = [];
    for (const notice of this.notices) {
      let component = this.components.get(notice.key);
      if (!component) {
        component = new Text(notice.text, 1, 1);
        this.components.set(notice.key, component);
      }
      lines.push(...component.render(width));
    }

    for (const [index, message] of this.messages.entries()) {
      if (message.role === 'toolResult') continue;
      const component = this.messageComponent(index, message);
      if (
        component instanceof AssistantMessageComponent &&
        message.role === 'assistant' &&
        'stopReason' in message
      ) {
        component.updateContent(
          message,
          this.streaming && this.streamingIndex === index,
        );
      }
      if (
        component instanceof CompactionSummaryMessageComponent ||
        component instanceof BranchSummaryMessageComponent
      )
        component.setExpanded(expanded);
      if (component) lines.push(...component.render(width));
      if (message.role !== 'assistant') continue;
      for (const call of message.content) {
        if (call.type !== 'toolCall') continue;
        const tool = this.toolComponent(call.id, call.name, call.arguments);
        if (!(this.streaming && this.streamingIndex === index))
          tool.setArgsComplete();
        tool.setExpanded(expanded);
        this.updateToolFromState(tool, call.id);
        lines.push(...tool.render(width));
      }
    }
    return lines;
  }

  detach(): void {
    this.releaseActiveTools();
    this.components.clear();
    this.tui = undefined;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.detach();
  }

  private onEvent(event: AgentSessionEvent): void {
    if (event.type === 'tool_execution_start') {
      this.timings.set(event.toolCallId, {start: Date.now(), end: undefined});
    } else if (event.type === 'tool_execution_end') {
      const timing = this.timings.get(event.toolCallId);
      if (timing) timing.end = Date.now();
    }

    if (event.type === 'message_start') {
      this.streamingIndex = this.messages.push(event.message) - 1;
      this.streaming = event.message.role === 'assistant';
      if (event.message.role === 'user') {
        this.removeNotice('error');
        this.removeNotice('abort');
      }
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
      this.updateToolComponent(event.toolCallId, event);
    } else if (event.type === 'compaction_start') {
      this.setNotice('compaction', `Compacting context (${event.reason})...`);
    } else if (event.type === 'compaction_end') {
      this.releaseActiveTools();
      this.components.clear();
      if (event.errorMessage || event.aborted)
        this.setNotice(
          'compaction',
          `Compaction failed: ${event.errorMessage ?? 'aborted'}`,
        );
      else {
        this.messages.splice(
          0,
          this.messages.length,
          ...this.session.sessionManager
            .getBranch()
            .flatMap(sessionEntryToContextMessages),
        );
        this.streamingIndex = -1;
        this.streaming = false;
        this.removeNotice('compaction');
      }
    } else if (event.type === 'auto_retry_start') {
      this.setNotice(
        'retry',
        `Retrying (${event.attempt}/${event.maxAttempts}): ${event.errorMessage}`,
      );
    } else if (event.type === 'auto_retry_end') {
      if (event.success) this.removeNotice('retry');
      else
        this.setNotice(
          'retry',
          `Retry failed: ${event.finalError ?? 'no further attempts available'}`,
        );
    } else if (event.type === 'summarization_retry_scheduled') {
      this.setNotice(
        'retry',
        `Retrying context summary (${event.attempt}/${event.maxAttempts}): ${event.errorMessage}`,
      );
    } else if (event.type === 'agent_end' && !event.willRetry) {
      const message = event.messages.at(-1);
      if (message?.role === 'assistant' && message.stopReason === 'aborted')
        this.setNotice(
          'abort',
          `Agent aborted: ${message.errorMessage ?? 'operation canceled'}`,
        );
      else if (message?.role === 'assistant' && message.stopReason === 'error')
        this.setNotice(
          'error',
          `Agent error: ${message.errorMessage ?? 'unknown error'}`,
        );
    }
    this.changed();
  }

  private messageComponent(
    index: number,
    message: AgentMessage,
  ): Component | undefined {
    let component = this.components.get(index);
    if (component) return component;
    if (message.role === 'user') {
      const text = Array.isArray(message.content)
        ? message.content
            .filter(part => part.type === 'text')
            .map(part => part.text)
            .join('\n')
        : message.content;
      component = new UserMessageComponent(text);
    } else if (message.role === 'assistant') {
      component = new AssistantMessageComponent();
    } else if (message.role === 'compactionSummary') {
      component = new CompactionSummaryMessageComponent(message);
    } else if (message.role === 'branchSummary') {
      component = new BranchSummaryMessageComponent(message);
    } else if (message.role === 'custom' && message.display) {
      component = new Text(String(message.content), 1, 1);
    }
    if (component) this.components.set(index, component);
    return component;
  }

  private toolComponent(
    id: string,
    name: string,
    args: ToolCall['arguments'],
  ): ToolExecutionComponent {
    const existing = this.components.get(id);
    if (existing instanceof ToolExecutionComponent) {
      existing.updateArgs(args);
      return existing;
    }
    const tui = this.tui;
    if (!tui)
      throw new Error('Transcript must be attached before rendering tools');
    const definition = this.definitionFor(name, id);
    const tool = new ToolExecutionComponent(
      name,
      id,
      args,
      {showImages: true},
      definition,
      tui,
      this.session.sessionManager.getCwd(),
    );
    this.components.set(id, tool);
    return tool;
  }

  private definitionFor(name: string, id: string) {
    if (name !== 'bash') return this.session.getToolDefinition(name);
    const cwd = this.session.sessionManager.getCwd();
    const definition = createBashToolDefinition(cwd);
    if (!definition.renderCall && !definition.renderResult) return definition;

    const renderCall = definition.renderCall;
    if (renderCall)
      definition.renderCall = (args, theme, context) => {
        const timing = this.timings.get(id);
        if (timing) {
          context.state.startedAt = timing.start;
          context.state.endedAt = timing.end;
        }
        return renderCall(args, theme, context);
      };
    const renderResult = definition.renderResult;
    if (renderResult)
      definition.renderResult = (result, options, theme, context) => {
        const timing = this.timings.get(id);
        if (timing) {
          context.state.startedAt = timing.start;
          context.state.endedAt = timing.end;
        }
        return renderResult(result, options, theme, context);
      };
    return definition;
  }

  private updateToolFromState(tool: ToolExecutionComponent, id: string): void {
    const progress = this.tools.get(id);
    if (progress) {
      this.updateToolComponent(id, progress);
      return;
    }
    const result = this.messages.find(
      message => message.role === 'toolResult' && message.toolCallId === id,
    );
    if (result?.role === 'toolResult') {
      tool.updateResult(result, false);
      return;
    }
  }

  private updateToolComponent(id: string, event: ToolProgress): void {
    const component = this.components.get(id);
    if (!(component instanceof ToolExecutionComponent)) return;
    if (event.type === 'tool_execution_update') {
      component.markExecutionStarted();
      component.updateResult({...event.partialResult, isError: false}, true);
      this.activeTools.add(component);
    } else {
      component.updateResult({...event.result, isError: event.isError}, false);
      this.activeTools.delete(component);
    }
  }

  private releaseActiveTools(): void {
    for (const tool of this.activeTools)
      tool.updateResult({content: [], isError: false}, false);
    this.activeTools.clear();
  }

  private setNotice(key: string, text: string): void {
    const existing = this.notices.find(notice => notice.key === key);
    if (existing) existing.text = text;
    else this.notices.push({key, text});
    this.components.delete(key);
  }

  private removeNotice(key: string): void {
    const index = this.notices.findIndex(notice => notice.key === key);
    if (index >= 0) this.notices.splice(index, 1);
    this.components.delete(key);
  }
}
