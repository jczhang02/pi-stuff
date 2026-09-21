// One coherent pagination repair, shown at selected moments. All execution is simulated.
import {groupExploration, type Entry, type Tool} from './model';
const path = 'src/search/paginate.ts';
const before =
  'export function paginate(page, previousIds) {\n  const seen = new Set(previousIds);\n  return {items: page.items, nextCursor: page.cursor};\n}';
export const read: Tool = {
  kind: 'tool',
  name: 'Read',
  target: path,
  summary: 'Read 4 lines',
  state: 'done',
  body: {kind: 'code', path, text: before, start: 18},
};
const grep: Tool = {
  kind: 'tool',
  name: 'Grep',
  target: '"previousIds" in src/search',
  summary: 'Found 3 matches in 2 files',
  state: 'done',
  body: {
    kind: 'text',
    text: 'src/search/paginate.ts:18  export function paginate(page, previousIds) {\nsrc/search/paginate.ts:19    const seen = new Set(previousIds);\nsrc/search/types.ts:12     previousIds: string[];',
  },
};
const ls: Tool = {
  kind: 'tool',
  name: 'Ls',
  target: 'src/search',
  summary: 'Listed 3 entries',
  state: 'done',
  body: {kind: 'text', text: 'paginate.ts\nprovider.ts\ntypes.ts'},
};
const find: Tool = {
  kind: 'tool',
  name: 'Find',
  target: '"*paginate*" in tests',
  summary: 'Found 1 file',
  state: 'done',
  body: {kind: 'text', text: 'tests/search/paginate.test.ts'},
};
const testRead: Tool = {
  kind: 'tool',
  name: 'Read',
  target: 'tests/search/paginate.test.ts',
  summary: 'Read 3 lines',
  state: 'done',
  body: {
    kind: 'code',
    path: 'tests/search/paginate.test.ts',
    start: 1,
    text: 'test("preserves the cursor", () => {\n  expect(paginate(page, []).nextCursor).toBe(page.cursor);\n});',
  },
};
const edit: Tool = {
  kind: 'tool',
  name: 'Edit',
  target: path,
  summary: 'Added 2 lines, removed 1 line',
  state: 'done',
  body: {
    kind: 'diff',
    path,
    rows: [
      {
        kind: 'remove',
        oldLine: 20,
        text: '  return {items: page.items, nextCursor: page.cursor};',
      },
      {
        kind: 'add',
        newLine: 20,
        text: '  const items = page.items.filter(item => !seen.has(item.id));',
      },
      {
        kind: 'add',
        newLine: 21,
        text: '  return {items, nextCursor: page.cursor};',
      },
    ],
  },
};
const write: Tool = {
  kind: 'tool',
  name: 'Write',
  target: 'tests/search/pagination-boundary.test.ts',
  summary: 'Wrote 7 lines',
  state: 'done',
  body: {
    kind: 'code',
    path: 'tests/search/pagination-boundary.test.ts',
    start: 1,
    text: 'test("skips IDs from the previous page", () => {\n  const page = {items: [{id: "a"}, {id: "b"}], cursor: "next"};\n  const result = paginate(page, ["a"]);\n\n  expect(result.items).toEqual([{id: "b"}]);\n  expect(result.nextCursor).toBe("next");\n});',
  },
};
const test: Tool = {
  kind: 'tool',
  name: 'Bash',
  target: 'bun test tests/search',
  summary: '8 passed · 0 failed · 0.4s',
  state: 'done',
  body: {
    kind: 'text',
    text: 'bun test v1.4.0\n[pass] preserves the cursor\n[pass] skips IDs from the previous page\n[pass] keeps original order\n[pass] accepts an empty page\n[pass] accepts an empty previous page\n[pass] preserves fields\n[pass] does not mutate input\n[pass] handles a missing cursor\n\n8 pass\n0 fail\nRan 8 tests across 2 files.',
  },
};
const failed: Tool = {
  ...test,
  state: 'failed',
  summary: 'Exit 1 · skips IDs from the previous page',
  body: {
    kind: 'text',
    text: 'FAIL skips IDs from the previous page\nExpected: [{id: "b"}]\nReceived: [{id: "a"}, {id: "b"}]\n\n7 pass\n1 fail',
  },
};
const running: Tool = {
  ...test,
  state: 'running',
  summary: 'Running · 2s',
  body: {
    kind: 'text',
    text: '[pass] preserves the cursor\nChecking pagination boundaries...',
  },
};
const search: Tool = {
  kind: 'tool',
  name: 'WebSearch',
  target: '"cursor pagination duplicate results"',
  summary: 'Found 3 results',
  state: 'done',
  body: {
    kind: 'text',
    text: '1. Cursor pagination guide\n   https://docs.example.com/pagination\n   Preserve order and carry the next cursor forward.\n2. Search API reference\n   https://docs.example.com/search\n   Use IDs to remove overlapping results.\n3. Pagination examples\n   https://docs.example.com/examples\n   Handle empty and repeated page boundaries.',
  },
  metadata:
    'web_search · provider=exa · contentId=search-01 · offset=0 · nextOffset=325',
};
const fetch: Tool = {
  kind: 'tool',
  name: 'WebFetch',
  target: 'docs.example.com/pagination',
  summary: 'Retrieved pagination guide · 6 lines',
  state: 'done',
  body: {
    kind: 'text',
    text: 'Cursor pagination\n\nKeep the first occurrence of each item. Pass the cursor from the response\nunchanged to the next request, even when filtering leaves an empty page.\n\nDo not derive the next cursor from the filtered result count.',
  },
  metadata:
    'fetch_content · https://docs.example.com/pagination · contentId=page-01 · offset=0 · nextOffset=228',
};
const webFind: Tool = {
  kind: 'tool',
  name: 'WebRead',
  target: 'docs.example.com/pagination · find "cursor"',
  summary: 'Found 2 matches',
  state: 'done',
  body: {
    kind: 'text',
    text: '3   Pass the cursor from the response unchanged to the next request.\n6   Do not derive the next cursor from the filtered result count.',
  },
  metadata:
    'get_search_content · contentId=page-01 · find=cursor · moreMatches=false',
};
const webPage: Tool = {
  ...webFind,
  target: 'docs.example.com/pagination · continue',
  summary: 'Read next 3 lines · more available',
  body: {
    kind: 'text',
    text: '7   Empty filtered pages are valid.\n8   Continue using the next cursor until the provider returns no cursor.\n9   Deduplication must preserve the order of retained records.',
  },
  metadata:
    'get_search_content · contentId=page-01 · offset=228 · nextOffset=399 · truncated=true',
};
const thoughts = {
  kind: 'thoughts',
  seconds: 4,
  text: 'The cursor already comes from the provider. The bug is in the item list: previousIds is read but never used to filter page.items. I will preserve the cursor and add a boundary test.',
} satisfies Entry;
const user: Entry = {
  kind: 'user',
  text: '分页边界会出现重复结果. 请保留第一次出现的记录, 不要改变下一页游标, 并补测试.',
};
const plan: Entry = {
  kind: 'assistant',
  text: '先检查分页实现和现有测试, 再对照游标规则.',
};
const exploration = [ls, grep, read, find, testRead];
export const retrievalTools: readonly Tool[] = [read, grep, find, ls];
const research: Entry[] = [
  {
    kind: 'assistant',
    text: '实现读取了 previousIds, 但没有过滤结果. 我再确认空页时应如何保留游标.',
  },
  search,
  fetch,
  webFind,
  webPage,
];
const fix: Entry[] = [
  {
    kind: 'assistant',
    text: '保持 provider 返回的 cursor, 只过滤重复的 item.',
  },
  edit,
  write,
  test,
  {
    kind: 'assistant',
    text: '已修复分页重复: 保留结果顺序, 游标原样传递.\n\n新增边界测试, 8 项测试通过.',
  },
];
const missing: Tool = {
  ...read,
  target: 'src/search/cursor.ts',
  state: 'failed',
  summary: 'File not found · src/search/cursor.ts',
  body: {
    kind: 'text',
    text: 'ENOENT: no such file or directory, open src/search/cursor.ts',
  },
};
const noMatch: Tool = {
  ...grep,
  target: '"legacyCursor" in src/search',
  summary: 'No matches',
  body: {kind: 'text', text: ''},
};
const webFailed: Tool = {
  ...fetch,
  target: 'docs.example.com/old-pagination',
  state: 'failed',
  summary: 'HTTP 404 · page not found',
  metadata:
    'fetch_content · https://docs.example.com/old-pagination · HTTP 404',
  body: {
    kind: 'text',
    text: 'The server returned HTTP 404. No page content was retrieved.',
  },
};
const truncated: Tool = {
  ...test,
  target: 'bun test --verbose',
  summary: '8 passed · output truncated',
  warning:
    'Showing the retained tail. Full output: /tmp/pi-pagination-tests.log',
  body: {
    kind: 'text',
    text: Array.from(
      {length: 24},
      (_, i) => `test runner diagnostic ${i + 1}`,
    ).join('\n'),
  },
};

