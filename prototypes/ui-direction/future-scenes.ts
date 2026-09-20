// Proposed UI for the current product inventory. Static data, no new capabilities.
import {catalogScenes} from './catalog-scenes';
import {getCatalogScene, type CatalogItem} from './catalog-fixtures';

const designs = [
  [
    'user-markdown',
    '用户消息',
    '旧版输入前缀, Markdown 与代码块保持原有层次.',
    ['Review the pagination boundary'],
  ],
  [
    'assistant-markdown',
    'Assistant 正文',
    '旧版圆点, 正文、列表、表格和代码统一缩进.',
    ['previousIds'],
  ],
  [
    'assistant-thinking-collapsed',
    'Thinking · 收起',
    '思考过程轻量显示, 与回答分开.',
    ['Thinking', 'page boundary'],
  ],
  [
    'assistant-thinking-expanded',
    'Thinking · 展开',
    '需要时在会话内阅读思考内容.',
    ['previousIds', 'page boundary'],
  ],
  ['assistant-error', '回答失败', '在原位置保留失败原因.', ['HTTP 503']],
  ['assistant-aborted', '回答中断', '中断与失败分开表达.', ['aborted']],
  [
    'assistant-truncated',
    '回答截断',
    '保留已收到的正文与截断提示.',
    ['truncated'],
  ],
  [
    'tool-read',
    'Read · 代码',
    '文件与结果分层, 行号和语法高亮辅助阅读.',
    ['paginate.ts', 'previousIds'],
  ],
  [
    'tool-write',
    'Write · 新文件',
    '显示写入结果和带语法高亮的内容.',
    ['paginate.test.ts', 'expect'],
  ],
  [
    'tool-edit',
    'Edit · 修改内容',
    '增删标记与语法颜色分开, 只展示本次改动.',
    ['paginate.ts', 'unique'],
  ],
  [
    'tool-grep',
    'Grep · 内容检索',
    '左侧位置, 右侧代码, 保留结果上限.',
    ['previousIds'],
  ],
  [
    'tool-find',
    'Find · 文件检索',
    '检索条件、文件清单与截断状态各有位置.',
    ['**/*.ts', 'paginate'],
  ],
  [
    'tool-ls',
    'Ls · 目录内容',
    '用轻量列表显示路径与结果范围.',
    ['src/search', 'paginate'],
  ],
  [
    'tool-preview-states',
    '工具 · 简短预览',
    '默认保留有用摘录, 完整内容在原位展开.',
    ['paginate.ts', 'review-pagination', 'more'],
  ],
  [
    'tool-empty-errors',
    '工具 · 空结果与失败',
    '空结果不冒充失败, 错误保留具体原因.',
    ['retiredCursor', 'ENOENT', 'Could not find'],
  ],
  [
    'tool-bash-states',
    'Bash · 执行状态',
    '同一层级承载运行中、成功和失败.',
    ['bun test', '8 pass', 'FAIL skips'],
  ],
  [
    'tool-bash-truncated',
    'Bash · 截断与超时',
    '截断说明及完整输出路径持续可见.',
    ['pi-bash-preview.log', 'timed out'],
  ],
  [
    'web-search',
    'Web search · 检索结果',
    '先读查询和结果, 再看内容标识等元数据.',
    ['pagination', 'contentId'],
  ],
  [
    'web-content',
    'Fetch content · 网页正文',
    '突出网址与正文, 保留内容定位信息.',
    ['Pagination notes', 'contentId'],
  ],
  [
    'web-page-find',
    'Web content · 内容查找',
    '查找条件、匹配片段与分页元数据分层.',
    ['cursor', 'contentId'],
  ],
  [
    'web-page',
    'Web content · 分页',
    '继续阅读的偏移与截断状态明确保留.',
    ['50', 'contentId'],
  ],
  [
    'web-errors',
    'Web · 请求失败',
    '单项 HTTP 错误与内容失效分别显示.',
    ['HTTP 404', 'Content unavailable'],
  ],
  [
    'rtk-rewrite-success',
    'RTK · 命令输出',
    '沿用 Bash 展示, 显示实际改写后的命令.',
    ['rtk git status'],
  ],
  [
    'rtk-rewrite-failure',
    'RTK · 回退',
    '显示原命令输出与已发生的回退原因.',
    ['git status', 'RTK rewrite'],
  ],
  [
    'shell-modes',
    '直接 Shell · ! 与 !!',
    '区别是否进入模型上下文, 保留输出.',
    ['git status', 'git diff'],
  ],
  [
    'shell-interrupted',
    '直接 Shell · 中断与截断',
    '中断、退出码和输出不完整分别表达.',
    ['cancelled', 'exit 1', 'pi-bash-preview.log'],
  ],
  [
    'compaction-collapsed',
    '上下文摘要 · 收起',
    '仅设计已有摘要消息的外观.',
    ['12,480'],
  ],
  [
    'compaction-expanded',
    '上下文摘要 · 展开',
    '在原位置阅读已生成的摘要.',
    ['previousIds'],
  ],
  [
    'branch-collapsed',
    '分支摘要 · 收起',
    '轻量摘要条目, 不增加会话管理功能.',
    ['Branch'],
  ],
  ['branch-expanded', '分支摘要 · 展开', '保留已有摘要正文.', ['previousIds']],
  [
    'skill-collapsed',
    'Skill 消息 · 收起',
    '名称作为入口, 请求仍可读.',
    ['review-pagination', 'Use the pagination review checklist'],
  ],
  [
    'skill-expanded',
    'Skill 消息 · 展开',
    '位置与内容在原位展开.',
    ['review-pagination', 'cursor boundaries'],
  ],
  [
    'notice-info',
    '已有信息提示',
    '沿用会话内提示能力, 不新增通知系统.',
    ['using the cached'],
  ],
  [
    'notice-warning',
    '已有警告提示',
    '保留实际警告内容.',
    ['output was truncated'],
  ],
  [
    'notice-error',
    '已有错误提示',
    '原因与可行的下一步直接呈现.',
    ['requested operation failed'],
  ],
  [
    'extension-error',
    '扩展错误',
    '在会话中保留错误和重新加载提示.',
    ['/reload'],
  ],
  [
    'tool-image-fallback',
    '工具图片 · 文本回退',
    '保留已有图片结果的终端回退信息.',
    ['image/png'],
  ],
] as const;

