import {CustomEditor} from '@earendil-works/pi-coding-agent';
import {Editor} from '@earendil-works/pi-tui';
import {Option, Schema} from 'effect';
import {EditorMatcher} from './matcher';
import {paintRow, retroColors} from './retro';
const VisualLine = Schema.Struct({
  logicalLine: Schema.Number,
  startCol: Schema.Number,
  length: Schema.Number,
});
type LineMap = (width: number) => readonly (typeof VisualLine.Type)[];
const Layout = Schema.Struct({
  scrollOffset: Schema.Number,
  lastWidth: Schema.Number,
  renderedVisibleLineCount: Schema.Number,
});

export function decorateEditor(
  editor: CustomEditor,
  matcher: EditorMatcher,
  enabled: () => boolean,
) {
  const map = Schema.decodeUnknownSync(
    Schema.Struct({
      buildVisualLineMap: Schema.declare<LineMap>(
        (value): value is LineMap => value instanceof Function,
      ),
    }),
  )(Editor.prototype);
  const render = editor.render.bind(editor);
  editor.render = width => {
    const rows = render(width);
    if (!enabled()) return rows;
    const layout = Schema.decodeUnknownOption(Layout)(editor);
    if (Option.isNone(layout)) return rows;
    const text = editor.getText();
    const matches = matcher.matches(text);
    if (!matches.length) return rows;
    const offsets: number[] = [];
    let total = 0;
    for (const line of editor.getLines()) {
      offsets.push(total);
      total += line.length + 1;
    }
    const state = layout.value;
    const lines = map.buildVisualLineMap.call(editor, state.lastWidth);
    const first = lines[state.scrollOffset];
    const last = lines[state.scrollOffset + state.renderedVisibleLineCount - 1];
    if (!first || !last) return rows;
    const palette = retroColors(
      text,
      matches,
      (offsets[first.logicalLine] ?? 0) + first.startCol,
      (offsets[last.logicalLine] ?? 0) + last.startCol + last.length,
    );
    const padding = Math.min(
      editor.getPaddingX(),
      Math.max(0, Math.floor((width - 1) / 2)),
    );
    return rows.map((row, index) => {
      if (index < 1 || index > state.renderedVisibleLineCount) return row;
      const line = lines[state.scrollOffset + index - 1];
      return line
        ? paintRow(
            row,
            (offsets[line.logicalLine] ?? 0) + line.startCol,
            line.length,
            padding,
            palette,
          )
        : row;
    });
  };
}
