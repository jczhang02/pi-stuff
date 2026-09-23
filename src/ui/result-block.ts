import type {Theme} from '@earendil-works/pi-coding-agent';
import type {ToolView} from './tool-lookup';
import {ToolHeading} from './heading';
import {
  Text,
  truncateToWidth,
  stripTerminalSequences,
  type Component,
} from '@earendil-works/pi-tui';

// Unexpected display inputs must not discard the tool's identity or result.
// This boundary is presentation-only; Pi still validates and executes calls.
export function guardToolView(view: ToolView, label: string): ToolView {
  const {renderCall, renderResult} = view;
  return {
    ...view,
    renderCall(args, theme, context) {
      try {
        if (renderCall) return renderCall(args, theme, context);
      } catch {
        // Retain raw arguments rather than guessing their tool-specific meaning.
      }
      return new ToolHeading(label, JSON.stringify(args) ?? '', theme, context);
    },
    renderResult(result, options, theme, context) {
      try {
        if (renderResult) return renderResult(result, options, theme, context);
      } catch {
        // Unknown details cannot justify hiding any of the retained result.
      }
      return new ResultBlock(
        result.content
          .map(block =>
            block.type === 'text' ? block.text : `[image: ${block.mimeType}]`,
          )
          .join('\n'),
        theme,
        context.isError ? 'error' : 'toolOutput',
      );
    },
  };
}

// Pi Text owns wrapping and its cache. The block owns the shared result gutter.
export class ResultBlock implements Component {
  private readonly body: Text;

  constructor(
    text: string,
    private readonly theme: Theme,
    private readonly color: 'error' | 'warning' | 'muted' | 'toolOutput',
  ) {
    this.body = new Text(theme.fg(color, stripTerminalSequences(text)), 0, 0);
  }

  invalidate() {
    this.body.invalidate();
  }

  render(width: number): string[] {
    return this.body
      .render(Math.max(1, width - 5))
      .map((line, index) =>
        truncateToWidth(
          `${this.theme.fg(this.color, index === 0 ? '  ⎿  ' : '     ')}${line}`,
          width,
        ),
      );
  }
}