export const scenes = [
  {
    name: 'live',
    title: '连续交互会话',
    note: '提交输入后连续定位、分组探索、Web 失败恢复、测试失败与修复; 后续输入继续边界测试. Esc 中断后可继续.',
    tokens: ['Welcome back!'],
  },
  {
    name: 'live-error',
    title: '回答失败后重试',
    note: '首次提交遇到回答错误, 再次提交可重试, 回答状态不使用工具样式.',
    tokens: ['Welcome back!'],
  },
  {
    name: 'welcome',
    title: '欢迎页',
    note: '保留 pi-stuff-old 的欢迎布局.',
    tokens: ['Welcome back!'],
  },
  {
    name: 'long-diff',
    title: '长 diff 与长路径',
    note: '短预览注明隐藏行数; 展开恢复完整路径和带高亮的改动.',
    tokens: ['more lines', 'Added 3 lines'],
  },
  {
    name: 'session',
    title: '完整会话',
    note: '从定位到 Web 研究、修改和验证. 连续只读调用聚合, 工具默认收起.',
    tokens: ['8 项测试通过'],
  },
  {
    name: 'investigate',
    title: '定位问题',
    note: '5 个连续只读调用聚合为一行; 点击组标题查看各次调用.',
    tokens: ['Read 2 files', 'Searched 2 patterns'],
  },
  {
    name: 'folding',
    title: '折叠边界',
    note: '展开工具与普通消息对齐; Thoughts 独立服从 Pi 设置, 失败调用仍可见.',
    tokens: ['Thoughts for 4s', 'File not found', '8 passed'],
  },
  {
    name: 'tools',
    title: '检索工具',
    note: 'Read、Grep、Find、Ls 共享活动摘要, 展开后各自保留操作和结果两层.',
    tokens: ['Read 1 file', 'Searched 2 patterns'],
  },
  {
    name: 'web',
    title: 'Web 家族',
    note: '搜索、取网页、内容查找和续读共用相同层级, 技术元数据仅在展开时出现.',
    tokens: ['Searched web 1 time', 'Read web content 3 times'],
  },
  {
    name: 'changes',
    title: '修改与验证',
    note: 'Edit 默认展示最多 6 行高亮差异; Write 只报写入结果, 点击查看高亮代码.',
    tokens: ['Added 2 lines', '8 passed'],
  },
  {
    name: 'running',
    title: '执行中',
    note: '运行中的工具保留状态和两行最新输出, 完成后收起.',
    tokens: ['Running', 'Checking pagination'],
  },
  {
    name: 'failures',
    title: '工具失败与空结果',
    note: '工具失败保留原因, 没有匹配是正常结果. 不重复显示错误正文.',
    tokens: ['Searched 1 pattern', 'File not found', 'HTTP 404'],
  },
  {
    name: 'long-output',
    title: '长输出',
    note: 'UI 收起与上游截断分开表达, 输出路径一直可见.',
    tokens: ['output truncated', 'pi-pagination-tests.log'],
  },
  {
    name: 'thoughts',
    title: 'Thoughts · hidden',
    note: 'hideThinkingBlock=true: 默认显示 • Thoughts for 4s. 点击后显示 • Thoughts: 正文, 前缀与正文同一行.',
    tokens: ['Thoughts for 4s'],
  },
  {
    name: 'thoughts-visible',
    title: 'Thoughts · no hidden',
    note: 'hideThinkingBlock=false: 默认显示 • Thoughts: 正文, 耗时在末尾. 续行与消息正文对齐, 不用斜体或容器. 原生 Ctrl+T 切换默认显示.',
    tokens: ['Thoughts:', 'previousIds'],
  },
  {
    name: 'interrupted',
    title: '回答中断',
    note: '已有回答仍保留, 中断直接使用 Pi 原生 AssistantMessageComponent 的 Operation aborted.',
    tokens: ['Operation aborted'],
  },
  {
    name: 'response-error',
    title: '回答失败',
    note: '失败原因直接呈现, 无 Tool 标题、结果枝线或独立错误卡片.',
    tokens: ['HTTP 503'],
  },
  {
    name: 'empty',
    title: '无输出与取消',
    note: '无输出、命令取消、图片文本回退都保留事实.',
    tokens: ['No output', 'Cancelled', 'Read 1 file'],
  },
  {
    name: 'replay',
    title: '动态执行',
    note: '从思考到工具运行再到完成, 验证自动收起和 Esc 中断.',
    tokens: ['Thoughts for 4s'],
  },
] as const;
export type SceneName = (typeof scenes)[number]['name'];
export function getEntries(name: string): Entry[] {
  return groupExploration(scenarioEntries(name));
}
export function getToolFixtures(name: string): Tool[] {
  return structuredClone(scenarioEntries(name)).filter(
    (entry): entry is Tool => entry.kind === 'tool',
  );
}
function scenarioEntries(name: string): Entry[] {
  switch (name) {
    case 'welcome':
    case 'live':
    case 'live-error':
      return [];
    case 'long-diff':
      return [
        {
          ...edit,
          target:
            'src/search/providers/remote/pagination/preserve-first-occurrence-and-next-cursor-boundary.ts',
          summary: 'Added 3 lines, removed 1 line',
          body: {
            kind: 'diff',
            path,
            rows: [
              {
                kind: 'context',
                oldLine: 18,
                newLine: 18,
                text: 'export function paginate(page, previousIds) {',
              },
              {
                kind: 'context',
                oldLine: 19,
                newLine: 19,
                text: '  const seen = new Set(previousIds);',
              },
              {
                kind: 'remove',
                oldLine: 20,
                text: '  return {items: page.items, nextCursor: page.cursor};',
              },
              {
                kind: 'add',
                newLine: 20,
                text: '  const items = page.items.filter(item => !seen.has(item.id));',
              },
              {
                kind: 'add',
                newLine: 21,
                text: '  // Keep the provider cursor, including empty filtered pages.',
              },
              {
                kind: 'add',
                newLine: 22,
                text: '  return {items, nextCursor: page.cursor};',
              },
              {kind: 'context', oldLine: 21, newLine: 23, text: '}'},
            ],
          },
        },
      ];
    case 'session':
      return [user, thoughts, plan, ...exploration, ...research, ...fix];
    case 'investigate':
      return [user, thoughts, plan, ...exploration];
    case 'folding':
      return [
        read,
        thoughts,
        grep,
        {
          kind: 'assistant',
          text: '过滤没有使用 previousIds. 接着检查测试入口.',
        },
        find,
        missing,
        testRead,
        test,
        {kind: 'assistant', text: '现有 8 项测试通过, 但还没有覆盖跨页重复.'},
      ];
    case 'tools':
      return [plan, ...retrievalTools];
    case 'web':
      return research;
    case 'changes':
      return fix;
    case 'running':
      return [
        user,
        {kind: 'assistant', text: '补上测试后, 我正在检查分页边界.'},
        running,
      ];
    case 'failures':
      return [
        {kind: 'assistant', text: '先检查旧入口, 找不到就回到当前实现.'},
        noMatch,
        missing,
        webFailed,
        failed,
      ];
    case 'long-output':
      return [
        truncated,
        {kind: 'assistant', text: '测试通过. 详细输出保留在日志里.'},
      ];
    case 'thoughts-visible':
    case 'thoughts':
      return [user, thoughts, plan, read, edit];
    case 'interrupted':
      return [
        user,
        {kind: 'assistant', text: '我会先检查分页实现, 然后补上边界测试.'},
        {kind: 'aborted'},
      ];
    case 'response-error':
      return [
        user,
        {
          kind: 'status',
          text: 'Request failed: HTTP 503. Please try again.',
          error: true,
        },
      ];
    case 'empty':
      return [
        {
          ...test,
          target: 'git diff --check',
          summary: 'No output · exit 0',
          body: {kind: 'text', text: ''},
        },
        {
          ...test,
          state: 'cancelled',
          summary: 'Cancelled · no completion result',
          body: {kind: 'text', text: 'Checking pagination...'},
        },
        {
          ...read,
          target: 'docs/pagination.png',
          summary: 'Image · image/png',
          body: {kind: 'text', text: '[image/png: terminal text fallback]'},
        },
      ];
    case 'replay':
      return [
        user,
        {kind: 'thoughts', text: thoughts.text, seconds: 0, running: true},
        {...running, summary: 'Waiting', body: {kind: 'text', text: ''}},
      ];
    default:
      throw new Error(`Unknown scene: ${name}`);
  }
}
export const replayResult: Tool = {
  ...test,
  summary: '8 passed · 0 failed · 4.0s',
};
