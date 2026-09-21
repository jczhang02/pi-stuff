// Presentation-only renderer for the conversation prototype.
import {
  UserMessageComponent,
  AssistantMessageComponent,
  getMarkdownTheme,
  highlightCode,
  getLanguageFromPath,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
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

export type Expansion = {
  open: boolean;
  children: Expansion[];
  thinking?: boolean;
};
export function expansionFor(entry: Entry): Expansion {
  return {
    open: false,
    thinking: entry.kind === 'thoughts',
    children: entry.kind === 'explore' ? entry.tools.map(expansionFor) : [],
  };
}
export function expandAll(state: Expansion, open: boolean): void {
  if (state.thinking) return;
  state.open = open;
  state.children.forEach(child => expandAll(child, open));
}
function indent(lines: readonly string[], prefix: string): string[] {
  return lines.map(line => prefix + line);
}
function code(text: string, path: string): string[] {
  const lines = highlightCode(text, getLanguageFromPath(path));
  // Pi preserves token color across literal newlines; restore it before adding gutters.
  return wrapTextWithAnsi(
    lines.join('\n'),
    Math.max(1, ...lines.map(visibleWidth)),
  );
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
function bodyRows(
  body: ToolBody,
  width: number,
  theme: Theme,
  changesOnly = false,
): string[] {
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
      // Highlight old and new code independently; adjacent +/- rows are not one source file.
      const oldCode = code(
        body.rows
          .filter(row => row.kind !== 'add')
          .map(row => row.text)
          .join('\n'),
        body.path,
      );
      const newCode = code(
        body.rows
          .filter(row => row.kind !== 'remove')
          .map(row => row.text)
          .join('\n'),
        body.path,
      );
      let oldIndex = 0;
      let newIndex = 0;
      const digits = Math.max(
        1,
        ...body.rows.map(
          row => String(row.oldLine ?? row.newLine ?? '').length,
        ),
      );
      return body.rows.flatMap(row => {
        const source =
          row.kind === 'remove' ? oldCode[oldIndex] : newCode[newIndex];
        if (row.kind !== 'add') oldIndex++;
        if (row.kind !== 'remove') newIndex++;
        if (changesOnly && row.kind === 'context') return [];
        const color =
          row.kind === 'add'
            ? 'toolDiffAdded'
            : row.kind === 'remove'
              ? 'toolDiffRemoved'
              : 'toolDiffContext';
        return wrapTextWithAnsi(
          source ?? row.text,
          Math.max(1, width - digits - 4),
        ).map((part, wrapped) => {
          const number = wrapped
            ? ''
            : String(
                row.kind === 'remove'
                  ? (row.oldLine ?? '')
                  : (row.newLine ?? ''),
              );
          const sign = wrapped
            ? ' '
            : row.kind === 'add'
              ? '+'
              : row.kind === 'remove'
                ? '-'
                : ' ';
          const line =
            theme.fg(color, `${number.padStart(digits)} ${sign} `) + part;
          const padded =
            line + ' '.repeat(Math.max(0, width - visibleWidth(line)));
          return row.kind === 'context'
            ? padded
            : theme.bg(
                row.kind === 'add' ? 'toolSuccessBg' : 'toolErrorBg',
                padded,
              );
        });
      });
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
      : tool.name === 'Bash'
        ? detail.slice(0, 3)
        : tool.name === 'Edit' && tool.state === 'done'
          ? bodyRows(tool.body, Math.max(1, width - 4), theme, true).slice(0, 6)
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
  const searches = tools.filter(
    t => t.name === 'Grep' || t.name === 'Find',
  ).length;
  const lists = tools.filter(t => t.name === 'Ls').length;
  const webSearches = tools.filter(t => t.name === 'WebSearch').length;
  const pages = tools.filter(
    t => t.name === 'WebFetch' || t.name === 'WebRead',
  ).length;
  return [
    reads ? `Read ${reads} file${reads === 1 ? '' : 's'}` : '',
    searches ? `Searched ${searches} pattern${searches === 1 ? '' : 's'}` : '',
    lists ? `Listed ${lists} director${lists === 1 ? 'y' : 'ies'}` : '',
    webSearches
      ? `Searched web ${webSearches} time${webSearches === 1 ? '' : 's'}`
      : '',
    pages ? `Read web content ${pages} time${pages === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
function textRows(
  entry: Exclude<
    Entry,
    Tool | {kind: 'aborted'} | {kind: 'explore'; tools: readonly Tool[]}
  >,
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
    const open = state.open;
    const label = entry.running
      ? `Thinking · ${entry.seconds}s`
      : open
        ? 'Thoughts:'
        : `Thoughts for ${entry.seconds}s`;
    const available = Math.max(1, width - 2);
    if (!open)
      return wrapTextWithAnsi(theme.fg('muted', label), available).map(
        (line, i) => (i ? '  ' : theme.fg('muted', '• ')) + line,
      );
    // Reserve the inline label without changing Markdown source or block syntax.
    const rows = new Markdown(entry.text, 0, 0, getMarkdownTheme(), {
      color: t => theme.fg('thinkingText', t),
    }).render(Math.max(1, available - visibleWidth(label) - 1));
    rows[0] = theme.fg('muted', label + ' ') + (rows[0] ?? '');
    if (!entry.running) {
      const last = rows.length - 1;
      rows[last] =
        (rows[last] ?? '').trimEnd() + theme.fg('muted', `  ${entry.seconds}s`);
    }
    return rows
      .flatMap(line => wrapTextWithAnsi(line, available))
      .map((line, i) => (i ? '  ' : theme.fg('muted', '• ')) + line);
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
  if (entry.kind === 'aborted') {
    const native = new AssistantMessageComponent({
      role: 'assistant',
      content: [],
      api: 'openai-completions',
      provider: 'preview',
      model: 'preview',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
      },
      stopReason: 'aborted',
      timestamp: 0,
    });
    // The surrounding custom message or live row already supplies the native blank line.
    return {
      render(width) {
        const [spacer = '', ...rows] = native.render(width);
        rows[0] = spacer.trimEnd() + (rows[0] ?? '');
        return rows;
      },
      invalidate: () => native.invalidate(),
    };
  }
  if (entry.kind === 'explore') {
    const container = new Container();
    return {
      render(width) {
        container.clear();
        container.addChild(
          new MouseRegion(
            {
              render: w =>
                wrapTextWithAnsi(
                  theme.fg('muted', explorationSummary(entry.tools)) +
                    theme.fg('dim', state.open ? ' · collapse' : ' · expand'),
                  Math.max(1, w - 2),
                ).map(
                  (line, i) => (i ? '  ' : theme.fg('success', '• ')) + line,
                ),
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
            container.addChild(entryComponent(tool, child, theme, repaint));
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
