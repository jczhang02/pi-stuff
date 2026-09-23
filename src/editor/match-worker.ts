import {parentPort} from 'node:worker_threads';
import type {EditorSettings} from './settings';
import {keywordMatches} from './matches';

// This private channel receives only the owning EditorMatcher's typed request.
// Keep the worker dependency-free: compiled Pi does not inherit extension
// package resolution inside worker threads.
parentPort?.on(
  'message',
  (request: {
    text: string;
    keywords: NonNullable<EditorSettings['keywords']>;
  }) => {
    parentPort?.postMessage({
      text: request.text,
      matches: keywordMatches(request.text, request.keywords),
    });
  },
);
