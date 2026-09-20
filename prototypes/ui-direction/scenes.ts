// Throwaway UI research fixtures. These events do not execute tools or agents.
export type ToolSample = {
  name: string;
  target: string;
  state: 'done' | 'running' | 'failed';
  result: string;
  output: readonly string[];
};

export type SampleMessage =
  | {kind: 'user' | 'assistant'; text: string}
  | {kind: 'tool'; tool: ToolSample};

const search: ToolSample = {
  name: 'Search',
  target: 'nextCursor · src/search',
  state: 'done',
  result: '3 matches in 2 files',
  output: [
    'src/search/paginate.ts:20  const nextCursor = page.cursor;',
    'src/search/paginate.ts:21  return {items, nextCursor};',
    'src/search/types.ts:12     nextCursor?: string;',
  ],
};
const read: ToolSample = {
  name: 'Read',
  target: 'src/search/paginate.ts:18–23',
  state: 'done',
  result: '6 lines · pagination boundary',
  output: [
    '18  export function paginate(page, previousIds) {',
    '19    const items = uniqueById(page.items);',
    '20    const nextCursor = page.cursor;',
    '21    return {items, nextCursor};',
    '22  }',
    '23  // The caller retains IDs from the previous page.',
  ],
};
const edit: ToolSample = {
  name: 'Edit',
  target: 'src/search/paginate.ts',
  state: 'done',
  result: '+3 −1 · preserve order and skip previous IDs',
  output: [],
};
const tests: ToolSample = {
  name: 'Bash',
  target: 'bun test tests/search/paginate.test.ts',
  state: 'running',
  result: 'Running · 4s',
  output: [
    'bun test v1.4.0',
    '✓ keeps the first occurrence within a page',
    '✓ preserves the next cursor',
    '… checking duplicate entries between pages',
  ],
};
const failed: ToolSample = {
  ...tests,
  state: 'failed',
  result: 'Test failed · exit 1 · 1 failed, 7 passed',
  output: [
    'FAIL skips IDs from the previous page',
    'tests/search/paginate.test.ts:48',
    'Expected: ["result-3"]',
    'Received: ["result-2", "result-3"]',
  ],
};
const request = {
  kind: 'user',
  text: '修复搜索结果翻页时重复出现的问题, 保留原来的排序, 并补充测试.',
} as const;

export const scenes = {
  welcome: [],
  work: [
    request,
    {
      kind: 'assistant',
      text: '我先检查分页边界和已有测试. 重复项可能来自上一页的游标, 需要确认去重发生在哪一层.',
    },
    {kind: 'tool', tool: search},
    {kind: 'tool', tool: read},
    {
      kind: 'assistant',
      text: '当前去重集合只覆盖单页. 我会保留第一条结果的顺序, 并把上一页已出现的 ID 传入边界处理.',
    },
  ],
  diff: [
    request,
    {
      kind: 'assistant',
      text: '分页边界改为接收上一页的 ID. 下面是关键改动, 接下来验证重复项和游标是否一起保持正确.',
    },
    {kind: 'tool', tool: edit},
    {kind: 'tool', tool: tests},
  ],
  failure: [
    {kind: 'tool', tool: failed},
    {
      kind: 'assistant',
      text: '跨页测试还没通过: result-2 仍被保留. 修改已经写入, 但验证失败. 我会检查 previousIds 的传递路径, 暂时不提交.',
    },
    {
      kind: 'tool',
      tool: {
        ...read,
        target: 'src/search/request.ts:40–43',
        result: '4 lines · caller passes an empty ID list',
        output: [
          '40  const page = await fetchPage(cursor);',
          '41  const previousIds: string[] = [];',
          '42  return paginate(page, previousIds);',
          '43  }',
        ],
      },
    },
  ],
  complete: [
    request,
    {
      kind: 'tool',
      tool: {
        ...tests,
        state: 'done',
        result: '8 passed · 0 failed · 1.2s',
        output: ['8 pass', '0 fail', 'Ran 8 tests across 1 file. [1.20s]'],
      },
    },
    {
      kind: 'assistant',
      text: '已修复跨页重复结果, 保留首次出现的顺序和原有游标.\n\n- `src/search/paginate.ts`: 按上一页 ID 去重.\n- `tests/search/paginate.test.ts`: 覆盖重复项、顺序和空页.\n\n8 项相关测试通过. 改动还未提交, 可以继续检查完整 diff.',
    },
  ],
} satisfies Record<string, readonly SampleMessage[]>;

export function getScene(name: string): readonly SampleMessage[] {
  if (name.startsWith('diff-')) return scenes.diff;
  return (
    Object.entries(scenes).find(([key]) => key === name)?.[1] ?? scenes.work
  );
}
