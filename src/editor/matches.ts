import type {EditorSettings, Match} from './settings';

export function skillMatches(text: string): Match[] {
  return Array.from(
    text.matchAll(/\/skill:[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*/gu),
    match => ({start: match.index, end: match.index + match[0].length}),
  );
}

export function keywordMatches(
  text: string,
  keywords: NonNullable<EditorSettings['keywords']>,
): Match[] {
  const candidates: Match[] = [];
  for (const rule of keywords) {
    const pattern = new RegExp(rule.pattern, rule.caseSensitive ? 'gu' : 'giu');
    for (const match of text.matchAll(pattern)) {
      if (match[0].length)
        candidates.push({
          start: match.index,
          end: match.index + match[0].length,
        });
    }
  }
  const skills = skillMatches(text);
  const matches = candidates.filter(
    candidate =>
      !skills.some(
        skill => candidate.start < skill.end && candidate.end > skill.start,
      ),
  );
  matches.push(...skills);
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const result: Match[] = [];
  for (const match of matches) {
    if (match.start >= (result.at(-1)?.end ?? 0)) result.push(match);
  }
  return result;
}
