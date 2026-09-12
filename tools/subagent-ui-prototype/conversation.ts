// Native Pi presentation; sample data never reaches a tool's execute method.
import type {AssistantMessage} from '@earendil-works/pi-ai';
import {
  AssistantMessageComponent,
  UserMessageComponent,
  ToolExecutionComponent,
  createReadToolDefinition,
  createBashToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type {Component, TUI} from '@earendil-works/pi-tui';
import type {DemoAgent, Message} from './model';

function assistantMessage(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{type: 'text', text}],
    api: 'openai-responses',
    provider: 'fixture',
    model: 'ui-playback',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
    },
    stopReason: 'stop',
    timestamp: 0,
  };
}

export class Conversation {
  private components = new Map<Message, Component>();
  private activeTools = new Set<ToolExecutionComponent>();
  private readTool;
  private bashTool;

  constructor(
    private tui: TUI,
    private cwd: string,
  ) {
    this.readTool = createReadToolDefinition(cwd);
    this.bashTool = createBashToolDefinition(cwd);
  }

  render(agent: DemoAgent, width: number, skip = 0): string[] {
    return agent.messages.slice(skip).flatMap(entry => {
      let component = this.components.get(entry);
      if (!component) {
        if (entry.kind === 'user')
          component = new UserMessageComponent(entry.text);
        else if (entry.kind === 'assistant')
          component = new AssistantMessageComponent();
        else {
          const tool = new ToolExecutionComponent(
            entry.name,
            `fixture-${this.components.size}`,
            entry.args,
            {showImages: false},
            entry.name === 'read' ? this.readTool : this.bashTool,
            this.tui,
            this.cwd,
          );
          tool.setArgsComplete();
          if (entry.state === 'running') tool.markExecutionStarted();
          component = tool;
        }
        this.components.set(entry, component);
      }
      if (
        entry.kind === 'assistant' &&
        component instanceof AssistantMessageComponent
      ) {
        component.updateContent(assistantMessage(entry.text), entry.streaming);
      }
      if (
        entry.kind === 'tool' &&
        component instanceof ToolExecutionComponent
      ) {
        component.setExpanded(agent.expanded);
        component.updateResult(
          {
            content: [{type: 'text', text: entry.detail}],
            isError: entry.state === 'error',
          },
          entry.state === 'running',
        );
        if (entry.state === 'running') this.activeTools.add(component);
        else this.activeTools.delete(component);
      }
      return component.render(width);
    });
  }

  // Pi's native Bash renderer owns a duration timer while a result is partial.
  // Settle it even if its agent is offscreen, and before resetting/closing the demo.
  settleTools(agents: DemoAgent[]): void {
    for (const agent of agents) {
      for (const entry of agent.messages) {
        const component = this.components.get(entry);
        if (
          entry.kind === 'tool' &&
          entry.state !== 'running' &&
          component instanceof ToolExecutionComponent &&
          this.activeTools.has(component)
        ) {
          component.updateResult(
            {
              content: [{type: 'text', text: entry.detail}],
              isError: entry.state === 'error',
            },
            false,
          );
          this.activeTools.delete(component);
        }
      }
    }
  }

  clear(): void {
    for (const component of this.activeTools) {
      component.updateResult({content: [], isError: false}, false);
    }
    this.activeTools.clear();
    this.components.clear();
  }
}
