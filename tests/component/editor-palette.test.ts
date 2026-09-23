import {expect, test} from 'bun:test';
import {keywordMatches} from '../../src/editor/matches';
import {retroColors} from '../../src/editor/retro';

test('viewport palette keeps full-match Unicode phase without offscreen entries', () => {
  const text = 'a😀中文b'.repeat(1000);
  const matches = [{start: 0, end: text.length}];
  const full = retroColors(text, matches);
  const start = 3000;
  const end = 3060;
  const visible = retroColors(text, matches, start, end);
  expect([...visible]).toEqual(
    [...full].filter(([offset]) => offset >= start && offset < end),
  );
});

test('skill ranges take priority even over a longer enclosing keyword', () => {
  const text = 'abc /skill:review tail tail';
  const patterns = [/abc.*tail/gu, /tail/gu, /ta/gu, /^/gu];
  expect(keywordMatches(text, patterns)).toEqual([
    {start: 4, end: 17},
    {start: 18, end: 22},
    {start: 23, end: 27},
  ]);
});
