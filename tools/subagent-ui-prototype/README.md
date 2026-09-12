# Subagent UI prototype

Throwaway design artifact for [issue #49](https://github.com/jczhang02/pi-stuff/issues/49), retained on `codex/prototype-subagent-ui` and draft [PR #52](https://github.com/jczhang02/pi-stuff/pull/52). Do not merge it into main or promote its simulated task logic to production.

The maintainer selected Arhen's `pi-core-subagent` as the future fork source and confirmed three UI behaviors: selecting an agent opens its full conversation, other agents keep working, and completed agents can continue their original conversations. The prototype exercises these behaviors in the actual Pi host. It does not import Arhen's runtime.

## Run and join

From this worktree, with the pinned Bun 1.4.0 dependencies installed:

```sh
bun tools/subagent-ui-prototype/run.ts --variant=A --theme=light
```

Use `--theme=dark` for a dark canvas, or `--theme=auto` (the default) for Pi's built-in `light/dark` detection. Automatic detection depends on the terminal providing a color-scheme/background response or a `COLORFGBG` hint; without one, Pi falls back to dark. Explicit selection works even when a terminal relay cannot convey the outer terminal's theme. F2, then `t`, switches light/dark during the demo; F2 returns to input. This prototype supports the two bundled themes, not arbitrary custom palettes.

The host defaults to `/opt/bin/pi`; `PI_PROTOTYPE_HOST` can select a compatible executable. The launcher uses an isolated temporary directory, ephemeral Pi session, offline startup, disabled tools, and no discovered extensions, skills, prompts, themes or context files. Only this extension loads. It passes terminal color hints but no shell provider credentials. Temporary launch data is removed after normal host exit.

Start a shared terminal, or attach to the revision already running under this name:

```sh
bun run tui -s subagent-ui-prototype-v2 --cols 116 --rows 44 --background -- bun tools/subagent-ui-prototype/run.ts --variant=A --theme=light
bun run tui attach -s subagent-ui-prototype-v2
```

The original session used the name `subagent-ui-prototype`. The shared relay later received SIGTERM and its sessions ended; the revision was relaunched as `subagent-ui-prototype-v2`. Joining an existing session does not reload its code. Use the direct command if a shared session is no longer available.

## What is faithful, and what is simulated

| Surface                     | Implementation and limit                                                                                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User and assistant messages | Pi's `UserMessageComponent` and `AssistantMessageComponent`, including its spacing and Markdown rendering.                                                                                                                                          |
| Tool cards                  | Pi's `ToolExecutionComponent` with the built-in read/bash renderers: syntax highlighting, collapsed output, expansion, pending/success/error backgrounds and running duration. No tool `execute` method is called.                                  |
| Input                       | Pi's `CustomEditor` with the host's keybinding manager. Input routes to the selected in-memory agent. Native editing is present; model selection, slash commands, image input and the full Pi session command set are not wired.                    |
| Fleet and navigation        | Proposed custom UI: three layouts, full selected conversation, per-agent draft/history, background status and return controls. This remains a design choice for review.                                                                             |
| Execution                   | A deterministic 200ms fixture playback emits incremental assistant text, partial tool output, failure/success and completion. Commands, paths, code, test outcomes, elapsed values and replies are sample data, not findings about this repository. |

The previous revision used generic Markdown and hand-built tool rows. It was sufficient to try navigation but insufficient to judge native Pi presentation. This revision uses the actual host components for that purpose. It can support a decision about layout, visual density and core interaction; it does not prove live parent/child execution, notification delivery or recovery.

## Try the flow

1. Enter `reviewer`. Watch assistant text appear progressively, then a Bash card accumulate test output. This sample round finishes after about 18 seconds with one deliberately failing test. The simulated main agent continues in the background.
2. Use Ctrl+O to expand tool cards. The read result shows highlighted TypeScript; the Bash result shows the full failure output.
3. Type without submitting, return with Esc, and re-enter. The unsent draft remains. Submit during a running round: your message appears in this conversation and is handled by the next fixture round after current work ends. Automatic completion notices never enter a visible `Follow-up:` queue.
4. Enter `tester`, which is waiting for input, and reply. Enter completed `explorer` and send another request. Both start playback in their existing conversations.
5. PgUp/PgDn browse history; Ctrl+End returns to the latest messages. Ctrl+X and `y` stop current playback and preserve the conversation; other agents continue.
6. Esc returns to the fleet. `m` opens the simulated main agent. Esc in the fleet or Ctrl+Q closes the overlay and returns to isolated Pi. `/fleet-prototype` opens a fresh demo; Ctrl+C twice exits Pi when its editor is empty.

F2 focuses the prototype controls. Left/right select A (compact list), B (grouped by status), or C (list with preview). `t` switches theme; `r` replays from the initial scenario. Press F2 to return to normal navigation/input. The three layouts share state and open the same conversation view; C stacks the preview below the list in a narrow terminal. Launch with `--variant=B` or `--variant=C` to select either directly.

## Theme diagnosis and evidence

The reported light-terminal screenshot combined three behaviors: the launcher omitted `COLORFGBG`/`COLORTERM`, Pi fell back to a dark theme, and uncolored body text reached Tuistory's fixed `#d4d4d4` default foreground while the background remained transparent. Changing the launcher's color environment alone left body contrast at 1.31:1 through actual attach.

The revision preserves the hints, selects the native theme explicitly or automatically, applies the theme's semantic text color, and fills the canvas. Its two canvas colors are Pi 0.85.1's bundled `export.pageBg` values; native component backgrounds remain intact. ANSI resets inside components restore the canvas colors rather than the relay defaults.

| Actual attach body sample                            | Foreground | Background | Contrast |
| ---------------------------------------------------- | ---------- | ---------- | -------- |
| Previous revision over the reported light background | `#d4d4d4`  | `#eff1f5`  | 1.31:1   |
| Revised light                                        | `#1f2328`  | `#f8f8f8`  | 14.88:1  |
| Revised dark                                         | `#d4d4d4`  | `#18181e`  | 11.92:1  |

These are measurements of body text, not a claim that every color in Pi's bundled palettes meets a contrast standard. The sampled foreground/background came from terminal cells after a real Tuistory attach render, not merely from screenshot-export color options. Light → dark → light switching was also checked. With `TERM=xterm-256color`, changing `COLORFGBG` between `0;15` and `15;0` selected light and dark respectively; `screen-256color` with the light hint also selected light.

Exercised on Linux with the maintainer's compiled Pi 0.85.1, Bun 1.4.0 and repository Tuistory 0.11.0. Verified native streaming and tool state colors, drafts, user input during playback, background progress, waiting/completed continuation, stopping, tool expansion, scroll controls, themes, fleet variants, narrow/minimum sizes, and normal host command input after closing. Repository checks: `bun run check` and `git diff --check`. Temporary terminal probes were used for verification; this throwaway artifact adds no test suite.

Actual terminal captures: [light conversation](evidence/conversation.png), [dark conversation](evidence/conversation-dark.png), [streaming tool](evidence/streaming.png), [expanded code](evidence/expanded.png), [fleet A](evidence/fleet-a.png), [fleet B](evidence/fleet-b.png), [fleet C](evidence/fleet-c.png), [narrow view](evidence/narrow.png).

The maintainer has not accepted a final fleet layout or the revised UI. Live model behavior, real child processes, parent/child context transfer, restart recovery and other terminal platforms remain unverified.

## 中文说明

这是 [Issue #49](https://github.com/jczhang02/pi-stuff/issues/49) 的一次性 UI 原型，保留在 `codex/prototype-subagent-ui` 分支和草稿 [PR #52](https://github.com/jczhang02/pi-stuff/pull/52)，不合入 main。后续正式 fork 已选定 Arhen 的 `pi-core-subagent`，本原型没有导入其运行时。

已确认的交互：选中代理后进入完整对话；其他代理继续运行；已完成代理可以在原对话中继续交流。上一版只适合试导航，手写的消息和工具行不足以判断 Pi 的真实呈现。这一版改用 Pi 原生用户消息、助手消息、工具卡片和 `CustomEditor`，工具显示来自内置 read/bash 渲染器，可以判断布局、信息密度和核心操作。

任务执行仍是每 200ms 推进的本地演示事件。回复、命令、代码、路径、测试结果和计时都是样例，不是对当前仓库的检查结论；不会调用模型，也不会执行卡片里的命令。输入发送给当前模拟代理，运行中收到的消息会在当前轮结束后继续处理。原生编辑操作可用，但斜杠命令、模型选择、图片输入等完整 Pi 会话功能尚未接入。

在此 worktree 使用上方命令运行或加入 `subagent-ui-prototype-v2`。旧会话名是 `subagent-ui-prototype`。共享终端服务随后收到 SIGTERM，原有会话已结束；修订版重新启动为 `subagent-ui-prototype-v2`。重新 attach 不会重载代码；共享会话不在时可以直接运行上方命令。浅色终端建议先用 `--theme=light`；`--theme=dark` 明确选择深色，默认 `--theme=auto` 使用 Pi 的 `light/dark` 自动检测。如果终端既不响应背景查询，也没有 `COLORFGBG`，Pi 会回退到深色。F2、`t`、F2 可以手动切换。本原型只支持内置浅色与深色主题。

启动器使用隔离临时目录和临时 Pi 会话，只加载原型扩展，关闭工具、自动资源加载和启动联网。保留终端颜色信息，不传入模型凭据；宿主正常退出后清理临时启动数据。宿主默认 `/opt/bin/pi`，可通过 `PI_PROTOTYPE_HOST` 指定兼容程序。

| 按键                  | 操作                                   |
| --------------------- | -------------------------------------- |
| ↑ / ↓，Enter          | 选择并进入代理                         |
| 输入文字，Enter       | 向当前代理提交消息，触发或继续本地演示 |
| Ctrl+O                | 展开/收起原生工具卡片                  |
| PgUp / PgDn，Ctrl+End | 浏览历史，回到最新                     |
| Ctrl+X，y             | 停止当前代理的演示，保留内容           |
| Esc                   | 从对话返回列表；从列表返回隔离 Pi      |
| m                     | 从列表进入模拟主代理                   |
| F2，← / →             | 聚焦演示控制，切换 A/B/C 布局          |
| F2，t，F2             | 切换浅色/深色主题并返回输入            |
| F2，r，F2             | 从初始状态重播                         |
| Ctrl+Q                | 关闭原型，返回隔离 Pi                  |

先进入 reviewer 观察文字逐步出现、Bash 输出增加，以及约 18 秒后出现的失败卡片；失败是特意安排的样例。Ctrl+O 可以查看完整输出与高亮代码。输入草稿后返回再进入，草稿保留；tester 等待输入，explorer 已完成，两者都能继续原对话。A 为紧凑列表，B 按状态分组，C 为列表加预览，窄终端中上下排列。返回 Pi 后用 `/fleet-prototype` 打开新场景，空编辑器中两次 Ctrl+C 退出宿主。自动完成通知不进入可见的 `Follow-up:` 队列。

浅色问题来自启动器丢失颜色信息与 Tuistory 默认文字色的叠加。只修正启动环境，正文对比度仍为 1.31:1。现在明确使用 Pi 的语义文字色并绘制完整画布，保留工具卡片原有背景；画布颜色取自 Pi 0.85.1 内置主题的 `export.pageBg`。真实 attach 的正文对比度为浅色 14.88:1、深色 11.92:1，也检查了浅 → 深 → 浅切换。这些数字只针对抽样正文，不代表内置主题所有颜色都达到同一标准。保持 `TERM=xterm-256color`，仅改变 `COLORFGBG` 即可选中浅/深主题；`screen-256color` 配合浅色提示也正常。

实际环境：Linux、维护者编译的 Pi 0.85.1、Bun 1.4.0、Tuistory 0.11.0。检查了原生流式呈现、工具运行与失败颜色、草稿、运行中输入、后台推进、等待/完成后继续、停止、展开、滚动、主题、三种布局、窄窗口与最小尺寸，以及关闭原型后宿主命令输入。执行 `bun run check` 和 `git diff --check`；使用临时终端脚本验证，不给一次性原型添加测试套件。上方链接均为真实终端截图。

最终列表布局和修订后的 UI 尚待维护者验收。真实模型行为、子进程调度、父子上下文传递、重启恢复及其他终端平台仍未验证。
