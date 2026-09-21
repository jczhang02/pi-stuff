// Offline event script for a coherent, multi-turn pagination repair.
import {getToolFixtures, retrievalTools} from './fixtures';
import type {Entry, Tool} from './model';
export type Step =
  | {kind: 'entry'; entry: Entry}
  | {kind: 'tool'; tool: Tool}
  | {kind: 'thought'; text: string}
  | {kind: 'answer'; text: string}
  | {kind: 'failure'};
export function repairPlan(): Step[] {
  const investigation = structuredClone(retrievalTools);
  const failures = getToolFixtures('failures');
  const web = getToolFixtures('web');
  const changes = getToolFixtures('changes');
  const missing = failures.find(tool => tool.name === 'Read');
  const webFailure = failures.find(tool => tool.name === 'WebFetch');
  const testFailure = failures.find(tool => tool.name === 'Bash');
  if (!missing || !webFailure || !testFailure)
    throw new Error('Missing repair fixtures');
  return [
    {
      kind: 'thought',
      text: '先检查数据流, 区分跨页重复和页内重复. cursor 应来自 provider, 不应由过滤后的条数推导.',
    },
    {
      kind: 'answer',
      text: '我会先复现分页边界问题, 检查已有实现, 再补测试并验证游标不变.',
    },
    {kind: 'tool', tool: missing},
    {
      kind: 'entry',
      entry: {
        kind: 'assistant',
        text: '没有独立的 cursor.ts. 回到当前 paginate.ts 与测试入口.',
      },
    },
    {kind: 'tool', tool: investigation[0]!},
    {
      kind: 'thought',
      text: '实现读取了 previousIds, 需要查找它在过滤路径中的使用位置.',
    },
    ...investigation.slice(1).map(tool => ({kind: 'tool', tool}) as const),
    {
      kind: 'entry',
      entry: {
        kind: 'assistant',
        text: 'previousIds 没有参与过滤. 我再核对空页与续读规则.',
      },
    },
    {kind: 'tool', tool: web[0]!},
    {kind: 'tool', tool: webFailure},
    {
      kind: 'entry',
      entry: {
        kind: 'assistant',
        text: '旧文档地址返回 404. 改用搜索结果中的当前分页说明.',
      },
    },
    ...web.slice(1).map(tool => ({kind: 'tool', tool}) as const),
    {kind: 'tool', tool: changes.find(tool => tool.name === 'Write')!},
    {kind: 'tool', tool: testFailure},
    {
      kind: 'entry',
      entry: {
        kind: 'assistant',
        text: '新增测试复现了跨页重复. 现在只修改 item 过滤, 保留 provider 的 cursor.',
      },
    },
    {kind: 'tool', tool: changes.find(tool => tool.name === 'Edit')!},
    {kind: 'tool', tool: changes.find(tool => tool.name === 'Bash')!},
    {
      kind: 'answer',
      text: '已修复跨页重复, 8 项测试通过.\n\n- 保留结果顺序.\n- cursor 原样传递.\n- 新增跨页重叠测试.\n\n页内重复与全空过滤页还可以单独补充覆盖.',
    },
  ];
}
export function followupPlan(): Step[] {
  const path = 'tests/search/pagination-additional.test.ts';
  const text = [
    'test("keeps cursor when every item is filtered", () => {',
    '  const page = {items: [{id: "a"}], cursor: "next"};',
    '  expect(paginate(page, ["a"])).toEqual({items: [], nextCursor: "next"});',
    '});',
    '',
    'test("keeps first occurrence within the same page", () => {',
    '  const first = {id: "a", title: "first"};',
    '  const page = {items: [first, {id: "a", title: "later"}], cursor: "next"};',
    '  expect(paginate(page, []).items).toEqual([first]);',
    '});',
  ].join('\n');
  const cases = [
    'preserves the cursor',
    'skips previous-page IDs',
    'keeps original order',
    'accepts empty page',
    'accepts empty previous page',
    'preserves fields',
    'does not mutate input',
    'handles missing cursor',
    'keeps cursor on filtered empty page',
    'keeps first same-page occurrence',
  ];
  return [
    {
      kind: 'thought',
      text: '继续补全空过滤页与页内重复. 上一版只检查 seen, 没有把本页新 ID 加进去; 需要在保留记录时更新集合.',
    },
    {kind: 'answer', text: '我会补上这两个边界, 再检查完整 diff 和测试输出.'},
    ...structuredClone(retrievalTools)
      .slice(0, 2)
      .map(
        tool =>
          ({
            kind: 'tool',
            tool: {
              ...tool,
              body:
                tool.name === 'Read'
                  ? {
                      kind: 'code' as const,
                      path: 'src/search/paginate.ts',
                      start: 18,
                      text: 'export function paginate(page, previousIds) {\n  const seen = new Set(previousIds);\n  const items = page.items.filter(item => !seen.has(item.id));\n  return {items, nextCursor: page.cursor};\n}',
                    }
                  : tool.body,
              summary: tool.name === 'Read' ? 'Read 5 lines' : tool.summary,
            },
          }) as const,
      ),
    {
      kind: 'tool',
      tool: {
        kind: 'tool',
        name: 'Write',
        target: path,
        state: 'done',
        summary: 'Wrote 10 lines · 2 additional boundary tests',
        body: {kind: 'code', path, start: 1, text},
      },
    },
    {
      kind: 'tool',
      tool: {
        kind: 'tool',
        name: 'Bash',
        target: 'bun test tests/search',
        state: 'failed',
        summary: '9 passed · 1 failed · duplicate within page',
        body: {
          kind: 'text',
          text: 'FAIL keeps first occurrence within the same page\nExpected: [{id: "a", title: "first"}]\nReceived: [{id: "a", title: "first"}, {id: "a", title: "later"}]\n\n9 pass\n1 fail',
        },
      },
    },
    {
      kind: 'tool',
      tool: {
        kind: 'tool',
        name: 'Edit',
        target: 'src/search/paginate.ts',
        state: 'done',
        summary: 'Added 5 lines, removed 1 line',
        body: {
          kind: 'diff',
          path: 'src/search/paginate.ts',
          rows: [
            {
              kind: 'context',
              oldLine: 19,
              newLine: 19,
              text: '  const seen = new Set(previousIds);',
            },
            {
              kind: 'remove',
              oldLine: 20,
              text: '  const items = page.items.filter(item => !seen.has(item.id));',
            },
            {
              kind: 'add',
              newLine: 20,
              text: '  const items = page.items.filter(item => {',
            },
            {
              kind: 'add',
              newLine: 21,
              text: '    if (seen.has(item.id)) return false;',
            },
            {kind: 'add', newLine: 22, text: '    seen.add(item.id);'},
            {kind: 'add', newLine: 23, text: '    return true;'},
            {kind: 'add', newLine: 24, text: '  });'},
            {
              kind: 'context',
              oldLine: 21,
              newLine: 25,
              text: '  return {items, nextCursor: page.cursor};',
            },
          ],
        },
      },
    },
    {
      kind: 'tool',
      tool: {
        kind: 'tool',
        name: 'Bash',
        target: 'bun test tests/search --verbose',
        state: 'done',
        summary: '10 passed · 0 failed',
        body: {
          kind: 'text',
          text: cases
            .flatMap((name, i) => [
              `[pass] ${name}`,
              `  case ${i + 1}: cursor preserved; input unchanged`,
              `  fixture: page-${i + 1}; stable output order`,
            ])
            .concat(['', '10 pass', '0 fail', 'Ran 10 tests across 3 files.'])
            .join('\n'),
        },
      },
    },
    {
      kind: 'tool',
      tool: {
        kind: 'tool',
        name: 'Bash',
        target: 'git diff --check',
        state: 'done',
        summary: 'No output · exit 0',
        body: {kind: 'text', text: ''},
      },
    },
    {
      kind: 'answer',
      text: '两个边界都已补齐, 10 项测试通过.\n\n```ts\nif (seen.has(item.id)) return false;\nseen.add(item.id);\nreturn true;\n```\n\n同页和跨页重复都保留第一次出现的记录. 全空过滤页仍保留下一页 cursor. `git diff --check` 无输出.',
    },
  ];
}
