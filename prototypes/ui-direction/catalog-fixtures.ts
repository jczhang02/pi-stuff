// Native Pi 0.85.1 conversation-output catalog fixtures.
// The fixtures are static and are never passed to a provider or an executor.
import type {AssistantMessage} from '@earendil-works/pi-ai';
import type {
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  ParsedSkillBlock,
} from '@earendil-works/pi-coding-agent';
import {
  generateDiffString,
  generateUnifiedPatch,
  truncateTail,
} from '@earendil-works/pi-coding-agent';
import {Content} from '../../src/web/content';

type BranchSummaryMessage = ConstructorParameters<
  typeof BranchSummaryMessageComponent
>[0];
type CompactionSummaryMessage = ConstructorParameters<
  typeof CompactionSummaryMessageComponent
>[0];

export type CatalogScene = {
  readonly name: string;
  readonly title: string;
  readonly expectedToken: string;
  readonly expectedTokens?: readonly string[];
  readonly category: string;
  readonly source: string;
};

export type CatalogContent =
  | {readonly type: 'text'; readonly text: string}
  | {readonly type: 'image'; readonly data: string; readonly mimeType: string};

export type CatalogToolName =
  | 'read'
  | 'write'
  | 'edit'
  | 'bash'
  | 'grep'
  | 'find'
  | 'ls'
  | 'generic';

export type CatalogToolArgs =
  | {readonly path: string; readonly offset?: number; readonly limit?: number}
  | {readonly path: string; readonly content: string}
  | {
      readonly path: string;
      readonly edits: readonly {
        readonly oldText: string;
        readonly newText: string;
      }[];
    }
  | {readonly command: string; readonly timeout?: number}
  | {
      readonly pattern: string;
      readonly path?: string;
      readonly glob?: string;
      readonly limit?: number;
    }
  | {readonly path?: string; readonly limit?: number}
  | {readonly queries: readonly string[]; readonly maxResults?: number}
  | {
      readonly urls: readonly string[];
      readonly mode?: 'readable' | 'raw';
    }
  | {
      readonly contentId: string;
      readonly offset?: number;
      readonly limit?: number;
      readonly find?: string;
    };

export type CatalogToolDetails = {
  readonly diff?: string;
  readonly patch?: string;
  readonly firstChangedLine?: number;
  readonly fullOutputPath?: string;
  readonly matchLimitReached?: number;
  readonly resultLimitReached?: number;
  readonly entryLimitReached?: number;
  readonly linesTruncated?: boolean;
  readonly truncation?: {
    readonly truncated: true;
    readonly truncatedBy?: 'lines' | 'bytes';
    readonly outputLines?: number;
    readonly totalLines?: number;
    readonly maxLines?: number;
    readonly maxBytes?: number;
  };
};

export type CatalogToolFixture = {
  readonly name: string;
  readonly callId: string;
  readonly definition: CatalogToolName;
  readonly args: CatalogToolArgs;
  readonly result?: readonly CatalogContent[];
  readonly details?: CatalogToolDetails;
  readonly isError?: boolean;
  readonly isPartial?: boolean;
  readonly expanded?: boolean;
};

export type CatalogItem =
  | {readonly kind: 'user'; readonly text: string}
  | {
      readonly kind: 'assistant';
      readonly message: AssistantMessage;
      readonly hideThinkingBlock?: boolean;
    }
  | {
      readonly kind: 'custom';
      readonly message: {
        readonly role: 'custom';
        readonly customType: string;
        readonly content: string;
        readonly display: true;
        readonly timestamp: number;
      };
      readonly expanded?: boolean;
    }
  | {readonly kind: 'tool'; readonly tool: CatalogToolFixture}
  | {
      readonly kind: 'bash';
      readonly command: string;
      readonly output: string;
      readonly exitCode: number | undefined;
      readonly cancelled: boolean;
      readonly truncation?: ReturnType<typeof truncateTail>;
      readonly fullOutputPath?: string;
      readonly excludeFromContext?: boolean;
      readonly expanded?: boolean;
    }
  | {
      readonly kind: 'compaction';
      readonly message: CompactionSummaryMessage;
      readonly expanded?: boolean;
    }
  | {
      readonly kind: 'branch';
      readonly message: BranchSummaryMessage;
      readonly expanded?: boolean;
    }
  | {
      readonly kind: 'skill';
      readonly block: ParsedSkillBlock;
      readonly expanded?: boolean;
    }
  | {
      readonly kind: 'notice';
      readonly message: string;
      readonly type: 'info' | 'warning' | 'error';
    }
  | {readonly kind: 'extension-error'; readonly message: string};

