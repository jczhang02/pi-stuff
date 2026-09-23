import {Schema} from 'effect';
import type {ToolView} from './tool-lookup';
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

function searchParts(body: string, query: string): RetrievalPart[] {
  const prefix = `query: ${query}\n`;
  if (!body.startsWith(prefix)) return unparsed(body);
  const header =
    /^provider: (?:exa|openai)\nselection: (?:domain filters|preferred|available provider)\nfallback: (?:true|false)\n\n/u.exec(
      body.slice(prefix.length),
    );
  if (!header) return unparsed(body);
  const start = prefix.length + header[0].length;
  const content = body.slice(start);
  return [
    {kind: 'metadata', text: body.slice(0, start - 2)},
    content
      ? {kind: 'body', text: content}
      : {kind: 'status', text: 'No results found'},
  ];
}

function pages(
  output: string,
  batchSize?: number,
  queries?: readonly string[],
): RetrievalPart[] {
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
    const query = queries?.[item];
    if (query !== undefined) parts.push(...searchParts(body, query));
    else
      parts.push(
        body
          ? {kind: 'body', text: body}
          : {
              kind: 'status',
              text: total === 0 ? 'No content' : 'End of content',
            },
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

const WebArgs = Schema.Struct({
  queries: Schema.optional(Schema.Array(Schema.String)),
  urls: Schema.optional(Schema.Array(Schema.String)),
  contentId: Schema.optional(Schema.String),
  find: Schema.optional(Schema.String),
  offset: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
});

// A view has no executable definition. History can use it before registration
// or while a tool is disabled, without exposing a callable tool to the model.
export function webView(
  name: string,
  groups?: RetrievalGroups,
): ToolView | undefined {
  const label =
    name === 'web_search'
      ? 'WebSearch'
      : name === 'fetch_content'
        ? 'WebFetch'
        : name === 'get_search_content'
          ? 'WebRead'
          : undefined;
  if (!label) return;
  return displayRetrieval(
    {name},
    label,
    (input, expanded) => {
      const args = Schema.decodeUnknownSync(WebArgs)(input);
      if (name === 'get_search_content')
        return expanded
          ? `${args.contentId ?? ''}${args.find === undefined ? `, offset ${args.offset ?? 0}${args.limit === undefined ? '' : `, limit ${args.limit}`}` : `, find ${args.find}`}`
          : 'retained content';
      const targets = (name === 'web_search' ? args.queries : args.urls) ?? [];
      const noun =
        name === 'web_search'
          ? targets.length === 1
            ? 'query'
            : 'queries'
          : targets.length === 1
            ? 'page'
            : 'pages';
      return expanded ? targets.join('; ') : `${targets.length} ${noun}`;
    },
    (output, _details, input) => {
      const args = Schema.decodeUnknownSync(WebArgs)(input);
      if (name === 'get_search_content')
        return args.find === undefined
          ? pages(output)
          : matches(output, args.find);
      const targets = name === 'web_search' ? args.queries : args.urls;
      if (!targets) return unparsed(output);
      return pages(
        output,
        targets.length,
        name === 'web_search' ? targets : undefined,
      );
    },
    groups,
  );
}

export function displayWebTools(
  tools: ReturnType<typeof createWebTools>,
  groups?: RetrievalGroups,
): void {
  for (const tool of [
    tools.webSearch,
    tools.fetchContent,
    tools.getSearchContent,
  ])
    Object.assign(tool, webView(tool.name, groups));
}
