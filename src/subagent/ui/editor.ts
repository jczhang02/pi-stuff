import {type Theme} from '@earendil-works/pi-coding-agent';
import {
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  type EditorComponent,
} from '@earendil-works/pi-tui';
import {singleLine} from './rows';

export interface EditorIdentity {
  name: string;
  task: string;
}

// Wrap the public renderer so an existing editor keeps its bindings and state.
// prompt-editor.ts inspired the border-label interaction; no source is copied.
export function decorateEditor(
  editor: EditorComponent,
  identity: () => EditorIdentity | undefined,
  theme: () => Theme,
): void {
  const render = editor.render.bind(editor);
  editor.render = width => {
    const lines = render(width);
    const target = identity();
    if (!target || width < 16) return lines;
    const activeTheme = theme();
    const border = lines[0] ?? '';
    const trailing =
      stripTerminalSequences(border).match(/─+$/)?.[0].length ?? 0;
    const identityLabel = [target.name, target.task]
      .filter(Boolean)
      .join(' · ');
    const label = truncateToWidth(
      singleLine(identityLabel),
      Math.max(0, Math.min(Math.floor(width / 2), 64, trailing - 4)),
      '…',
    );
    if (label && trailing > visibleWidth(label) + 4) {
      const remaining = Math.max(0, width - visibleWidth(label) - 3);
      const trailingBorder =
        editor.borderColor?.('─') ?? truncateToWidth(border, 1, '');
      lines[0] =
        truncateToWidth(border, remaining, '') +
        activeTheme.bg(
          'selectedBg',
          activeTheme.bold(activeTheme.fg('accent', ` ${label} `)),
        ) +
        trailingBorder;
    }
    return lines;
  };
}
