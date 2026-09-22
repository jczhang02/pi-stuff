import type {Theme} from '@earendil-works/pi-coding-agent';
import {Text, truncateToWidth, type Component} from '@earendil-works/pi-tui';

// Pi Text owns wrapping and its cache. The block owns the shared result gutter.
export class ResultBlock implements Component {
  private readonly body: Text;

  constructor(
    text: string,
    private readonly theme: Theme,
    private readonly color: 'error' | 'warning' | 'muted' | 'toolOutput',
  ) {
    this.body = new Text(theme.fg(color, text), 0, 0);
  }

  invalidate() {
    this.body.invalidate();
  }

  render(width: number): string[] {
    return this.body
      .render(Math.max(1, width - 4))
      .map((line, index) =>
        truncateToWidth(
          `${this.theme.fg(this.color, index === 0 ? '  ⎿ ' : '    ')}${line}`,
          width,
        ),
      );
  }
}