const timestamp = 1_758_300_000_000;

const usage = {
  input: 64,
  output: 32,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 96,
  cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
};

function assistant(
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'] = 'stop',
  errorMessage?: string,
): AssistantMessage {
  const message: AssistantMessage = {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'preview',
    model: 'preview',
    usage,
    stopReason,
    timestamp,
  };
  if (errorMessage !== undefined) message.errorMessage = errorMessage;
  return message;
}

const userMarkdown: CatalogItem = {
  kind: 'user',
  text:
    'Review the pagination boundary.\n\n' +
    'Keep the first occurrence of each result and preserve the cursor.\n\n' +
    '```ts\npaginate(page, previousIds)\n```',
};

const assistantMarkdown: CatalogItem = {
  kind: 'assistant',
  message: assistant([
    {
      type: 'text',
      text:
        '# Fix pagination\n\n' +
        'The boundary now keeps the first result and carries `previousIds` forward.\n\n' +
        '- preserve order\n- add a regression test\n\n' +
        '| page | kept |\n| --- | --- |\n| 2 | result-3 |',
    },
    {
      type: 'text',
      text: '\n\n```ts\nreturn paginate(page, previousIds);\n```',
    },
  ]),
};

const thinkingMessage = assistant([
  {
    type: 'thinking',
    thinking:
      'I will compare the incoming page with previousIds before returning results.',
  },
  {
    type: 'text',
    text: 'I found the duplicate at the page boundary.',
  },
]);

const truncatedMessage = assistant(
  [{type: 'text', text: 'The response stopped while checking the next page.'}],
  'length',
);

const readTool: CatalogItem = {
  kind: 'tool',
  tool: {
    name: 'read',
    callId: 'catalog-read-1',
    definition: 'read',
    args: {path: 'src/search/paginate.ts', offset: 18, limit: 8},
    result: [
      {
        type: 'text',
        text: `export function paginate(page, previousIds) {
  const seen = new Set(previousIds);
  const unique = page.items.filter(item => !seen.has(item.id));
  return {items: unique, nextCursor: page.cursor};
}`,
      },
    ],
    expanded: true,
  },
};

const writeTool: CatalogItem = {
  kind: 'tool',
  tool: {
    name: 'write',
    callId: 'catalog-write-1',
    definition: 'write',
    args: {
      path: 'src/search/paginate.test.ts',
      content:
        'test("skips IDs from the previous page", () => {\n  expect(result).toEqual(["result-3"]);\n});',
    },
    result: [
      {type: 'text', text: 'Successfully wrote to src/search/paginate.test.ts'},
    ],
    expanded: true,
  },
};

const editBefore = [
  'export function paginate(page, previousIds) {',
  '  const seen = new Set(previousIds);',
  '  return {items, nextCursor: page.cursor};',
  '}',
].join('\n');
const editAfter = editBefore.replace(
  '  return {items, nextCursor: page.cursor};',
  '  const unique = page.items.filter(item => !seen.has(item.id));\n' +
    '  return {items: unique, nextCursor: page.cursor};',
);
const editDiff = generateDiffString(editBefore, editAfter);
const editPatch = generateUnifiedPatch(
  'src/search/paginate.ts',
  editBefore,
  editAfter,
);
const editDetails: CatalogToolDetails =
  editDiff.firstChangedLine === undefined
    ? {diff: editDiff.diff, patch: editPatch}
    : {
        diff: editDiff.diff,
        patch: editPatch,
        firstChangedLine: editDiff.firstChangedLine,
      };

