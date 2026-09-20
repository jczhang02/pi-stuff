# Compact conversation TUI prototype

[Gallery](gallery.html) · [Rules and sources](../../docs/research/ui-session-prototype-2026-09-21.md) · [中文规则](../../docs/i18n/zh-CN/research/ui-session-prototype-2026-09-21.md)

This isolated, throwaway prototype answers the five UI corrections in [#101](https://github.com/jczhang02/pi-stuff/issues/101). It starts from `d8ff7be` on a new `codex/ui-session-prototype` worktree. Previous previews are retained. Nothing loads this directory from the production entrypoint.

## Run

From the new worktree, with pinned Bun 1.4.0 dependencies installed:

```sh
bun prototypes/ui-session/run.ts session
```

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

Click a tool for its full retained output. Click Explored to reveal compact children, then click one child to inspect it. Click Thoughts for its content. Ctrl+O toggles all detail; input stays editable. Pi's native scroll controls navigate the complete conversation. Resizing the outer foreground terminal updates the child; the CLI's `resize` command does not resize foreground `run` sessions.

The scenario is a pagination repair with coherent read, search, Web, edit, write and test steps. All results, Web pages, model labels and durations are samples. The replay has real elapsed animation but simulated execution. Ordinary text submission returns the text to the editor and does not start a coding request. Other native Pi commands are outside this preview's acceptance.

## Scenes

Pass a name as the first argument. Scene selection remains outside the evaluated UI.

| Name                            | Question                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `session`                       | How does the entire compact conversation read?                                  |
| `welcome`                       | Does the retained old welcome fit?                                              |
| `investigate`                   | Can a grouped exploration expand into individually inspectable calls?           |
| `tools`                         | Do standalone Read/Grep/Find/Ls keep the same two-line hierarchy?               |
| `web`                           | Do all current Web actions share a layout without exposing metadata by default? |
| `changes`                       | Are changes visible while Write and test output stay compact?                   |
| `long-diff`                     | Are context, true changes, hidden rows and the full long target preserved?      |
| `running`                       | Is the active operation clear with a two-row tail?                              |
| `failures`                      | Are no matches, missing files, failed Web requests and failed tests distinct?   |
| `long-output`                   | Is UI folding distinct from upstream output truncation?                         |
| `thoughts`                      | Does elapsed-time disclosure work without a tool card?                          |
| `interrupted`, `response-error` | Are response statuses plain text?                                               |
| `empty`                         | Are no output, command cancellation and image fallback honest?                  |
| `replay`                        | Does execution settle into compact output, and does Esc stop it?                |

## Capture and verification

```sh
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

`capture.ts` starts real Pi 0.85.1 under Bun with static custom-message renderers, exports PNG/ANSI/text and closes the owned session and driver on all paths. It checks visible text, palette and cell clipping. Interactive cases preserve a Chinese editor draft through mouse disclosure and native Ctrl+O. Replay cancellation also waits past the would-be completion time. The screenshot index leaves test controls and explanations outside the evaluated TUI.

The evidence does not establish production message overrides, general diff generation, real providers/tools, image protocols, persistence/replay or a native desktop compositor. Diff rows are explicitly authored context/add/remove fixtures with true line numbers, not an implementation of a general diff algorithm. No production dependencies or entrypoints changed.

## 中文使用说明

在新 worktree 执行 `bun prototypes/ui-session/run.ts session`, 即可进入共享的真实 Pi 终端. `investigate` 适合逐项点击, `web` 查看统一 Web 样式, `replay` 演示思考、执行和完成, 可按 Esc 中断. 其他场景名见上表. 空输入时 Ctrl+D 退出并清理临时目录.

点击 Explored 展开调用清单, 再点一项看正文; 点击 Thoughts 查看思考内容; Ctrl+O 切换全部详情. 输入框由 Pi 管理. 前台终端尺寸随外层终端变化, 完整会话用 Pi 原生滚动查看. 可在另一个终端用 `bun run tui show pi-ui-session` 检查同一会话.

执行、网页、模型标签、测试及耗时均为样例, 动态场景按实际计时播放. 普通提交保留为草稿, 不调用模型. 本轮只验证原型展示和交互, 不代表生产实现已采纳. 截图来自真实终端输出, 配色和字体明确设置, 没有在图片上重绘界面.
