import {parentPort} from 'node:worker_threads';
import type {EditorSettings} from './settings';
import {keywordMatches} from './matches';

// Only the owning matcher sends this ordered initialization/request protocol.
// No package imports: compiled Pi does not share its extension loader here.
let patterns: readonly RegExp[] = [];
parentPort?.on(
  'message',
  (
    request:
      | {keywords: NonNullable<EditorSettings['keywords']>}
      | {text: string},
  ) => {
    if ('keywords' in request) {
      patterns = request.keywords.map(
        rule => new RegExp(rule.pattern, rule.caseSensitive ? 'gu' : 'giu'),
      );
    } else {
      parentPort?.postMessage({
        text: request.text,
        matches: keywordMatches(request.text, patterns),
      });
    }
  },
);
