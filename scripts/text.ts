// Keep Python splitlines boundaries in the migrated Markdown/evidence parsers.
export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\u0085\u2028\u2029]/u);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
