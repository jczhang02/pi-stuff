import type {Match} from './settings';

// Static pi-footer title palette, 1b83749f. Matches the accepted old
// pi-stuff e61ed27e palette, with the final character returning to blue.
const colors = [
  [63, 81, 177],
  [90, 85, 174],
  [123, 95, 172],
  [143, 106, 174],
  [168, 106, 164],
  [204, 107, 142],
  [241, 130, 113],
  [243, 164, 105],
  [247, 201, 120],
];
export function retroColors(
  text: string,
  matches: readonly Match[],
  start = 0,
  end = text.length,
): Map<number, string> {
  const result = new Map<number, string>();
  for (const match of matches) {
    if (match.start >= end) break;
    if (match.end <= start) continue;
    const value = text.slice(match.start, match.end);
    let count = 0;
    for (let cursor = 0; cursor < value.length; count++) {
      cursor += (value.codePointAt(cursor) ?? 0) > 0xffff ? 2 : 1;
    }
    let offset = match.start;
    let index = 0;
    for (const character of value) {
      if (offset >= end) break;
      if (offset < start) {
        offset += character.length;
        index++;
        continue;
      }
      const position = (index / Math.max(1, count - 1)) * colors.length;
      const stop = Math.floor(position);
      const left = colors[stop % colors.length] ?? [63, 81, 177];
      const right = colors[(stop + 1) % colors.length] ?? left;
      const rgb = left.map((value, channel) =>
        Math.round(
          value + ((right[channel] ?? value) - value) * (position - stop),
        ),
      );
      result.set(offset, `\x1b[1;38;2;${rgb.join(';')}m`);
      offset += character.length;
      index++;
    }
  }
  return result;
}

// Native editor rows contain SGR and the zero-width APC cursor marker.
// Preserve those bytes, including reverse-video cursor state, while adding
// foreground/bold only to characters mapped to draft text.
export function paintRow(
  row: string,
  offset: number,
  length: number,
  padding: number,
  palette: ReadonlyMap<number, string>,
): string {
  let plain = -padding;
  let output = '';
  let restore = '';
  for (let index = 0; index < row.length;) {
    if (row.charCodeAt(index) === 27) {
      let end = index + 2;
      const introducer = row[index + 1];
      if (introducer === '[') {
        while (end < row.length) {
          const code = row.charCodeAt(end++);
          if (code >= 64 && code <= 126) break;
        }
      } else if (introducer && ']P_X^'.includes(introducer)) {
        while (end < row.length) {
          if (row.charCodeAt(end++) === 7) break;
          if (row.charCodeAt(end - 1) === 27 && row[end] === '\\') {
            end++;
            break;
          }
        }
      }
      const control = row.slice(index, end);
      // Replaying native SGR restores foreground and intensity without removing
      // underline, background or reverse-video. Reset bounds the retained state.
      if (introducer === '[' && control.endsWith('m')) {
        if (control === '\x1b[0m' || control === '\x1b[m') restore = '';
        else restore += control;
      }
      output += control;
      index = end;
      continue;
    }
    const character = String.fromCodePoint(row.codePointAt(index) ?? 0);
    const color =
      plain >= 0 && plain < length ? palette.get(offset + plain) : undefined;
    output += color ? `${color}${character}\x1b[22;39m${restore}` : character;
    plain += character.length;
    index += character.length;
  }
  return output;
}
