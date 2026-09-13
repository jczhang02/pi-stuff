import type {AssistantMessage} from '@earendil-works/pi-ai';
import {
  AssistantMessageComponent,
  UserMessageComponent,
  ToolExecutionComponent,
  createReadToolDefinition,
  createBashToolDefinition,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  stripTerminalSequences,
  type Component,
  type TUI,
} from '@earendil-works/pi-tui';
import {
  fixtureModel,
  usageFor,
  type ObservationAgent,
  type ObservationMessage,
} from './scenario';

// Native message components inside a real ScrollView; no manual viewport cropping.
export class Transcript implements Component {
  private components = new Map<ObservationMessage, Component>();
  private revisions = new Map<ObservationMessage, string>();
  private readTool;
  private bashTool;
  lines: string[] = [];
  query = '';

  constructor(
    private agents: ObservationAgent[],
    private tui: TUI,
    private theme: Theme,
    private merged = false,
  ) {
    this.readTool = createReadToolDefinition(process.cwd());
    this.bashTool = createBashToolDefinition(process.cwd());
  }

  invalidate(): void {
    for (const component of this.components.values()) component.invalidate();
  }

  render(width: number): string[] {
    const entries = this.agents.flatMap(agent =>
      agent.messages.map(message => ({agent, message})),
    );
    if (this.merged) entries.sort((a, b) => a.message.seq - b.message.seq);
    this.lines = entries.flatMap(({agent, message}) => {
      let component = this.components.get(message);
      if (!component) {
        if (message.kind === 'user')
          component = new UserMessageComponent(message.text);
        else if (message.kind === 'assistant')
          component = new AssistantMessageComponent();
        else {
          const tool = new ToolExecutionComponent(
            message.name,
            String(message.seq),
            message.args,
            {showImages: false},
            message.name === 'read' ? this.readTool : this.bashTool,
            this.tui,
            process.cwd(),
          );
          tool.setArgsComplete();
          if (message.state === 'running') tool.markExecutionStarted();
          component = tool;
        }
        this.components.set(message, component);
      }
      if (
        message.kind === 'assistant' &&
        component instanceof AssistantMessageComponent
      ) {
        const revision = `${message.streaming}:${message.text}`;
        if (this.revisions.get(message) !== revision) {
          const content: AssistantMessage = {
            role: 'assistant',
            content: [{type: 'text', text: message.text}],
            api: fixtureModel.api,
            provider: fixtureModel.provider,
            model: fixtureModel.id,
            usage: usageFor(agent),
            stopReason: 'stop',
            timestamp: 0,
          };
          component.updateContent(content, message.streaming);
          this.revisions.set(message, revision);
        }
      }
      if (
        message.kind === 'tool' &&
        component instanceof ToolExecutionComponent
      ) {
        const revision = `${agent.expanded}:${message.state}:${message.detail}`;
        if (this.revisions.get(message) !== revision) {
          component.setExpanded(agent.expanded);
          component.updateResult(
            {
              content: [{type: 'text', text: message.detail}],
              isError: message.state === 'error',
            },
            message.state === 'running',
          );
          this.revisions.set(message, revision);
        }
      }
      const heading = this.merged
        ? [
            '',
            this.theme.fg(
              'accent',
              `${agent.name}  ·  ${message.kind === 'user' ? '收到消息' : message.kind === 'tool' ? message.name : '回复'}`,
            ),
          ]
        : [];
      return [...heading, ...component.render(width)];
    });
    return this.lines.map(line =>
      this.query &&
      stripTerminalSequences(line)
        .toLowerCase()
        .includes(this.query.toLowerCase())
        ? this.theme.bg('selectedBg', line)
        : line,
    );
  }

  matches(query: string): number[] {
    return this.lines.flatMap((line, i) =>
      query &&
      stripTerminalSequences(line).toLowerCase().includes(query.toLowerCase())
        ? [i]
        : [],
    );
  }

  dispose(): void {
    for (const component of this.components.values()) {
      if (component instanceof ToolExecutionComponent)
        component.updateResult({content: [], isError: false}, false);
    }
  }
}