const editTool: CatalogItem = {
  kind: 'tool',
  tool: {
    name: 'edit',
    callId: 'catalog-edit-1',
    definition: 'edit',
    args: {
      path: 'src/search/paginate.ts',
      edits: [
        {
          oldText: '  return {items, nextCursor: page.cursor};',
          newText:
            '  const unique = page.items.filter(item => !seen.has(item.id));\n' +
            '  return {items: unique, nextCursor: page.cursor};',
        },
      ],
    },
    result: [
      {
        type: 'text',
        text: 'Successfully replaced 1 block in src/search/paginate.ts.',
      },
    ],
    details: editDetails,
    expanded: true,
  },
};

const bashStates: CatalogItem[] = [
  {
    kind: 'tool',
    tool: {
      name: 'bash',
      callId: 'catalog-bash-running',
      definition: 'bash',
      args: {command: 'bun test tests/search/paginate.test.ts'},
      result: [
        {
          type: 'text',
          text: 'bun test v1.4.0\n... checking duplicate entries between pages',
        },
      ],
      isPartial: true,
    },
  },
  {
    kind: 'tool',
    tool: {
      name: 'bash',
      callId: 'catalog-bash-complete',
      definition: 'bash',
      args: {command: 'bun test tests/search/paginate.test.ts'},
      result: [
        {type: 'text', text: '8 pass\n0 fail\nRan 8 tests across 1 file.'},
      ],
      expanded: true,
    },
  },
  {
    kind: 'tool',
    tool: {
      name: 'bash',
      callId: 'catalog-bash-failed',
      definition: 'bash',
      args: {command: 'bun test tests/search/paginate.test.ts'},
      result: [
        {
          type: 'text',
          text: 'FAIL skips IDs from the previous page\nExpected: ["result-3"]\nReceived: ["result-2", "result-3"]',
        },
      ],
      isError: true,
      expanded: true,
    },
  },
];

const retained = new Content();
const searchText = [
  'query: pagination cursor deduplication',
  'provider: exa',
  'selection: preferred',
  'fallback: false',
  '',
  '1. Cursor pagination guide',
  'url: https://example.invalid/pagination',
  'source: example.invalid',
  'snippet: preserve order while advancing the cursor',
].join('\n');
const searchId = retained.store(searchText);
const fetchId = retained.store(
  '# Pagination notes\n\nUse the cursor from the previous page and filter IDs before returning the next page.',
);
const webSearchTool: CatalogItem = {
  kind: 'tool',
  tool: {
    name: 'web_search',
    callId: 'catalog-web-search',
    definition: 'generic',
    args: {queries: ['pagination cursor deduplication'], maxResults: 2},
    result: [{type: 'text', text: 'item: 0\n' + retained.page(searchId)}],
    expanded: true,
  },
};
const webFetchTool: CatalogItem = {
  kind: 'tool',
  tool: {
    name: 'fetch_content',
    callId: 'catalog-web-fetch',
    definition: 'generic',
    args: {urls: ['https://example.invalid/pagination'], mode: 'readable'},
    result: [{type: 'text', text: 'item: 0\n' + retained.page(fetchId)}],
    expanded: true,
  },
};
const webPageFindTool: CatalogItem = {
  kind: 'tool',
  tool: {
    name: 'get_search_content',
    callId: 'catalog-web-find',
    definition: 'generic',
    args: {contentId: fetchId, find: 'cursor'},
    result: [{type: 'text', text: retained.find(fetchId, 'cursor')}],
    expanded: true,
  },
};
const longOutput = Array.from(
  {length: 14},
  (_, index) => `checked result ${index + 1}`,
).join('\n');
const shellTruncation = truncateTail(longOutput, {maxLines: 3});

