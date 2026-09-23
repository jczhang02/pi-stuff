import {expect, test} from 'bun:test';
import {prepareFencedVisualizations} from '../../src/visualizations/fenced-visualization';
import {visibleWidth, stripTerminalSequences} from '@earendil-works/pi-tui';
import {
  UserMessageComponent,
  initTheme,
  getMarkdownTheme,
} from '@earendil-works/pi-coding-agent';
import {registerVisualizations} from '../../src/visualizations/register';
function projectVisualizations(text: string, width: number) {
  return prepareFencedVisualizations(text, Math.max(0, width - 2), visibleWidth)
    .markdown;
}

test('complete tree fence displays its hierarchy without changing surrounding prose', () => {
  const source = 'Before\n\n```tree\nproject\n  src\n  tests\n```\n\nAfter';
  const rendered = projectVisualizations(source, 60);
  expect(rendered).toContain('├── src');
  expect(rendered).toContain('└── tests');
  expect(rendered).toContain('Before');
  expect(rendered).toContain('After');
});

test('incomplete, nested, unsafe and narrow fences retain their exact source', () => {
  for (const source of [
    '```tree\nroot\n  child',
    '```text\n```tree\nroot\n  child\n```\n```',
    '```tree\nroot\n  \x1b[31mchild\n```',
    '```tree\nroot\n    jump\n```',
    '```tree\nroot\nother\n```',
    '```tree\nroot\n\tchild\n```',
  ])
    expect(projectVisualizations(source, 60)).toBe(source);
  const wide = '```tree\nroot\n  very-long-label\n```';
  expect(projectVisualizations(wide, 10)).toBe(wide);
});

test('all chart types project; malformed and oversized charts retain source', () => {
  for (const type of [
    'bar',
    'histogram',
    'line',
    'scatter',
    'sparkline',
    'heatmap',
  ]) {
    const source = `\`\`\`chart\ntype: ${type}\ntitle: Example\nA, 1\nB, 4\n\`\`\``;
    expect(projectVisualizations(source, 60)).not.toBe(source);
    expect(projectVisualizations(source, 20)).toBe(source);
  }
  for (const body of [
    'A nope',
    'type: unknown\nA 1',
    'A 1e309',
    Array.from({length: 65}, (_, i) => `A ${i}`).join('\n'),
  ]) {
    const source = `\`\`\`chart\n${body}\n\`\`\``;
    expect(projectVisualizations(source, 80)).toBe(source);
  }
});

// Native host API boundary; real Markdown parsing/rendering and product adapter.
const transform = registerVisualizations({
  registerMarkdownTransformer() {},
  on() {
    return () => {};
  },
});
initTheme('dark');
for (const width of [10, 16, 24, 60]) {
  test(`native visualization rows fit ${width} columns and retain roots`, () => {
    for (const source of [
      '```tree\nr $&\n  a\n```',
      '```tree\n' + 'x'.repeat(50) + '\n  a\n```',
      '```chart\nA 1\nB 4\n```',
    ]) {
      const card = new UserMessageComponent(source, getMarkdownTheme(), 1, [
        transform,
      ]);
      const rows = card.render(width);
      expect(rows.every(row => visibleWidth(row) <= width)).toBe(true);
      expect(rows.map(stripTerminalSequences).join('')).not.toContain(
        'pi-stuff-visualization',
      );
      if (source.includes('r $&'))
        expect(rows.map(stripTerminalSequences).join('')).toContain('r $&');
    }
  });
}
