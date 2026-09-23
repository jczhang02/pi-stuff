import {KeybindingsManager} from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js';
import {TuiAltScreen as TUI} from '@earendil-works/pi-tui';
import {expect, test} from 'bun:test';
import {CustomEditor} from '@earendil-works/pi-coding-agent';
import {stripTerminalSequences, type Terminal} from '@earendil-works/pi-tui';
import {decorateEditor} from '../../src/editor/decorate';
import {EditorMatcher} from '../../src/editor/matcher';

// Real editor and layout; only the terminal I/O boundary is inert.
const terminal: Terminal = {
  columns: 120,
  rows: 40,
  kittyProtocolActive: false,
  start() {},
  stop() {},
  async drainInput() {},
  write() {},
  moveBy() {},
  hideCursor() {},
  showCursor() {},
  clearLine() {},
  clearFromCursor() {},
  clearScreen() {},
  setTitle() {},
  setProgress() {},
};
const identity = (text: string) => text;
const theme = {
  borderColor: identity,
  selectList: {
    selectedPrefix: identity,
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
  },
};

test('retro color phase survives native wrapping and cursor movement without changing draft', () => {
  const tui = new TUI(terminal);
  const editor = new CustomEditor(tui, theme, new KeybindingsManager());
  const matcher = new EditorMatcher({}, () => {});
  const text = '前缀 /skill:abcdefghijklmnopqrst 后缀';
  editor.setText(text);
  decorateEditor(editor, matcher, () => true);
  const tokens = (rows: string[]) =>
    Array.from(
      rows
        .join('')
        .matchAll(new RegExp(String.raw`\x1b\[1;38;2;[0-9;]+m.`, 'gu')),
      match => match[0],
    );
  const wide = editor.render(100);
  const narrow = editor.render(18);
  expect(tokens(narrow)).toEqual(tokens(wide));
  expect(tokens(wide)).toHaveLength('/skill:abcdefghijklmnopqrst'.length);
  expect(editor.getText()).toBe(text);
  expect(narrow.map(stripTerminalSequences).join('\n')).toContain('前缀');
  editor.handleInput('\x01');
  editor.handleInput('X');
  expect(editor.getText()).toBe('X' + text);
  matcher.close();
  tui.stop();
});

test('keyword regex overlap selects longest match and skill color remains whole', async () => {
  let redraw = () => {};
  const ready = new Promise<void>(resolve => {
    redraw = resolve;
  });
  const matcher = new EditorMatcher(
    {
      keywords: [
        {pattern: 'rev'},
        {pattern: 'review'},
        {pattern: 'FIX', caseSensitive: true},
        {pattern: '^'},
        {pattern: '['},
      ],
    },
    () => redraw(),
  );
  const tui = new TUI(terminal);
  const editor = new CustomEditor(tui, theme, new KeybindingsManager());
  const text = 'Review preview fix FIX /skill:review';
  editor.setText(text);
  decorateEditor(editor, matcher, () => true);
  editor.render(100);
  await Promise.race([
    ready,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('matcher deadline')), 3000),
    ),
  ]);
  const output = editor.render(100).join('\n');
  // Accepted literal palette endpoints: every whole match starts and ends blue.
  expect(output).toContain('\x1b[1;38;2;63;81;177mR');
  expect(output).toContain('\x1b[1;38;2;63;81;177mw');
  expect(output).toContain(' fix ');
  expect(output).toContain('\x1b[1;38;2;63;81;177mF');
  expect(matcher.invalid).toEqual([5]);
  expect(editor.getText()).toBe(text);
  matcher.close();
  tui.stop();
});
