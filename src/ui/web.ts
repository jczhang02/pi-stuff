import type {RetrievalGroups} from './groups';
import type {createWebTools} from '../web/tools';
import {displayRetrieval, type RetrievalPart} from './retrieval';

// Web access emits UTF-16 ranges around retained source text. Walk those ranges
// before stripping terminal controls; splitting on blank lines would interpret
// source text as tool metadata. If an earlier result hook changed a boundary,
// show the complete result outside groups rather than guessing a hidden count.
function unparsed(output: string): RetrievalPart[] {
  return [{kind: 'status', text: output || '(no output)'}];
}

function pages(output: string, batchSize?: number): RetrievalPart[] {
  const parts: RetrievalPart[] = [];
  let cursor = 0;
  const count = batchSize ?? 1;
  for (let item = 0; item < count; item++) {
    const prefix = batchSize === undefined ? '' : `item: ${item}\n`;
    if (!output.startsWith(prefix, cursor)) return unparsed(output);
    const start = cursor;
    cursor += prefix.length;
    if (output.startsWith('error: ', cursor)) {
      const end =
        item === count - 1
          ? output.length
          : output.indexOf(`\n\nitem: ${item + 1}\n`, cursor);
      if (end < 0) return unparsed(output);
      if (prefix) parts.push({kind: 'metadata', text: prefix.slice(0, -1)});
      parts.push({kind: 'warning', text: output.slice(cursor, end)});
      cursor = end + (item === count - 1 ? 0 : 2);
      continue;
    }
    const header =
      /^contentId: [^\n]+\noffset: (\d+)\nnextOffset: (\d+)\ntotalLength: (\d+)\ntruncated: (true|false)\n\n/u.exec(
        output.slice(cursor),
      );
    if (!header) return unparsed(output);
    const offset = Number(header[1]);
    const next = Number(header[2]);
    const total = Number(header[3]);
    if (
      ![offset, next, total].every(Number.isSafeInteger) ||
      next < offset ||
      total < next ||
      (header[4] === 'true') !== next < total
    )
      return unparsed(output);
    cursor += header[0].length;
    const end = item === count - 1 ? output.length : cursor + next - offset;
    if (end - cursor > next - offset || end > output.length)
      return unparsed(output);
    if (
      item < count - 1 &&
      output.indexOf(`\n\nitem: ${item + 1}\n`, cursor) !== end
    )
      return unparsed(output);
    parts.push({kind: 'metadata', text: output.slice(start, cursor - 2)});
    const body = output.slice(cursor, end);
    parts.push(
      body
        ? {kind: 'body', text: body}
        : {kind: 'status', text: total === 0 ? 'No content' : 'End of content'},
    );
    if (next < total)
      parts.push({
        kind: 'warning',
        text: 'More content retained; use WebRead to page through it',
      });
    cursor = end + (item === count - 1 ? 0 : 2);
  }
  return cursor === output.length ? parts : unparsed(output);
}

function matches(output: string, term: string): RetrievalPart[] {
  const header =
    /^contentId: [^\n]+\ntotalLength: (\d+)\nmoreMatches: (true|false)\n\n/u.exec(
      output,
    );
  if (!header) return unparsed(output);
  const total = Number(header[1]);
  if (!Number.isSafeInteger(total)) return unparsed(output);
  const parts: RetrievalPart[] = [
    {kind: 'metadata', text: header[0].slice(0, -2)},
  ];
  let cursor = header[0].length;
  if (cursor === output.length && header[2] === 'false')
    return [...parts, {kind: 'status', text: 'No matches found'}];
  while (cursor < output.length) {
    const position = /^position: (\d+)\n/u.exec(output.slice(cursor));
    if (!position) return unparsed(output);
    const index = Number(position[1]);
    if (!Number.isSafeInteger(index) || index >= total) return unparsed(output);
    parts.push({kind: 'metadata', text: position[0].slice(0, -1)});
    cursor += position[0].length;
    const length =
      Math.min(total, index + term.length + 200) - Math.max(0, index - 200);
    const end = Math.min(output.length, cursor + length);
    const nextPosition = /\n\nposition: \d+\n/u.exec(output.slice(cursor));
    if (nextPosition && cursor + nextPosition.index < end)
      return unparsed(output);
    parts.push({kind: 'body', text: output.slice(cursor, end)});
    if (end < output.length && !output.startsWith('\n\n', end))
      return unparsed(output);
    cursor = end + (end < output.length ? 2 : 0);
  }
  if (header[2] === 'true')
    parts.push({
      kind: 'warning',
      text: 'More matches retained; refine the search',
    });
  return parts;
}

export function displayWebTools(
  tools: ReturnType<typeof createWebTools>,
  groups?: RetrievalGroups,
): void {
  displayRetrieval(
    tools.webSearch,
    'WebSearch',
    (args, expanded) =>
      expanded
        ? (args.queries?.join('; ') ?? '')
        : `${args.queries?.length ?? 0} ${args.queries?.length === 1 ? 'query' : 'queries'}`,
    (output, _details, args) => pages(output, args.queries.length),
    groups,
  );
  displayRetrieval(
    tools.fetchContent,
    'WebFetch',
    (args, expanded) =>
      expanded
        ? (args.urls?.join('; ') ?? '')
        : `${args.urls?.length ?? 0} ${args.urls?.length === 1 ? 'page' : 'pages'}`,
    (output, _details, args) => pages(output, args.urls.length),
    groups,
  );
  displayRetrieval(
    tools.getSearchContent,
    'WebRead',
    (args, expanded) =>
      expanded
        ? `${args.contentId ?? ''}${args.find === undefined ? `, offset ${args.offset ?? 0}${args.limit === undefined ? '' : `, limit ${args.limit}`}` : `, find ${args.find}`}`
        : 'retained content',
    (output, _details, args) =>
      args.find === undefined ? pages(output) : matches(output, args.find),
    groups,
  );
}
