// Presentation-only renderer for the conversation prototype.
import {
  UserMessageComponent,
  getMarkdownTheme,
  highlightCode,
  getLanguageFromPath,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  Box,
  Spacer,
  Container,
  MouseRegion,
  Markdown,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from '@earendil-works/pi-tui';
import type {Entry, Tool, ToolBody} from './model';

export type Expansion = {open: boolean; children: Expansion[]};
export function expansionFor(entry: Entry): Expansion {
  return {
    open: false,
    children: entry.kind === 'explore' ? entry.tools.map(expansionFor) : [],
  };
}
export function expandAll(state: Expansion, open: boolean): void {
  state.open = open;
  state.children.forEach(child => expandAll(child, open));
}
function indent(lines: readonly string[], prefix: string): string[] {
  return lines.map(line => prefix + line);
}
function code(text: string, path: string): string[] {
  return highlightCode(text, getLanguageFromPath(path));
}
function codeRows(
  lines: readonly string[],
  start: number,
  width: number,
  theme: Theme,
): string[] {
  const digits = String(start + lines.length - 1).length;
  const gutter = digits + 3;
  return lines.flatMap((line, index) =>
    wrapTextWithAnsi(line, Math.max(1, width - gutter)).map(
      (part, wrapped) =>
        `${theme.fg('muted', wrapped ? ' '.repeat(digits) : String(start + index).padStart(digits))}${theme.fg('dim', ' │ ')}${part}`,
    ),
  );
}
function bodyRows(body: ToolBody, width: number, theme: Theme): string[] {
  switch (body.kind) {
    case 'text':
      return body.text
        ? body.text
            .split('\n')
            .flatMap(line =>
              wrapTextWithAnsi(theme.fg('toolOutput', line), width),
            )
        : [];
    case 'code':
      return codeRows(code(body.text, body.path), body.start, width, theme);
    case 'diff': {
      const source = code(body.rows.map(row => row.text).join('\n'), body.path);
      const digits = Math.max(
        1,
        ...body.rows.map(
          row => String(row.oldLine ?? row.newLine ?? '').length,
        ),
      );
      const gutter = digits * 2 + 6;
      return body.rows.flatMap((row, index) =>
        wrapTextWithAnsi(
          source[index] ?? row.text,
          Math.max(1, width - gutter),
        ).map((part, wrapped) => {
          const old = String(wrapped ? '' : (row.oldLine ?? '')).padStart(
            digits,
          );
          const next = String(wrapped ? '' : (row.newLine ?? '')).padStart(
            digits,
          );
          const sign =
            row.kind === 'add'
              ? theme.fg('toolDiffAdded', '+')
              : row.kind === 'remove'
                ? theme.fg('toolDiffRemoved', '-')
                : ' ';
          return `${theme.fg('muted', old + ' ' + next)} ${sign}${theme.fg('dim', ' │ ')}${part}`;
        }),
      );
    }
  }
}
function toolRows(
  tool: Tool,
  state: Expansion,
  theme: Theme,
  width: number,
): string[] {
  const color =
    tool.state === 'failed'
      ? 'error'
      : tool.state === 'cancelled'
        ? 'warning'
        : tool.state === 'running'
          ? 'accent'
          : 'success';
  const marker = `${theme.fg(color, '•')} `;
  const title = `${theme.bold(theme.fg('toolTitle', tool.name))}(${theme.fg('text', tool.target)})`;
  const rows = state.open
    ? wrapTextWithAnsi(title, Math.max(1, width - 2)).map(
        (line, i) => (i ? '  ' : marker) + line,
      )
    : [truncateToWidth(marker + title, width)];
  const detail = bodyRows(tool.body, Math.max(1, width - 4), theme);
  const shown = state.open
    ? detail
    : tool.state === 'running'
      ? detail.slice(-2)
      : tool.name === 'Edit' && tool.state === 'done'
        ? bodyRows(
            tool.body.kind === 'diff'
              ? {
                  ...tool.body,
                  rows: tool.body.rows.filter(row => row.kind !== 'context'),
                }
              : tool.body,
            Math.max(1, width - 4),
            theme,
          ).slice(0, 3)
        : [];
  const hidden = detail.length > shown.length;
  const hint =
    hidden || (!state.open && tool.metadata)
      ? theme.fg(
          'dim',
          `${shown.length && hidden ? ` · ${detail.length - shown.length} more lines` : ''} · expand`,
        )
      : state.open && detail.length
        ? theme.fg('dim', ' · collapse')
        : '';
  rows.push(
    ...wrapTextWithAnsi(
      theme.fg(tool.state === 'failed' ? 'error' : 'muted', tool.summary) +
        hint,
      Math.max(1, width - 5),
    ).map((line, i) => (i ? '     ' : theme.fg('dim', '  ⎿  ')) + line),
  );
  rows.push(...indent(shown, '    '));
  if (tool.warning)
    rows.push(
      ...indent(
        wrapTextWithAnsi(
          theme.fg('warning', tool.warning),
          Math.max(1, width - 4),
        ),
        '    ',
      ),
    );
  if (state.open && tool.metadata)
    rows.push(
      ...indent(
        wrapTextWithAnsi(
          theme.fg('dim', tool.metadata),
          Math.max(1, width - 4),
        ),
        '    ',
      ),
    );
  return rows;
}
function explorationSummary(tools: readonly Tool[]): string {
  const reads = tools.filter(t => t.name === 'Read').length;
  const searches = tools.filter(t => t.name === 'Grep').length;
  const finds = tools.filter(t => t.name === 'Find').length;
  const lists = tools.filter(t => t.name === 'Ls').length;
  return [
    reads ? `Read ${reads} file${reads === 1 ? '' : 's'}` : '',
    searches + finds
      ? `${searches + finds} search${searches + finds === 1 ? '' : 'es'}`
      : '',
    lists ? `${lists} director${lists === 1 ? 'y' : 'ies'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
function textRows(
  entry: Exclude<Entry, Tool | {kind: 'explore'; tools: readonly Tool[]}>,
  state: Expansion,
  theme: Theme,
  width: number,
): string[] {
  if (entry.kind === 'status')
    return wrapTextWithAnsi(
      theme.fg(entry.error ? 'error' : 'muted', entry.text),
      width,
    );
  if (entry.kind === 'thoughts') {
    const label = entry.running
      ? `Thinking · ${entry.seconds}s`
      : state.open
        ? 'Thoughts:'
        : `Thoughts for ${entry.seconds}s`;
    const rows = [theme.fg('muted', '• ' + label)];
    if (state.open)
      rows.push(
        ...indent(
          new Markdown(entry.text, 0, 0, getMarkdownTheme(), {
            color: t => theme.fg('thinkingText', t),
            italic: true,
          }).render(Math.max(1, width - 2)),
          '  ',
        ),
      );
    return rows;
  }
  const marker = theme.fg('accent', '• ');
  const lines = new Markdown(entry.text, 0, 0, getMarkdownTheme()).render(
    Math.max(1, width - visibleWidth(marker)),
  );
  return lines.map((line, i) => (i ? '  ' : marker) + line);
}
export function entryComponent(
  entry: Entry,
  state: Expansion,
  theme: Theme,
  repaint: () => void,
): Component {
  if (entry.kind === 'user') return new UserMessageComponent(entry.text);
  if (entry.kind === 'explore') {
    const container = new Container();
    return {
      render(width) {
        container.clear();
        container.addChild(
          new MouseRegion(
            {
              render: w => [
                theme.fg('success', '• ') + theme.bold('Explored'),
                ...wrapTextWithAnsi(
                  theme.fg('muted', explorationSummary(entry.tools)) +
                    theme.fg('dim', state.open ? ' · collapse' : ' · expand'),
                  Math.max(1, w - 5),
                ).map(
                  (line, i) => (i ? '     ' : theme.fg('dim', '  ⎿  ')) + line,
                ),
              ],
              invalidate() {},
            },
            event => {
              if (event.type !== 'click' || event.button !== 'left') return;
              state.open = !state.open;
              repaint();
              return {handled: true};
            },
          ),
        );
        if (state.open)
          entry.tools.forEach((tool, i) => {
            const child = state.children[i];
            if (!child) throw new Error('Missing exploration expansion state');
            container.addChild(new Spacer(1));
            const inset = new Box(2, 0);
            inset.addChild(entryComponent(tool, child, theme, repaint));
            container.addChild(inset);
          });
        return container.render(width);
      },
      invalidate() {
        container.invalidate();
      },
      handleMouse: event => container.handleMouse(event),
    };
  }
  const component: Component = {
    render: width =>
      entry.kind === 'tool'
        ? toolRows(entry, state, theme, width)
        : textRows(entry, state, theme, width),
    invalidate() {},
  };
  if (entry.kind !== 'tool' && entry.kind !== 'thoughts') return component;
  return new MouseRegion(component, event => {
    if (event.type !== 'click' || event.button !== 'left') return;
    state.open = !state.open;
    repaint();
    return {handled: true};
  });
}
