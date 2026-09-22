import type {createWebTools} from '../web/tools';
import {displayRetrieval} from './retrieval';

// Interpret only the headers emitted by Web access; source text is never
// rewritten or fed back into execution. Batch errors otherwise look successful
// to Pi because a batch can contain both successful and failed items.
function webNotices(output: string): string[] {
  const notices: string[] = [];
  for (const block of output.split('\n\n')) {
    const error = /^item: \d+\n(error: [^\n]+)$/u.exec(block);
    if (error?.[1]) notices.push(error[1]);
    if (
      /^(?:item: \d+\n)?contentId: [^\n]+\noffset: \d+\nnextOffset: \d+\ntotalLength: \d+\ntruncated: true$/u.test(
        block,
      )
    )
      notices.push('More content retained; use WebRead to page through it');
  }
  return notices;
}

export function displayWebTools(
  tools: ReturnType<typeof createWebTools>,
): void {
  displayRetrieval(
    tools.webSearch,
    'WebSearch',
    (args, expanded) =>
      expanded
        ? (args.queries?.join('; ') ?? '')
        : `${args.queries?.length ?? 0} ${args.queries?.length === 1 ? 'query' : 'queries'}`,
    webNotices,
  );
  displayRetrieval(
    tools.fetchContent,
    'WebFetch',
    (args, expanded) =>
      expanded
        ? (args.urls?.join('; ') ?? '')
        : `${args.urls?.length ?? 0} ${args.urls?.length === 1 ? 'page' : 'pages'}`,
    webNotices,
  );
  displayRetrieval(
    tools.getSearchContent,
    'WebRead',
    (args, expanded) =>
      expanded
        ? `${args.contentId ?? ''}${args.find === undefined ? `, offset ${args.offset ?? 0}${args.limit === undefined ? '' : `, limit ${args.limit}`}` : `, find ${args.find}`}`
        : 'retained content',
    webNotices,
  );
}
