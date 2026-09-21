# Pi Stuff conversation prototype

[UI spec](../../docs/ui-spec.md) · [中文 UI spec](../../docs/i18n/zh-CN/ui-spec.md) · [Research](../../docs/research/README.md) · [中文 research](../../docs/i18n/zh-CN/research/README.md) · [All captures / 全部截图](captures/README.md)

This is the runnable, offline prototype for issue #101 and draft PR #102. Current design rules and selected screenshots live in the UI spec. This directory owns its welcome renderer, fixtures, interaction code and verification tools. No production entrypoint loads it.

这是 #101 / 草稿 PR #102 的可运行离线原型. 当前设计规则与精选截图统一在 UI spec. 本目录包含欢迎页、样例、交互代码及验证工具, 生产入口不加载.

## Run / 启动

From the `codex/ui-session-prototype` worktree, with pinned Bun 1.4.0 dependencies installed:

```sh
bun prototypes/ui-session/run.ts --theme catppuccin-latte
```

Press Enter for the first turn, then submit `补充页内重复和全空过滤页, 展示完整测试结果.` for the second. Esc interrupts, a new submission resumes; input during execution first interrupts the current response. Later submissions after the second turn recap retained results. Empty editor + Ctrl+D exits and cleans temporary state.

按 Enter 执行第一轮, 完成后提交上述请求进入第二轮. Esc 中断, 再提交恢复; 运行中提交先中断当前回答. 两轮后仅回顾既有结果. 空输入框按 Ctrl+D 退出并清理临时状态.

```sh
bun prototypes/ui-session/run.ts investigate --theme catppuccin-latte
bun prototypes/ui-session/run.ts web --theme catppuccin-mocha --name pi-ui-web
bun prototypes/ui-session/run.ts replay --theme catppuccin-latte
bun run tui show pi-ui-session
bun run tui stop pi-ui-session
```

Click a group, tool or Thoughts to toggle that entry. Ctrl+O toggles tools only; native Ctrl+T or /settings controls Hide thinking. Drafts and native history scrolling remain available. Resize the outer terminal for foreground reflow; Terminal Control CLI resize does not resize a foreground run.

点击组、工具或 Thoughts 切换单项. Ctrl+O 只切换工具, 原生 Ctrl+T 或 /settings 控制 Hide thinking. 保留草稿与原生历史滚动. 前台缩放需调整外层终端, CLI resize 不调整 foreground run.

## Scenes / 场景

| Name                            | Question                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `live`, `live-error`            | Do submission, continuous grouping, error recovery, interruption, follow-up and long-history navigation work? |
| `session`                       | How does the entire compact conversation read?                                                                |
| `welcome`                       | Does the retained old welcome fit?                                                                            |
| `investigate`                   | Can a grouped exploration expand into individually inspectable calls?                                         |
| `folding`                       | Do expanded children align while Thoughts and failures retain independent positions?                          |
| `tools`                         | Do Read/Grep/Find/Ls share one summary and retain inspectable children?                                       |
| `web`                           | Do successful Web actions join retrieval while retaining their semantic names on expansion?                   |
| `changes`                       | Are changes visible while Write folds and Bash retains three output rows?                                     |
| `long-diff`                     | Are context, true changes, hidden rows and the full long target preserved?                                    |
| `running`                       | Is the active operation clear with a two-row tail?                                                            |
| `failures`                      | Are no matches, missing files, failed Web requests and failed tests distinct?                                 |
| `long-output`                   | Is UI folding distinct from upstream output truncation?                                                       |
| `thoughts`                      | Does Hide thinking control the default, with independent mouse disclosure?                                    |
| `thoughts-visible`              | Capture with Hide thinking disabled; foreground launch still inherits your own setting.                       |
| `interrupted`, `response-error` | Are response statuses plain text?                                                                             |
| `empty`                         | Are no output, command cancellation and image fallback honest?                                                |
| `replay`                        | Does execution settle into compact output, and does Esc stop it?                                              |

## Environment and limits / 环境与边界

Pi 0.85.1 / Bun 1.4.0 / Terminal Control 1.2.1. The launcher inherits Pi theme and hideThinkingBlock, supports Catppuccin Latte/Mocha, and requires an explicit supported theme for other/automatic themes. It emits no terminal palette setters or resets and does not change Ghostty configuration. Isolated settings, working and session directories are deleted on exit. Only headless captures set their own PTY palette.

启动继承 Pi theme 与 hideThinkingBlock, 支持 Catppuccin Latte/Mocha, 其他或自动主题须显式指定受支持主题. 不发送终端配色设置或重置指令, 不修改 Ghostty. 隔离配置、工作与会话目录在退出后删除, 只有无头截图设置自己的 PTY 配色.

The editor, display, mouse, scrolling, timers and cancellation controls run in real Pi. Model replies, tools, Web pages, tests, labels and timings are fixed samples. This is not arbitrary language understanding, real provider execution, a general diff algorithm, production persistence or native desktop-compositor acceptance. Native aborted presentation is reused; provider/tool cancellation remains simulated.

编辑器、显示、鼠标、滚动、计时和取消控制在真实 Pi 中运行. 模型回复、工具、网页、测试、标签及耗时为固定样例. 不代表任意自然语言理解、真实提供方执行、通用 diff 算法、生产持久化或原生桌面验收. 中断复用原生展示, 提供方/工具取消仍为模拟.

## Capture and verification / 截图与验证

```sh
bun prototypes/ui-session/capture.ts welcome
bun prototypes/ui-session/capture.ts investigate --interact
bun prototypes/ui-session/capture.ts live --cancel
bun prototypes/ui-session/capture.ts live-error --cols 80 --theme catppuccin-mocha
bun prototypes/ui-session/capture.ts long-diff --interact --cols 80 --theme catppuccin-mocha
bun prototypes/ui-session/capture.ts replay --cancel
bun prototypes/ui-session/verify-foreground.ts
bun run check
git diff --check
```

The foreground verifier's inherited-theme case requires supported Pi settings; use disposable Catppuccin settings if the host uses another theme. The capture driver checks text, palette, clipping and selected interactions, exports PNG/ANSI/TXT and closes owned sessions. Update the Markdown capture appendix when adding states. No HTML generator is retained.

前台验证的继承主题场景要求受支持的 Pi 设置; 宿主使用其他主题时用临时 Catppuccin 设置验证. 截图驱动检查文本、配色、裁切和所选交互, 导出 PNG/ANSI/TXT 后关闭自建会话. 新增状态后更新 Markdown 截图附录. 不再保留 HTML 生成器.

Export font: `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`.
