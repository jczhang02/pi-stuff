# Compact conversation TUI prototype

[Gallery](gallery.html) · [Claude UI details, 09-22](detail-reference/index.html) · [Rules and sources](../../docs/research/ui-session-prototype-2026-09-21.md) · [中文规则](../../docs/i18n/zh-CN/research/ui-session-prototype-2026-09-21.md)

This isolated, throwaway prototype answers the five UI corrections in [#101](https://github.com/jczhang02/pi-stuff/issues/101). It starts from `d8ff7be` on a new `codex/ui-session-prototype` worktree. Previous previews are retained. Nothing loads this directory from the production entrypoint.

## Run

From the new worktree, with pinned Bun 1.4.0 dependencies installed:

```sh
bun prototypes/ui-session/run.ts
```

The default `live` scene begins at the retained welcome screen with an editable pagination request. Press Enter to run the first turn. After completion, submit `补充页内重复和全空过滤页, 展示完整测试结果.` for the second turn. Esc interrupts; a new submission resumes the interrupted step. Submitting during execution interrupts that response and resumes under the new user turn. Completed work remains in the transcript. After two completed turns, later submissions recap the retained result without claiming another tool run.

The responses follow this fixed two-turn script, not arbitrary language understanding. Input, streaming presentation, disclosure, cancellation, continuation and scrolling are real interactions. `live-error` injects one HTTP 503 before the first turn; submit again to retry. The older `session` scene remains a static overview.

The launcher inherits the concrete `theme` and `hideThinkingBlock` fields from the current Pi agent settings. It supports the bundled Catppuccin Latte/Mocha themes; use `--theme` explicitly when settings are absent or use another theme or automatic pair. It never sends terminal palette setters or resets. Screenshot palette commands run only inside the separate headless capture PTY. It does not change Ghostty configuration or runtime default colors. A terminal previously recolored by the old launcher may need its theme reloaded separately; this launcher does not overwrite that existing state.

The launcher uses the pinned Terminal Control foreground `run` command, named `pi-ui-session`, so the screen is shared from startup. It creates temporary Pi settings, session and working directories; exiting deletes them. No model account, network provider or real shell tool is used. Use an empty editor and Ctrl+D to exit. The terminal's live font comes from its settings; PNG exports use the explicitly pinned font stack in `launch.ts`.

```sh
# A shorter starting point for click exploration.
bun prototypes/ui-session/run.ts investigate
# Dynamic thinking -> running -> completion. Esc cancels.
bun prototypes/ui-session/run.ts replay
# Separate session names can coexist.
bun prototypes/ui-session/run.ts web --theme catppuccin-latte --name pi-ui-web
# Inspect or drive the foreground session from another terminal.
bun run tui show pi-ui-session
bun run tui send pi-ui-session ctrl-o
bun run tui stop pi-ui-session
```

Click a tool for its full retained output. Click the activity summary to reveal compact children, then click one child to inspect it. Thoughts defaults follow Pi Hide thinking and can be clicked independently. Native Ctrl+T or /settings updates that default; Ctrl+O toggles tool detail; input stays editable. Pi's native scroll controls navigate the complete conversation. Resizing the outer foreground terminal updates the child; the CLI's `resize` command does not resize foreground `run` sessions.

User messages use Pi 0.85.1's exported `UserMessageComponent` with its native background, padding and Markdown behavior. The prototype does not install a footer; Pi renders the real isolated session status, including the `preview` model and context usage. These surfaces are outside the redesign. Esc interruption now also reuses the native `AssistantMessageComponent` aborted state, including its `Operation aborted` text, error color and padding. The offline timeline still simulates cancellation; this is native presentation, not a real provider abort.

Thoughts uses a muted leading dot in both states. Hidden: `• Thoughts for 4s`. Visible: `• Thoughts: The cursor already...  4s`, with the prefix and upright Markdown body on the same line; continuation lines align with message text. There is no separate heading or container. Compare the gallery's `Thoughts · hidden` and `Thoughts · no hidden` sections: captures set the isolated Pi preference explicitly. Foreground launches still inherit your setting; Ctrl+T changes it only inside the temporary preview host.

The scenario is a pagination repair with coherent read, search, Web, edit, write and test steps. All results, Web pages, model labels and durations are samples. The replay has real elapsed animation but simulated execution. In static scenes, ordinary text submission returns the text to the editor. In live scenes, it drives the fixed offline script. Other native Pi commands are outside this preview's acceptance.

## Scenes

Pass a name as the first argument. Scene selection remains outside the evaluated UI.

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

The current [folding study](../../docs/research/claude-code-tool-folding-2026-09-21.md) separates real Claude observations from the selected prototype rules. Successful local and Web retrieval starts a one-line summary from the first call. Expanded children align with ordinary tool rows. Thoughts stays independent and follows Pi hideThinkingBlock; visible prose, user turns, Thoughts, ordinary Bash, writes, failures, cancellation and warnings separate groups. Running calls remain visible until success. Bash retains three output rows; Edit retains six changed rows with one line-number column, +/- signs, semantic backgrounds and syntax highlighting. Old and new source are highlighted separately. Activity summaries have no result connector.

## Capture and verification

```sh
bun prototypes/ui-session/verify-foreground.ts
bun prototypes/ui-session/capture.ts live --cancel
bun prototypes/ui-session/capture.ts live-error --cols 80 --theme catppuccin-mocha
bun prototypes/ui-session/capture.ts investigate --interact
bun prototypes/ui-session/capture.ts web --interact
bun prototypes/ui-session/capture.ts failures --interact
bun prototypes/ui-session/capture.ts long-diff --interact --cols 80 --theme catppuccin-mocha
bun prototypes/ui-session/capture.ts replay
bun prototypes/ui-session/capture.ts replay --cancel
bun prototypes/ui-session/build-gallery.ts
bun run check
git diff --check
```

`capture.ts` starts real Pi 0.85.1 under Bun with custom-message renderers, exports PNG/ANSI/text and closes the owned session and driver on all paths. It checks visible text, palette and cell clipping. Interactive cases preserve a Chinese editor draft through mouse disclosure and native Ctrl+O. Replay cancellation also waits past the would-be completion time. The foreground protocol probe also sends Kitty-encoded Escape to live and replay, in addition to legacy Escape. The screenshot index leaves test controls and explanations outside the evaluated TUI.

The evidence does not establish production message overrides, general diff generation, real providers/tools, image protocols, persistence/replay or a native desktop compositor. Diff rows are explicitly authored context/add/remove fixtures with true line numbers, not an implementation of a general diff algorithm. No production dependencies or entrypoints changed.

## 中文使用说明

在新 worktree 执行 `bun prototypes/ui-session/run.ts`, 即可进入连续交互会话. 欢迎页输入框有可编辑的分页请求, 按 Enter 启动第一轮; 完成后输入 "补充页内重复和全空过滤页, 展示完整测试结果." 进入第二轮. Esc 中断后再提交可继续未完成步骤, 运行中提交会先中断当前回答. 两轮完成后继续提交只回顾现有结果. `live-error` 首次提交会遇到 HTTP 503, 再提交可重试. `session` 保留静态总览. `investigate` 适合逐项点击, `web` 查看统一 Web 样式, `replay` 演示思考、执行和完成, 可按 Esc 中断. 其他场景名见上表. 空输入时 Ctrl+D 退出并清理临时目录.

用户消息直接复用 Pi 0.85.1 的原生 `UserMessageComponent`, 保留背景、留白和 Markdown 行为. 原型不再覆盖 footer, 状态栏由 Pi 显示隔离会话的实际信息, 包括 `preview` 模型和上下文用量. 这两部分不属于本轮改版. Esc 中断也复用原生 `AssistantMessageComponent` 的 aborted 状态, 保留 `Operation aborted` 文案、错误色和边距. 离线时间线仍模拟取消执行, 此处复用原生展示, 不代表真实提供方中断.

Thoughts 两种状态都保留灰色前导点. hidden 显示 `• Thoughts for 4s`; no hidden 显示 `• Thoughts: The cursor already...  4s`, 前缀与正体 Markdown 正文同一行, 续行与消息正文对齐, 不增加独立标题或容器. 画廊的 `Thoughts · hidden` 和 `Thoughts · no hidden` 分别在隔离 Pi 中设置对应默认值并截图. 前台启动仍继承你的设置, Ctrl+T 只修改临时原型环境.

点击活动摘要 展开调用清单, 再点一项看正文; Thoughts 独立显示, 默认服从 Pi 的 Hide thinking, 点击可单独切换; 原生 Ctrl+T 或 /settings 修改默认显示, Ctrl+O 只切换工具详情. 输入框由 Pi 管理. 前台终端尺寸随外层终端变化, 完整会话用 Pi 原生滚动查看. 可在另一个终端用 `bun run tui show pi-ui-session` 检查同一会话.

执行、网页、模型标签、测试及耗时均为样例, 动态场景按实际计时播放. 静态场景的普通提交保留为草稿; 连续场景按固定两轮脚本响应, 不理解任意自然语言, 不调用模型. 本轮只验证原型展示和交互, 不代表生产实现已采纳. 截图来自真实终端输出, 配色和字体明确设置, 没有在图片上重绘界面.

交互启动继承当前 Pi 的 theme 与 hideThinkingBlock 字段, 支持内置的 Catppuccin Latte/Mocha; 没有设置或使用其他主题/自动主题对时, 请显式传入 `--theme`. 前台不会发送终端颜色设置或重置指令, 不修改 Ghostty 配置及动态默认颜色. 固定截图配色只作用于独立的无头 PTY. 旧启动器已经改变的终端颜色需要单独重新加载主题; 新启动器不会覆盖已有状态.
