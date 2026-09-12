// References: Anthropic Footer bindings and tintinweb/pi-subagents 0.19.0.
// Original offline implementation; no upstream source copied.
import type {Theme} from '@earendil-works/pi-coding-agent';
import {
  isKeyRelease,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui';
import {stop, type DemoAgent} from './model';

export function canvas(text: string, theme: Theme): string {
  // Pi 0.85.1 bundled export.pageBg values prevent relay default-color mixing.
  const bg =
    theme.name === 'light' ? '\x1b[48;2;248;248;248m' : '\x1b[48;2;24;24;30m';
  const fg = theme.getFgAnsi('text');
  return (
    fg +
    bg +
    text
      .replaceAll('\x1b[0m', `\x1b[0m${fg}${bg}`)
      .replaceAll('\x1b[39m', fg)
      .replaceAll('\x1b[49m', bg)
  );
}

export function paint(line: string, width: number, theme: Theme): string {
  const fitted = truncateToWidth(line, width, '…');
  const padded = fitted + ' '.repeat(Math.max(0, width - visibleWidth(fitted)));
  return canvas(padded, theme) + '\x1b[0m';
}

function tokens(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

export class Fleet {
  private selected = 0;
  focused = false;

  constructor(readonly agents: DemoAgent[]) {}

  // undefined passes input to the editor; true consumes it; an agent opens it.
  handleInput(data: string, empty: boolean): DemoAgent | true | undefined {
    if (isKeyRelease(data)) return true;
    if (!this.focused) {
      if (empty && (matchesKey(data, 'down') || matchesKey(data, 'left'))) {
        this.focused = true;
        this.selected = 0;
        return true;
      }
      return undefined;
    }
    if (matchesKey(data, 'up')) {
      if (this.selected === 0) this.focused = false;
      else this.selected -= 1;
    } else if (matchesKey(data, 'down')) {
      this.selected = Math.min(this.agents.length - 1, this.selected + 1);
    } else if (matchesKey(data, 'escape')) {
      this.focused = false;
    } else if (matchesKey(data, 'enter')) {
      this.focused = false;
      return this.agents[this.selected];
    } else if (data === 'x' && this.selected > 0) {
      const agent = this.agents[this.selected];
      if (agent?.status === '运行中') stop(agent);
    } else {
      this.focused = false;
      return undefined;
    }
    return true;
  }

  render(width: number, theme: Theme, viewing: string): string[] {
    if (width < 50)
      return [theme.fg('warning', 'Fleet 需要至少 50 列；请放宽终端。')];
    const start = Math.max(0, this.selected - 4);
    const rows = this.agents.slice(start, start + 5).map((agent, offset) => {
      const selected = this.focused && this.selected === start + offset;
      const running = agent.status === '运行中';
      const icon = running
        ? ['⠋', '⠙', '⠹', '⠸'][Math.floor(Date.now() / 200) % 4]
        : agent.status === '等待输入'
          ? '?'
          : agent.status === '已停止'
            ? '■'
            : '✓';
      const color =
        agent.status === '等待输入' || agent.status === '已停止'
          ? 'warning'
          : running
            ? 'accent'
            : 'success';
      const name = agent.id === 'main' ? 'main' : agent.name;
      const identity = `${selected ? '›' : ' '} ${theme.fg(color, icon ?? '●')} ${theme.bold(name)}${viewing === agent.id ? ' *' : ''}`;
      const essential = `↑ ${tokens(agent.inputTokens)} · ↓ ${tokens(agent.outputTokens)} · ${agent.elapsed}s`;
      const stats =
        width >= 125
          ? `${agent.tools} tools · ${agent.turns} turns · ${essential} · $${agent.cost.toFixed(4)}`
          : essential;
      const leftWidth = Math.max(0, width - visibleWidth(stats) - 3);
      const left = truncateToWidth(
        `${identity} · ${agent.activity}`,
        leftWidth,
        '…',
      );
      const row =
        left +
        ' '.repeat(
          Math.max(1, width - visibleWidth(left) - visibleWidth(stats)),
        ) +
        theme.fg('muted', stats);
      return selected ? theme.bg('selectedBg', row) : row;
    });
    if (start > 0 || start + 5 < this.agents.length)
      rows.push(
        theme.fg(
          'muted',
          `  ${start + 1}–${Math.min(start + 5, this.agents.length)} / ${this.agents.length}`,
        ),
      );
    return rows;
  }
}