const rtkRewrite: CatalogItem[] = [
  {
    kind: 'tool',
    tool: {
      name: 'bash',
      callId: 'catalog-rtk-bash',
      definition: 'bash',
      args: {command: 'git status --short'},
      result: [
        {
          type: 'text',
          text: ' M src/search/paginate.ts\n?? tests/search/paginate.test.ts',
        },
      ],
      expanded: true,
    },
  },
  {
    kind: 'notice',
    type: 'error',
    message:
      'RTK rewrite failed; leaving the original Bash command unchanged. RTK rewrite preparation failed. Run /rtk diagnostics for details.',
  },
];

const rtkRewriteSuccess: CatalogItem[] = [
  {
    kind: 'tool',
    tool: {
      name: 'bash',
      callId: 'catalog-rtk-bash-success',
      definition: 'bash',
      args: {command: 'rtk git status'},
      result: [
        {
          type: 'text',
          text: ' M src/search/paginate.ts\n?? tests/search/paginate.test.ts',
        },
      ],
      expanded: true,
    },
  },
];

const shellModes: CatalogItem[] = [
  {
    kind: 'bash',
    command: 'git status --short',
    output: ' M src/search/paginate.ts\n?? tests/search/paginate.test.ts',
    exitCode: 0,
    cancelled: false,
  },
  {
    kind: 'bash',
    command: 'git diff --stat',
    output: ' src/search/paginate.ts | 4 ++--\n 1 file changed',
    exitCode: 0,
    cancelled: false,
    excludeFromContext: true,
  },
];

const compactionMessage: CompactionSummaryMessage = {
  role: 'compactionSummary',
  summary: 'The pagination fix keeps previousIds and preserves result order.',
  tokensBefore: 12_480,
  timestamp,
};

const branchMessage: BranchSummaryMessage = {
  role: 'branchSummary',
  summary:
    'The branch checked the cursor edge case, preserved previousIds, and returned to the main task.',
  fromId: 'catalog-branch-parent',
  timestamp,
};

const skillBlock: ParsedSkillBlock = {
  name: 'review-pagination',
  location: '.agents/skills/review-pagination/SKILL.md',
  content:
    'Check cursor boundaries, preserve order, and keep the regression test focused.',
  userMessage: 'Use the pagination review checklist.',
};

