// Python's whitespace includes U+001F and U+0085, but not JavaScript's U+FEFF.
// Preserve that distinction alongside splitlines boundaries in the migrated parsers.
export const WHITESPACE = String.raw`\t-\r\x1c-\x20\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000`;
export const FENCE = new RegExp(`^[${WHITESPACE}]{0,3}(\u0060{3,}|~{3,})(.*)$`);
const LEADING_SPACE = new RegExp(`^[${WHITESPACE}]+`);
const TRAILING_SPACE = new RegExp(`[${WHITESPACE}]+$`);

export function trimEndWhitespace(text: string): string {
  return text.replace(TRAILING_SPACE, "");
}

export function trimWhitespace(text: string): string {
  return trimEndWhitespace(text.replace(LEADING_SPACE, ""));
}

export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\u0085\u2028\u2029]/u);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
