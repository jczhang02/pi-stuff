# Subagent Fleet UI prototype

A throwaway, offline prototype for [issue #49](https://github.com/jczhang02/pi-stuff/issues/49), retained on `codex/prototype-subagent-ui` and [draft PR #52](https://github.com/jczhang02/pi-stuff/pull/52). The production fork source remains Arhen's `pi-core-subagent`; this artifact does not import its runtime.

## Run

From this worktree:

```bash
bun tools/subagent-ui-prototype/run.ts --theme=light
```

Use `--theme=dark` or `--theme=auto` for the other theme modes. To join the shared demonstration:

```bash
bun run tui attach -s subagent-fleet-v3
```

If that session is absent, launch it:

```bash
bun run tui -s subagent-fleet-v3 --cols 125 --rows 38 --background -- bun tools/subagent-ui-prototype/run.ts --theme=light
```

F2 opens prototype controls: `t` switches theme, `r` resets sample work, and F2 returns to the editor. These controls are available from main. They are prototype controls, not Claude Code shortcuts. The previous three layout variants are replaced by the maintainer's selected single layout.

Return to main, clear its editor, and press Ctrl+D to exit the isolated host.

## Confirmed layout

The order is **conversation → editor → native Pi statusline → Fleet**. Each agent has one uniform row containing its status icon, name, current activity, input/output token counts and elapsed time. Selection changes the highlight, not the information shown. At 125 columns and wider, rows also include tools, turns and cost; narrower rows retain tokens and elapsed time and shorten activity first. The prototype needs at least 50 columns to display useful Fleet rows.

A spinner denotes running, `?` waiting for input, `✓` completed and `■` stopped. `›` marks keyboard selection; `*` marks the conversation currently shown. Finished sample agents remain available for continuation. This retention follows the maintainer's requirement and does not reproduce the secondary reference implementation's timed removal of idle rows.

## Interaction reference and limits

The reference is Claude Code's **in-process teammate panel**, not its separate `claude agents` page. Sources checked on 2026-09-12: [agent teams](https://code.claude.com/docs/en/agent-teams), [Footer and Transcript keybindings](https://code.claude.com/docs/en/keybindings), and [interactive mode](https://code.claude.com/docs/en/interactive-mode). The published [`@tintinweb/pi-subagents` 0.19.0 FleetView](https://github.com/tintinweb/pi-subagents) was inspected as a secondary implementation reference; no source was copied.

| Context                    | Prototype behavior                                                          | Evidence boundary                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Empty editor               | Down or Left selects the main Fleet row                                     | Third-party FleetView reference; exact Claude activation gate is not specified in the official docs                                    |
| Fleet selected             | Up/Down moves; Up above main or Esc returns focus to the editor             | Official Footer bindings                                                                                                               |
| Fleet selected             | Enter opens the selected conversation; main returns to the native main view | Enter is official; the main-row convention follows the reference implementation                                                        |
| Fleet selected             | `x` stops the selected running child                                        | Official teammate-panel behavior                                                                                                       |
| Fleet selected             | Typing returns focus to the editor and preserves that keystroke             | Reference implementation; no global input interception                                                                                 |
| Child conversation         | Type and Enter to continue that conversation; other agents keep progressing | Documented direct teammate messaging; replies here are fixtures                                                                        |
| Running child conversation | Esc interrupts its current sample round and leaves the conversation open    | Interrupt is official; remaining in the view is an explicit prototype choice because the docs do not define the combined exit behavior |
| Idle child conversation    | Esc returns to main                                                         | Generic Transcript exit binding; team-specific idle behavior is not separately specified                                               |
| Child conversation         | Ctrl+C returns to main, preserving the draft and background work            | Generic Transcript exit binding applied to this prototype                                                                              |
| Child conversation         | Ctrl+O expands tools; PgUp/PgDn scroll; Ctrl+End shows latest               | Pi presentation controls, not a claim of Claude Code parity                                                                            |

Claude Code is not installed in this environment. **Exact interaction parity has not been verified.** In particular, the official team and transcript documentation does not fully specify whether Esc both interrupts and exits a running teammate view. The prototype makes that boundary reviewable rather than presenting an inferred behavior as an observed fact.

## What is native and what is simulated

`run.ts` starts Bun with an isolated temporary cwd and a whitelist of environment variables. `host.ts` starts Pi 0.85.1's real SDK `InteractiveMode`, an in-memory `SessionManager`, in-memory settings and an offline model runtime. Resource discovery is disabled. This revision is an SDK-hosted Pi UI; it is not an extension loaded by the separately compiled `/opt/bin/pi` binary.

Main uses the native Pi conversation layout and editor. A custom message renderer displays the fixture through Pi's `UserMessageComponent`, `AssistantMessageComponent` and `ToolExecutionComponent`. The bottom component renders a real `FooterComponent` first and appends Fleet rows. A plain extension's `belowEditor` widget would put Fleet above the native footer, which is the wrong position for this design. The SDK closure provides the actual `AgentSession` needed to construct the native footer, without private-field access.

Child conversations are full-screen custom views using the same native message/tool/editor components and native host footer. They are not independent Pi session runtimes. The native footer describes the isolated host session; fixture token counts belong to the Fleet rows. No model is configured, so the native footer reports zero usage and an unknown model.

Sample agents, responses, code, paths, tools, token/cost totals and timing are synthetic. Tools are rendered but never executed; user shell execution and session replacement are blocked inside the demo. No real model requests, Arhen scheduling, context transfer, automatic follow-up delivery or recovery are implemented. In-memory session data disappears on exit; the launcher removes its temporary directory after normal host exit.

The explicit light/dark canvas reuses Pi 0.85.1's bundled `export.pageBg` colors and semantic foreground colors to prevent Tuistory's fallback foreground from mixing with a light outer terminal. The isolated host decorates the public terminal write function so native fullscreen erase operations and default SGR colors receive the same canvas; disposal restores the writer and resets SGR. Theme changes request a full repaint, including otherwise unchanged blank rows. Previous contrast measurements describe the earlier revision, not a new measurement of every current widget.

## Verification and evidence

Verified with Bun 1.4.0, Pi SDK 0.85.1 and Tuistory 0.11.0 on Linux: native footer placement; uniform row statistics; empty/nonempty editor focus; selection/open/return; drafts; running input; Esc interruption; background work; completed continuation; tool expansion and streamed failure; 62-column and minimum-size views; theme switching; replay; native settings-menu focus. Focused probes passed main Ctrl+O, main submission, shell-command interception and graceful exit. Direct launch and actual Tuistory attach each passed light → dark → light with six blank rows containing explicit background cells in every state. Temporary probes use actual terminal state; no permanent test suite was added. Early probe failures came from an assumed token total, a short-lived activity label and a nonexistent settings heading; the corrected probe passed. Screenshot inspection also exposed unpainted fullscreen blank rows: a component wrapper did not cover the separate fullscreen layout root, and an early color assertion had accepted empty spans. The terminal-output fix and a nonempty-cell assertion now pass. `bun run check` and `git diff --check` passed. Exact Claude Code comparison and production subagent execution remain unverified.

Actual terminal captures: [main](evidence/fleet-main.png), [selection](evidence/fleet-selected.png), [child conversation](evidence/fleet-child.png), [expanded tool](evidence/expanded.png), [streaming tool](evidence/streaming.png), [dark theme](evidence/fleet-dark.png), [narrow terminal](evidence/narrow.png).

## 中文说明

这是 [Issue #49](https://github.com/jczhang02/pi-stuff/issues/49) 的离线原型，保留在独立分支和草稿 [PR #52](https://github.com/jczhang02/pi-stuff/pull/52)，不合入 main。正式 fork 仍以 Arhen 的 `pi-core-subagent` 为基础，本原型没有引入其运行时。

使用上方命令启动，或加入 `subagent-fleet-v3`。支持 `--theme=light|dark|auto`。在 main 中按 F2 打开演示控制，`t` 切换主题，`r` 重播，再按 F2 返回输入。这些是原型控制，不是 Claude Code 的快捷键。此前的三种布局已替换为维护者选定的单一布局。

返回 main 并清空输入框后，Ctrl+D 退出隔离宿主。

布局顺序固定为：**对话 → editor → Pi 原有 statusline → Fleet**。所有代理行同时显示状态图标、名称、当前活动、输入与输出 token、耗时；选择只改变高亮，不改变信息。125 列以上额外显示工具次数、轮次和费用，较窄时保留 token 与耗时并缩短活动文本。Fleet 至少需要 50 列。旋转图标表示运行，`?` 表示等待输入，`✓` 表示完成，`■` 表示停止；`›` 是键盘选择，`*` 是当前对话。完成的样例代理保留以便继续交流，这与第三方参考实现定时收起闲置行的行为不同。

空输入时按 Down 或 Left 进入 Fleet；Up/Down 选行，Enter 进入，Esc 或 main 上再按 Up 返回输入。选中运行中的子代理后，`x` 停止它。在子对话中直接输入并按 Enter 发送；运行时 Esc 中断当前轮并留在对话中，空闲时 Esc 返回 main，Ctrl+C 可保留草稿返回 main，后台任务继续。Ctrl+O 展开工具，PgUp/PgDn 浏览记录，Ctrl+End 回到最新。后面这些是 Pi 的呈现操作。

参照的是 Claude Code 当前会话内的底部队友面板，不是独立的 `claude agents` 页面。上表逐项区分官方绑定、第三方参考和原型选择。当前环境没有安装 Claude Code，**没有完成两个程序的逐项一致性实测**。官方文档明确 Esc 会中断正在运行的队友，但没有完整定义是否同时退出该视图；本原型采用中断后留在对话中的行为，并明确保留这个待核实项。

本轮通过 Pi SDK 启动真正的 `InteractiveMode`，主界面使用原生布局和编辑器；以原生消息与工具组件显示演示内容。底栏先调用真实 `FooterComponent`，再显示 Fleet。普通扩展的 `belowEditor` 实际位于 statusline 上方，不能满足已确认的位置；SDK 闭包提供真实会话对象，因此无需访问私有字段。此版本不是由单独编译的 `/opt/bin/pi` 加载的扩展。

子代理对话仍是使用原生组件的全屏自定义视图，不是独立 Pi 会话运行时。原生底栏描述隔离宿主，Fleet 行中的 token 属于模拟代理；宿主没有配置模型，因此原生底栏的用量为零、模型为 unknown。回复、代码、路径、工具结果、计数和耗时都是样例，不代表真实仓库检查结果。不会执行工具或用户 shell 命令，也不会调用模型、切换持久化会话或接入正式调度。会话和设置在内存中，正常退出后清理临时启动目录。

浅色与深色画布继续使用 Pi 的语义文字色和内置页面背景色；隔离宿主装饰公开的终端 write 方法，让全屏擦除操作和默认 SGR 颜色也使用一致画布；释放时恢复原方法并重置颜色。主题切换强制完整重绘，包括内容没有变化的空白行。此前的对比度数字属于旧版测量，不代表本轮每个组件均重新测量。

验证环境为 Linux、Bun 1.4.0、Pi SDK 0.85.1 和 Tuistory 0.11.0。实际终端检查通过：底栏位置、所有行的统计、空与非空输入焦点、选择与进入、返回与草稿、运行中输入、Esc 中断、后台推进、完成后继续、工具展开与流式失败、62 列和最小窗口、主题、重播、原生设置菜单的按键。补充验证通过主界面 Ctrl+O、主会话发送、shell 命令拦截和正常退出。直接启动与实际 Tuistory attach 都通过浅色→深色→浅色切换，每个状态检查六条空白行确实包含指定背景色的非空单元数据。早期脚本误用了固定 token 数、短暂的活动文案和不存在的设置标题，修正为真实可见状态后通过。截图还发现全屏空白行未着色：普通组件包装覆盖不到独立的全屏布局，早期颜色断言又误将空数据判为通过。终端输出修正与要求非空单元的验证现已通过。`bun run check` 和 `git diff --check` 均通过；上方七个链接均为实际终端截图。Claude Code 完全一致性与正式子代理执行仍待验证。
