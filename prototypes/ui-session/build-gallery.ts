// Screenshot index outside the evaluated TUI. Run after capture.ts.
import {readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {scenes} from './fixtures';
import {runEffect} from './launch';
const labels = {
  main: '默认状态',
  welcome: '欢迎页与可编辑请求',
  'response-failed': '回答失败后可重试',
  'group-growing': '执行中逐步聚合探索',
  'web-recovery': 'Web 失败与恢复',
  'first-complete': '第一轮完成',
  'edit-clicked': '会话中点击展开 Edit',
  'followup-complete': '第二轮完成',
  'expanded-tail': '展开工具后继续阅读回答',
  'output-scrolled': '向上滚动检查完整输出',
  'narrow-scrolled': '窄屏重新排版',
  'history-start': '返回会话开头',
  'group-open': '展开探索组',
  'read-open': '展开其中一个 Read',
  open: '展开 Thoughts',
  'fetch-open': '展开 WebFetch',
  'fetch-failed-open': '展开失败的 WebFetch',
  'write-open': '展开 Write',
  'keyboard-open': 'Ctrl+O 展开全部',
  thinking: '思考中',
  running: '执行中',
  completed: '完成并自动收起',
  cancelled: 'Esc 中断后',
};
const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
await runEffect(async () => {
  const files = await readdir(join(import.meta.dir, 'captures'));
  const sections = scenes.map(scene => {
    const images = files
      .filter(
        file =>
          file.startsWith(scene.name + '-catppuccin-') && file.endsWith('.png'),
      )
      .filter(
        file =>
          !file.includes('-restored.') && !file.includes('-group-closed.'),
      )
      .sort();
    const cards = images
      .map(file => {
        const match = /-catppuccin-(latte|mocha)-(\d+)-(.+)\.png$/u.exec(file);
        if (!match) throw new Error(`Unknown capture name ${file}`);
        const state = match[3] ?? '';
        if (state === 'keyboard-open' && scene.name !== 'long-diff') return '';
        const caption = `${Object.entries(labels).find(([key]) => key === state)?.[1] ?? state} · ${match[1] === 'latte' ? '浅色' : '深色'} · ${match[2]} 列`;
        const stem = file.slice(0, -4);
        return `<figure><figcaption>${escape(caption)}</figcaption><a href="captures/${file}"><img loading="lazy" src="captures/${file}" alt="${escape(scene.title + ' / ' + caption)}"></a><p><a href="captures/${stem}.txt">文本</a> · <a href="captures/${stem}.ansi">ANSI</a></p></figure>`;
      })
      .join('');
    return `<section id="${scene.name}"><h2>${escape(scene.title)}</h2><p>${escape(scene.note)}</p><code>bun prototypes/ui-session/run.ts ${scene.name}</code><div class="grid">${cards}</div></section>`;
  });
  const nav = scenes
    .map(s => `<a href="#${s.name}">${escape(s.title)}</a>`)
    .join('');
  await writeFile(
    join(import.meta.dir, 'gallery.html'),
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pi Stuff · 会话原型</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;background:#eff1f5;color:#4c4f69}body{max-width:1500px;margin:auto;padding:36px}h1{font-size:30px}h2{font-size:22px}p{line-height:1.7;max-width:1000px}a{color:#1e66f5}nav{display:flex;gap:10px;flex-wrap:wrap;margin:24px 0}nav a{padding:6px 10px;background:#e6e9ef;border-radius:6px;text-decoration:none}section{padding:24px 0;border-top:1px solid #bcc0cc}code{font:14px ui-monospace,monospace;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,600px),1fr));gap:20px;margin-top:20px}figure{margin:0}figcaption{font-weight:600;margin-bottom:8px}img{width:100%;height:auto;border-radius:10px;box-shadow:0 1px 8px #0001}figure p{font-size:13px;margin:8px 0}li{line-height:1.8}@media(prefers-color-scheme:dark){:root{background:#1e1e2e;color:#cdd6f4}nav a{background:#313244}a{color:#89b4fa}section{border-color:#45475a}}@media(max-width:650px){body{padding:20px}}
</style><h1>Pi Stuff · 会话原型</h1><p>以当前功能为范围, 在真实 Pi 中运行的新会话样式. 这里的图片来自可交互终端, 模型与执行数据是离线样例. <a href="README.md">启动与操作说明</a> · <a href="../../docs/i18n/zh-CN/research/ui-session-prototype-2026-09-21.md">来源与详细规则</a> · <a href="../ui-direction/gallery.html">上一轮方案</a></p><ul><li>Read/Grep/Find/Ls 连续成功两次起聚合. 点击组查看调用, 再点一项查看内容.</li><li>工具采用“操作与目标 / 结果”两层. Write、Web 和成功 Bash 默认收起, Edit 保留三行短 diff.</li><li>WebSearch / WebFetch / WebRead 共用相同样式; 元数据只在展开后显示.</li><li>Thoughts 显示耗时, 点击阅读正文. 回答失败或中断保持普通文字.</li></ul><nav>${nav}</nav>${sections.join('')}<footer><p>点击工具或 Thoughts 展开, Ctrl+O 切换全部详情. live 按 Enter 提交初始请求, 完成后再提交边界测试请求; Esc 中断后可继续. live-error 展示回答失败与重试. replay 保留短动态对照. 完整会话用 Pi 原生滚动查看. 截图使用 Catppuccin 与指定 Nerd Font 字体栈; 尚未生产采纳.</p></footer></html>`,
  );
});
