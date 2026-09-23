import {expect, test} from 'bun:test';
import {initTheme, getMarkdownTheme} from '@earendil-works/pi-coding-agent';
import {stripTerminalSequences} from '@earendil-works/pi-tui';
import {SkillMessageCard} from '../../src/skill-message/card';

initTheme('dark');
test('one card retains prompt once and expands instructions after it', () => {
  const card = new SkillMessageCard(
    {
      name: 'review',
      location: '/fixture/SKILL.md',
      content: 'Inspect every change.',
      userMessage: 'Check this file.',
    },
    getMarkdownTheme(),
    1,
    [],
  );
  const collapsed = card.render(60).map(stripTerminalSequences).join('\n');
  expect(collapsed).toContain('/skill:review Check this file.');
  expect(collapsed).not.toContain('Inspect every change.');
  card.setExpanded(true);
  const expanded = card.render(60).map(stripTerminalSequences).join('\n');
  expect(expanded.match(/Check this file\./g)).toHaveLength(1);
  expect(expanded).toContain('Skill instructions');
  expect(expanded.indexOf('Inspect every change.')).toBeGreaterThan(
    expanded.indexOf('Check this file.'),
  );
});

for (const prompt of [
  '- first\n- second',
  '> quotation',
  '```ts\nconst n = 1;\n```',
]) {
  test(`skill label preserves leading block: ${prompt.split('\n')[0]}`, () => {
    const card = new SkillMessageCard(
      {
        name: 'review',
        location: '/fixture/SKILL.md',
        content: 'Instructions',
        userMessage: prompt,
      },
      getMarkdownTheme(),
      1,
      [],
    );
    const rows = card
      .render(40)
      .map(stripTerminalSequences)
      .filter(row => row.trim());
    expect(rows[0]?.trim()).toBe('/skill:review');
    expect(rows.length).toBeGreaterThan(1);
  });
}

test('skill-only card and narrow resize keep label and instruction access', () => {
  const card = new SkillMessageCard(
    {
      name: 'review',
      location: '/fixture/SKILL.md',
      content: 'Inspect carefully.',
      userMessage: undefined,
    },
    getMarkdownTheme(),
    1,
    [],
  );
  expect(card.render(40).map(stripTerminalSequences).join('\n')).toContain(
    '/skill:review',
  );
  card.setExpanded(true);
  expect(card.render(30).map(stripTerminalSequences).join('\n')).toContain(
    'Inspect carefully.',
  );
  card.setOutputPad(2);
  card.setExpanded(false);
  expect(card.render(40).map(stripTerminalSequences).join('\n')).not.toContain(
    'Inspect carefully.',
  );
});