export const futureScenes = designs.map(([id, title, note, tokens]) => {
  const source = catalogScenes.find(scene => scene.name === `catalog-${id}`);
  if (!source) throw new Error(`Missing current-output evidence for ${id}`);
  return {
    name: `future-${id}` as const,
    title,
    note,
    tokens,
    category: source.category,
    source: source.name,
  };
});

export const futureOverviews = [
  {
    name: 'future-overview-read',
    title: '完整会话 · 定位问题',
    note: '消息、检索与代码共用同一视觉层级.',
    tokens: ['Review the pagination boundary', 'previousIds'],
  },
  {
    name: 'future-overview-edit',
    title: '完整会话 · 修改与验证',
    note: '读取修改结果, 再看测试证据.',
    tokens: ['unique', '8 pass'],
  },
  {
    name: 'future-overview-web',
    title: '完整会话 · Web 研究',
    note: '现有 Web 工具换成可阅读的会话样式.',
    tokens: ['pagination', 'Pagination notes'],
  },
  {
    name: 'future-overview-failure',
    title: '完整会话 · 失败与继续',
    note: '失败保留在发生的位置, 后续说明紧跟结果.',
    tokens: ['FAIL skips', 'previousIds'],
  },
] as const;

export function getFutureItems(name: string): readonly CatalogItem[] {
  const scene = futureScenes.find(item => item.name === name);
  if (scene) return getCatalogScene(scene.source);
  const items = (source: string) => getCatalogScene(`catalog-${source}`);
  switch (name) {
    case 'future-overview-read':
      return [
        ...items('user-markdown'),
        ...items('assistant-thinking-collapsed'),
        ...items('tool-grep'),
        ...items('tool-read'),
      ];
    case 'future-overview-edit':
      return [
        ...items('tool-edit'),
        ...items('tool-bash-states').slice(1, 2),
        ...items('assistant-markdown'),
      ];
    case 'future-overview-web':
      return [
        {
          kind: 'user',
          text: 'Find the cursor pagination reference and read its guidance.',
        },
        ...items('web-search'),
        ...items('web-content'),
      ];
    case 'future-overview-failure':
      return [
        ...items('tool-bash-states').slice(2),
        ...items('assistant-thinking-expanded'),
        ...items('tool-read'),
      ];
    default:
      throw new Error(`Unknown future UI scene: ${name}`);
  }
}
