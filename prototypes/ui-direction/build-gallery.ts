// Regenerate the static review gallery from the retained terminal scenes.
import {join} from 'node:path';
import {Effect} from 'effect';
import {catalogScenes} from './catalog-scenes';
import {hostScenes} from './catalog-host-scenes';
import {futureScenes} from './future-scenes';
const allCatalogScenes = [...catalogScenes, ...hostScenes];

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
function card(stem: string, title: string, note: string): string {
  const path = `captures/${stem}`;
  return `<figure><figcaption><h3>${escapeHtml(title)}</h3><p>${escapeHtml(note)}</p></figcaption><a href="${path}.png" target="_blank" rel="noopener"><img src="${path}.png" alt="${escapeHtml(title)}" loading="lazy"></a><p class="evidence"><a href="${path}.png">原图</a> · <a href="${path}.txt">终端文本</a> · <a href="${path}.ansi">ANSI</a></p></figure>`;
}
const variants = [
  [
    'unified',
    'A · 统一 diff',
    '双行号与增删符号保留变化方向, 正文按 TypeScript 高亮, 新逻辑下划线强调.',
  ],
  [
    'split',
    'B · 左右对照',
    '同一修改左右对照, 长行在各栏内换行. 小于 110 列回退为统一 diff.',
  ],
  [
    'paired',
    'C · 前后代码块',
    '先看修改前, 再看修改后. 两块保留语法高亮, 仅实际变更行标注增删.',
  ],
] as const;
const variantCards = variants
  .map(
    ([name, title, note]) =>
      `<article id="diff-${name}"><h2>${title}</h2><p>${note}</p><div class="grid">${card(`diff-${name}-catppuccin-latte-120x40-main`, '浅色 · 120 列', '同一文件、同一修改、同一会话.')} ${card(`diff-${name}-catppuccin-mocha-120x40-main`, '深色 · 120 列', '语法颜色与增删方向分开.')} ${card(`diff-${name}-catppuccin-latte-80x40-main`, '窄屏 · 80 列', '检查换行与缩进, 不裁掉代码.')}</div></article>`,
  )
  .join('\n');
const categories = [
  'conversation',
  'built-in tools',
  'Web',
  'RTK',
  'shell',
  'session summaries',
  'notices',
  'media',
  'optional extension output',
  'conditional host output',
  'adjacent live activity',
  'conditional appendix',
];
const catalogCards = categories
  .map(
    (category, index) =>
      `<article id="catalog-${index}"><h2>${escapeHtml(category)}</h2><div class="grid">${allCatalogScenes
        .filter(scene => scene.category === category)
        .map(scene =>
          card(
            `${scene.name}-catppuccin-latte-120x40-main`,
            scene.title,
            scene.source,
          ),
        )
        .join('\n')}</div></article>`,
  )
  .join('\n');
