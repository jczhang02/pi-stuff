// Throwaway UI exploration. Native components stay mounted; no overlay API is used.
import {CustomEditor, type Theme} from '@earendil-works/pi-coding-agent';
import {
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  type Component,
} from '@earendil-works/pi-tui';
import type {ObservationAgent} from './scenario';

const icons = {
  running: '\uf10c',
  waiting: '\uf059',
  completed: '\uf00c',
  stopped: '\uf04d',
  failed: '\uf06a',
};
export const tokens = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const fit = (s: string, width: number) => {
  const text = truncateToWidth(s, Math.max(0, width), '…');
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
};

export function fleetRows(
  agents: ObservationAgent[],
  width: number,
  theme: Theme,
  selected: number,
  focused: boolean,
): string[] {
  const nameWidth = Math.min(
    18,
    Math.max(6, Math.floor(width / 5)),
    Math.max(...agents.map(a => visibleWidth(a.name))),
  );
  const times = agents.map(a =>
    a.elapsed >= 60
      ? `${Math.floor(a.elapsed / 60)}m ${a.elapsed % 60}s`
      : `${a.elapsed}s`,
  );
  const timeWidth = Math.max(...times.map(visibleWidth));
  const inputWidth = Math.max(...agents.map(a => tokens(a.inputTokens).length));
  const outputWidth = Math.max(
    ...agents.map(a => tokens(a.outputTokens).length),
  );
  return agents.map((agent, index) => {
    const color =
      agent.status === 'failed'
        ? 'error'
        : agent.status === 'waiting' || agent.status === 'stopped'
          ? 'warning'
          : agent.status === 'completed'
            ? 'success'
            : 'muted';
    const metric = `${(times[index] ?? '').padStart(timeWidth)} · \uf062 ${tokens(agent.inputTokens).padStart(inputWidth)} · \uf063 ${tokens(agent.outputTokens).padStart(outputWidth)}`;
    // Keep the following space in the color span so wide Nerd glyph ink is not clipped.
    const prefix = `${focused && selected === index ? '\uf105' : ' '} ${theme.fg(color, `${icons[agent.status]} `)}${fit(agent.name, nameWidth)}  `;
    const activityWidth =
      width - visibleWidth(prefix) - visibleWidth(metric) - 2;
    const text =
      activityWidth >= 1
        ? prefix +
          fit(agent.activity, activityWidth) +
          '  ' +
          theme.fg('muted', metric)
        : fit(prefix, Math.max(0, width - visibleWidth(metric) - 1)) +
          ' ' +
          theme.fg('muted', metric);
    const row = truncateToWidth(text, width, '…');
    return focused && index === selected ? theme.bg('selectedBg', row) : row;
  });
}

export function decorateEditor(
  editor: CustomEditor,
  agent: ObservationAgent,
  theme: Theme,
): void {
  const render = editor.render.bind(editor);
  editor.render = width => {
    // Pi 0.85.1 draws its soft cursor even when focused=false. Only the active
    // editor should show that cursor when two native editors share a layout.
    const lines = render(width).map(line =>
      editor.focused ? line : line.replaceAll('\x1b[7m', ''),
    );
    if (agent.id === 'main') return lines;
    const top = lines[0] ?? '';
    const trailing = stripTerminalSequences(top).match(/─+$/u)?.[0].length ?? 0;
    // Preserve native working/hidden-line indicators; use only trailing border.
    const available = Math.min(60, Math.floor(width / 2), trailing - 3);
    if (available < 4) return lines;
    const label = truncateToWidth(
      `${agent.name} · ${agent.task}`,
      available,
      '…',
    );
    const remaining = Math.max(0, width - visibleWidth(label) - 3);
    lines[0] =
      truncateToWidth(top, remaining, '') +
      theme.bg('selectedBg', theme.fg('accent', ` ${label} `)) +
      editor.borderColor('─');
    return lines;
  };
}

export function dynamic(render: (width: number) => string[]): Component {
  return {render, invalidate() {}};
}

export function canvas(data: string, theme: Theme): string {
  const bg =
    theme.name === 'light' ? '\x1b[48;2;248;248;248m' : '\x1b[48;2;24;24;30m';
  const fg = theme.getFgAnsi('text');
  return (
    fg +
    bg +
    data
      .replaceAll('\x1b[0m', `\x1b[0m${fg}${bg}`)
      .replaceAll('\x1b[39m', fg)
      .replaceAll('\x1b[49m', bg)
  );
}