const sceneItems = {
  'catalog-tool-preview-states': [
    {
      kind: 'tool',
      tool: {
        name: 'read',
        callId: 'read-collapsed',
        definition: 'read',
        args: {path: 'src/search/paginate.ts'},
        result: [{type: 'text', text: 'export const page = 2;'}],
      },
    },
    {
      kind: 'tool',
      tool: {
        name: 'read',
        callId: 'read-skill',
        definition: 'read',
        args: {path: '.agents/skills/review-pagination/SKILL.md'},
        result: [{type: 'text', text: '# Review pagination'}],
      },
    },
    {
      kind: 'tool',
      tool: {
        name: 'web_search',
        callId: 'generic-collapsed',
        definition: 'generic',
        args: {queries: ['cursor']},
        result: [{type: 'text', text: longOutput}],
      },
    },
  ],
  'catalog-tool-empty-errors': [
    {
      kind: 'tool',
      tool: {
        name: 'grep',
        callId: 'grep-empty',
        definition: 'grep',
        args: {pattern: 'retiredCursor', path: 'src/search'},
        result: [{type: 'text', text: ''}],
      },
    },
    {
      kind: 'tool',
      tool: {
        name: 'read',
        callId: 'read-error',
        definition: 'read',
        args: {path: 'src/search/missing.ts'},
        result: [
          {
            type: 'text',
            text: 'ENOENT: no such file or directory, open src/search/missing.ts',
          },
        ],
        isError: true,
      },
    },
    {
      kind: 'tool',
      tool: {
        name: 'edit',
        callId: 'edit-error',
        definition: 'edit',
        args: {
          path: 'src/search/paginate.ts',
          edits: [{oldText: 'retiredCursor', newText: 'nextCursor'}],
        },
        result: [
          {
            type: 'text',
            text: 'Could not find the exact text in src/search/paginate.ts.',
          },
        ],
        isError: true,
      },
    },
  ],
  'catalog-tool-bash-truncated': [
    {
      kind: 'tool',
      tool: {
        name: 'bash',
        callId: 'bash-truncated',
        definition: 'bash',
        args: {command: 'bun test'},
        result: [{type: 'text', text: longOutput}],
        details: {
          fullOutputPath: '/tmp/pi-bash-preview.log',
          truncation: {
            truncated: true,
            truncatedBy: 'lines',
            outputLines: 14,
            totalLines: 30,
          },
        },
      },
    },
    {
      kind: 'tool',
      tool: {
        name: 'bash',
        callId: 'bash-timeout',
        definition: 'bash',
        args: {command: 'bun test', timeout: 15},
        result: [{type: 'text', text: 'Command timed out after 15 seconds'}],
        isError: true,
      },
    },
  ],
  'catalog-shell-interrupted': [
    {
      kind: 'bash',
      command: 'bun test',
      output: 'Checking pagination...',
      exitCode: undefined,
      cancelled: true,
    },
    {
      kind: 'bash',
      command: 'bun test',
      output: '1 fail',
      exitCode: 1,
      cancelled: false,
    },
    {
      kind: 'bash',
      command: 'bun test --verbose',
      output: shellTruncation.content,
      exitCode: 0,
      cancelled: false,
      truncation: shellTruncation,
      fullOutputPath: '/tmp/pi-bash-preview.log',
    },
  ],
  'catalog-web-page': [
    {
      kind: 'tool',
      tool: {
        name: 'get_search_content',
        callId: 'web-page',
        definition: 'generic',
        args: {contentId: fetchId, offset: 0, limit: 50},
        result: [{type: 'text', text: retained.page(fetchId, 0, 50)}],
        expanded: true,
      },
    },
  ],
  'catalog-web-errors': [
    {
      kind: 'tool',
      tool: {
        name: 'fetch_content',
        callId: 'web-batch-error',
        definition: 'generic',
        args: {urls: ['https://example.invalid/missing']},
        result: [{type: 'text', text: 'item: 0\nerror: http: HTTP 404'}],
        expanded: true,
      },
    },
    {
      kind: 'tool',
      tool: {
        name: 'get_search_content',
        callId: 'web-unavailable',
        definition: 'generic',
        args: {contentId: 'expired-content'},
        result: [
          {type: 'text', text: 'Content unavailable. Search or fetch again.'},
        ],
        isError: true,
        expanded: true,
      },
    },
  ],

  'catalog-user-markdown': [userMarkdown],
  'catalog-assistant-markdown': [assistantMarkdown],
  'catalog-assistant-thinking-collapsed': [
    {kind: 'assistant', message: thinkingMessage, hideThinkingBlock: true},
  ],
  'catalog-assistant-thinking-expanded': [
    {kind: 'assistant', message: thinkingMessage, hideThinkingBlock: false},
  ],
  'catalog-assistant-error': [
    {
      kind: 'assistant',
      message: assistant([], 'error', 'Provider returned HTTP 503'),
    },
  ],
  'catalog-assistant-aborted': [
    {
      kind: 'assistant',
      message: assistant(
        [],
        'aborted',
        'Operation aborted while waiting for the provider',
      ),
    },
  ],
  'catalog-assistant-truncated': [
    {kind: 'assistant', message: truncatedMessage},
  ],
  'catalog-custom-message-fallback': [
    {
      kind: 'custom',
      message: {
        role: 'custom',
        customType: 'catalog-fallback',
        content:
          'Extension-provided message with the native fallback renderer.',
        display: true,
        timestamp,
      },
    },
  ],
  'catalog-tool-read': [readTool],
  'catalog-tool-write': [writeTool],
  'catalog-tool-edit': [editTool],
  'catalog-tool-bash-states': bashStates,
  'catalog-tool-grep': [
    {
      kind: 'tool',
      tool: {
        name: 'grep',
        callId: 'catalog-grep-1',
        definition: 'grep',
        args: {
          pattern: 'previousIds',
          path: 'src/search',
          glob: '*.ts',
          limit: 3,
        },
        result: [
          {
            type: 'text',
            text:
              'src/search/paginate.ts:19: const seen = new Set(previousIds);\n' +
              'src/search/types.ts:12: previousIds?: string[];\n' +
              'src/search/fixtures.ts:8: previousIds fixture',
          },
        ],
        details: {matchLimitReached: 3},
        expanded: true,
      },
    },
  ],
  'catalog-tool-find': [
    {
      kind: 'tool',
      tool: {
        name: 'find',
        callId: 'catalog-find-1',
        definition: 'find',
        args: {pattern: '**/*.ts', path: '.', limit: 3},
        result: [
          {
            type: 'text',
            text: 'src/search/paginate.ts\nsrc/search/types.ts\ntests/search/paginate.test.ts',
          },
        ],
        details: {resultLimitReached: 3},
        expanded: true,
      },
    },
  ],
  'catalog-tool-ls': [
    {
      kind: 'tool',
      tool: {
        name: 'ls',
        callId: 'catalog-ls-1',
        definition: 'ls',
        args: {path: 'src/search', limit: 3},
        result: [{type: 'text', text: 'paginate.ts\ntypes.ts\nindex.ts'}],
        details: {entryLimitReached: 3},
        expanded: true,
      },
    },
  ],
  'catalog-web-search': [webSearchTool],
  'catalog-web-content': [webFetchTool],
  'catalog-web-page-find': [webPageFindTool],
  'catalog-rtk-rewrite-failure': rtkRewrite,
  'catalog-rtk-rewrite-success': rtkRewriteSuccess,
  'catalog-shell-modes': shellModes,
  'catalog-compaction-collapsed': [
    {kind: 'compaction', message: compactionMessage},
  ],
  'catalog-compaction-expanded': [
    {kind: 'compaction', message: compactionMessage, expanded: true},
  ],
  'catalog-branch-collapsed': [{kind: 'branch', message: branchMessage}],
  'catalog-branch-expanded': [
    {kind: 'branch', message: branchMessage, expanded: true},
  ],
  'catalog-skill-collapsed': [{kind: 'skill', block: skillBlock}],
  'catalog-skill-expanded': [
    {kind: 'skill', block: skillBlock, expanded: true},
  ],
  'catalog-notice-info': [
    {
      kind: 'notice',
      type: 'info',
      message: 'using the cached search index.',
    },
  ],
  'catalog-notice-warning': [
    {
      kind: 'notice',
      type: 'warning',
      message: 'output was truncated; expand for details.',
    },
  ],
  'catalog-notice-error': [
    {
      kind: 'notice',
      type: 'error',
      message: 'the requested operation failed; retry is available.',
    },
  ],
  'catalog-extension-error': [
    {
      kind: 'extension-error',
      message: 'fixture handler failed; retry with /reload',
    },
  ],
  'catalog-tool-image-fallback': [
    {
      kind: 'tool',
      tool: {
        name: 'read',
        callId: 'catalog-image-1',
        definition: 'read',
        args: {path: 'assets/diagram.png'},
        result: [
          {type: 'text', text: 'Read image file [image/png] (text fallback)'},
          {
            type: 'image',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            mimeType: 'image/png',
          },
        ],
        expanded: true,
      },
    },
  ],
} satisfies Readonly<Record<string, readonly CatalogItem[]>>;

export function getCatalogScene(name: string): readonly CatalogItem[] {
  const scene = Object.entries(sceneItems).find(
    ([sceneName]) => sceneName === name,
  )?.[1];
  if (scene === undefined) throw new Error(`Unknown catalog scene: ${name}`);
  return scene;
}