const existing = [
  [
    'welcome-catppuccin-latte-120x40-main',
    '欢迎页',
    '沿用 pi-stuff-old 的欢迎框.',
  ],
  [
    'work-catppuccin-mocha-120x40-main',
    '会话内工具',
    '旧版前缀, Read 代码按语法高亮.',
  ],
  [
    'failure-catppuccin-latte-120x40-main',
    '失败与恢复',
    '保留失败结果和下一步.',
  ],
  [
    'complete-catppuccin-latte-120x40-main',
    '完成总结',
    'Markdown 与原生输入框.',
  ],
  [
    'work-narrow-catppuccin-mocha-80x30-main',
    '窄窗口',
    '80 列下的正文和工具换行.',
  ],
  [
    'welcome-catppuccin-latte-120x40-ui-settings',
    '显示设置',
    '工具展开设置, 无独立工具检查器.',
  ],
] as const;
const sharedStyle = `<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#faf9f6;color:#24252b;font:16px/1.7 system-ui,sans-serif}main{max-width:1540px;margin:auto;padding:40px 28px}header{max-width:1000px}h1{font-size:32px;line-height:1.3}h2{font-size:24px;margin:0 0 10px}h3{font-size:18px;margin:0}p{margin:8px 0 16px}a{color:#59419a;text-underline-offset:3px}nav{display:flex;gap:12px 24px;flex-wrap:wrap;margin:20px 0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}figure{margin:0;min-width:0}figure p{font-size:14px;color:#62636c}img{display:block;width:100%;height:auto;border:1px solid #dddce1;border-radius:6px}article{padding:28px 0;border-top:1px solid #dddce1;scroll-margin-top:16px}.section{margin-top:50px}.evidence{margin-top:8px}footer{margin-top:40px;padding-top:20px;border-top:1px solid #dddce1;color:#62636c;font-size:14px}@media(max-width:950px){.grid{grid-template-columns:1fr}main{padding:24px 16px}}
</style>`;
const referenceHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pi Stuff · Conversation 与 diff 对照</title>${sharedStyle}<main><header><h1>当前样式 · 研究参考</h1><p><a href="gallery.html">返回未来 UI 预览</a></p><p>先确认当前产品会显示什么, 再比较新的 edit/diff 样式. 原生目录使用当前 Pi / Pi Stuff 的组件和示例数据; A/B/C 是待讨论的设计候选, 没有改变生产入口.</p><p>图片来自真实 Pi 0.85.1 终端运行. 点击查看原始尺寸. 页面说明属于评审材料, 不占用被评估的终端界面.</p><nav><a href="#diff-unified">A 统一 diff</a><a href="#diff-split">B 左右对照</a><a href="#diff-paired">C 前后代码块</a><a href="#current">当前 conversation 清单</a><a href="#shell">保留的整体预览</a></nav><nav><a href="../../docs/i18n/zh-CN/research/conversation-coverage-2026-09-20.md">逐项覆盖与研究依据</a><a href="README.md">运行与验证边界</a></nav></header><section>${variantCards}</section><section class="section" id="current"><h1>当前 conversation · 逐项配图</h1><p>以下按原生消息、工具、当前扩展、条件宿主内容分类. 图注区分直接调用的原生组件与宿主内部样式复现; 旧版独有和尚未实现的功能不计入. 网络、模型和命令结果为隔离样例. 已存在的诊断提示仍列出, 不重新设计通知功能.</p><nav>${categories.map((category, index) => `<a href="#catalog-${index}">${escapeHtml(category)}</a>`).join('')}</nav>${catalogCards}</section><section class="section" id="shell"><h1>保留的整体预览</h1><div class="grid">${existing.map(([stem, title, note]) => card(stem, title, note)).join('\n')}</div></section><footer>Pi 0.85.1 · Bun 1.4.0 · Catppuccin Latte / Mocha.<br>Font: JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono.<br>真实终端导出, 示例执行. 未验证原生窗口 compositor 或真实 provider. 详情沿用 Pi 原生单工具点击展开的能力, 本次静态目录未验收鼠标事件, 无独立工具检查器.</footer></main></html>`;
const futureGroups = [
  ['built-in tools', '文件与执行工具'],
  ['Web', 'Web 工具'],
  ['RTK', 'RTK'],
  ['conversation', '用户与 Assistant'],
  ['shell', '直接 Shell'],
  ['session summaries', '已有摘要与 Skill 消息'],
  ['notices', '已有诊断提示'],
  ['media', '工具图片回退'],
] as const;
const futureCards = futureGroups
  .map(
    ([category, title], index) =>
      `<article id="future-group-${index}"><h2>${title}</h2><div class="grid">${futureScenes
        .filter(scene => scene.category === category)
        .map(scene =>
          card(
            `${scene.name}-catppuccin-latte-120x40-main`,
            scene.title,
            scene.note,
          ),
        )
        .join('')}</div></article>`,
  )
  .join('');
const overviewCards = [
  [
    'welcome-catppuccin-latte-120x40-main',
    '欢迎页',
    '以 pi-stuff-old 的欢迎框为基础.',
  ],
  [
    'future-overview-read-catppuccin-latte-120x40-main',
    '定位问题',
    '用户消息、Thinking、检索与代码一起阅读.',
  ],
  [
    'future-overview-edit-catppuccin-mocha-120x40-main',
    '修改与验证',
    '语法高亮、增删方向和执行结果分层呈现.',
  ],
  [
    'future-overview-web-catppuccin-latte-120x40-main',
    'Web 研究',
    '查询和网页正文优先, 保留分页元数据.',
  ],
  [
    'future-overview-failure-catppuccin-latte-120x40-main',
    '失败后继续',
    '错误紧邻调用, 后续说明回到会话正文.',
  ],
  [
    'future-overview-read-catppuccin-mocha-80x40-main',
    '窄屏 · 80 列',
    '相同内容自动换行, 左侧位置列随宽度收缩.',
  ],
] as const;
const futureHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pi Stuff · 未来 UI 预览</title>${sharedStyle}<main><header><h1>Pi Stuff · 未来 UI 预览</h1><p>这些图展示当前已有功能换成新 UI 后的样子. 整套方案沿用旧版欢迎页、消息前缀与工具层级, 将单行工具扩展为可阅读的结果和代码. 以下均为设计预览.</p><p>先看完整会话, 再逐类查看工具和消息. 三种 diff 保留为待比较方案, 尚未选定.</p><nav><a href="#overview">完整会话</a><a href="#future-group-0">工具新样式</a><a href="#future-group-3">消息新样式</a><a href="#diffs">Diff A / B / C</a><a href="current-reference.html">当前样式参考</a></nav><nav><a href="../../docs/i18n/zh-CN/research/future-ui-2026-09-21.md">范围与逐项对应</a><a href="README.md">运行说明</a></nav></header><section id="overview"><h2>完整会话</h2><div class="grid">${overviewCards.map(([stem, title, note]) => card(stem, title, note)).join('')}</div></section><section class="section"><h1>逐类新样式</h1><p>每张图对应当前输出清单中的一种展示状态, 使用同一套新消息前缀、间距和工具结果层级. 原生对照放在独立参考页.</p><nav>${futureGroups.map(([, title], index) => `<a href="#future-group-${index}">${title}</a>`).join('')}</nav>${futureCards}</section><section class="section" id="diffs"><h1>Diff · 三种候选</h1><p>三种方案比较相同改动, 均保留语法颜色. 这里只比较 diff 结构, 不预先决定采用哪一种.</p>${variantCards}</section><footer>离线样例在真实 Pi 0.85.1 中渲染, 未接入生产消息或工具执行. 工具详情在会话内展开, 无独立检查器. 不增加 Todo、Agents、Goal、后台任务、BTW 或会话命名功能. 条件宿主公告和可选扩展能力只保留在参考页.<br>Catppuccin Latte / Mocha · JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono.</footer></main></html>`;
await Effect.runPromise(
  Effect.tryPromise({
    try: async () => {
      await Bun.write(
        join(import.meta.dir, 'current-reference.html'),
        referenceHtml,
      );
      await Bun.write(join(import.meta.dir, 'gallery.html'), futureHtml);
    },
    catch: error => (error instanceof Error ? error : new Error(String(error))),
  }),
);
