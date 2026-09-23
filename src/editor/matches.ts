import type {Match} from './settings';

export function skillMatches(text: string): Match[] {
  return Array.from(
    text.matchAll(/\/skill:[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*/gu),
    match => ({start: match.index, end: match.index + match[0].length}),
  );
}

export function keywordMatches(
  text: string,
  patterns: readonly RegExp[],
): Match[] {
  const candidates: Match[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[0].length)
        candidates.push({
          start: match.index,
          end: match.index + match[0].length,
        });
    }
  }
  const skills = skillMatches(text);
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  let skillIndex = 0;
  const matches = candidates.filter(candidate => {
    while ((skills[skillIndex]?.end ?? Infinity) <= candidate.start)
      skillIndex++;
    const skill = skills[skillIndex];
    return !skill || skill.start >= candidate.end;
  });
  matches.push(...skills);
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const result: Match[] = [];
  for (const match of matches) {
    if (match.start >= (result.at(-1)?.end ?? 0)) result.push(match);
  }
  return result;
}
