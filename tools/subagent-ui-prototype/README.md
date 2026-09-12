# Subagent Fleet UI prototype

For the subsequent real Arhen execution and host-compatibility findings, use the [runtime E2E artifact](../subagent-runtime-e2e/README.md). This directory retains the earlier UI-only preview.

后续真实 Arhen 执行及宿主兼容性验证见[运行时 E2E 产物](../subagent-runtime-e2e/README.md)。本目录保留此前纯 UI 预览。

This runnable UI preview answers how a bottom Fleet and full agent conversations should look and respond. It follows the [prototype fidelity standard](../../design.md#tui-prototype-fidelity) merged in #54. The interface contains product content and controls; the sample execution and its limits are explained here.

The artifact belongs to [issue #49](https://github.com/jczhang02/pi-stuff/issues/49), branch `codex/prototype-subagent-ui` and [draft PR #52](https://github.com/jczhang02/pi-stuff/pull/52). It remains outside main. The production fork source is Arhen's `pi-core-subagent`; this preview does not import its runtime.

## Run and join

Use the main project checkout as the working directory, so the native statusline shows the project being evaluated. With the retained worktree under `.worktrees/codex/prototype-subagent-ui`, run:

```bash
bun .worktrees/codex/prototype-subagent-ui/tools/subagent-ui-prototype/run.ts --theme=light
```

The launcher uses its caller's project directory for Pi's visible context and a temporary directory for process execution and agent storage. Use `--theme=dark` or `--theme=auto` for the other theme modes. `--scenario=running` starts the ongoing work; `--scenario=completed` opens after the checks have finished, with tester still awaiting input. Restart the command to replay. Scenario and theme selection take no terminal rows or keys; F2 has no prototype handler.

To join the shared preview from that checkout:

```bash
bun run tui attach -s subagent-fleet-v4
```

If the session is absent, launch it:

```bash
bun run tui -s subagent-fleet-v4 --cols 125 --rows 38 --background -- bun .worktrees/codex/prototype-subagent-ui/tools/subagent-ui-prototype/run.ts --theme=light
```

After returning to main and clearing the editor, Ctrl+D exits. To replay your shared preview, run this from another terminal:

```bash
bun run tui -s subagent-fleet-v4 restart
```

## Layout and controls

The order is **conversation → native editor → native Pi statusline → Fleet**. Every agent row shows a status icon, name, current activity, input/output tokens and elapsed time. Selection changes highlight only. At 125 columns, the row also shows tools, turns and cost. Narrower rows retain tokens and elapsed time and shorten activity first. The useful minimum is 50 columns; the child view also needs 18 rows.

A spinner means running, `?` waiting for input, `✓` completed and `■` stopped. `›` marks keyboard selection and `*` the open conversation. Completed agents remain available for continuation. No automatic child notification is injected into a visible Follow-up queue.

| Context            | Action                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------- |
| Empty editor       | Down or Left selects the main Fleet row                                                   |
| Fleet selected     | Up/Down selects; Up above main or Esc returns to the editor                               |
| Fleet selected     | Enter opens the selected conversation; selecting main returns to the main view            |
| Fleet selected     | `x` stops a running child; typing returns to the editor and preserves the typed character |
| Child conversation | Type and Enter sends to that agent; other work keeps progressing                          |
| Running child      | Esc interrupts the current round and keeps the conversation open                          |
| Idle child         | Esc returns to main                                                                       |
| Child conversation | Ctrl+C returns to main and preserves the draft and background work                        |
| Child conversation | Ctrl+O expands tools; PgUp/PgDn scroll; Ctrl+End shows the latest content                 |

The reference is Claude Code's in-process teammate panel. Sources checked in the preceding revision on 2026-09-12: [agent teams](https://code.claude.com/docs/en/agent-teams), [keybindings](https://code.claude.com/docs/en/keybindings) and [interactive mode](https://code.claude.com/docs/en/interactive-mode). [`@tintinweb/pi-subagents` 0.19.0](https://github.com/tintinweb/pi-subagents) provided a secondary FleetView reference; no source was copied.

Claude Code is absent on this host, so exact interaction parity is unverified. Official documentation specifies Footer navigation, Enter, stopping with `x`, and interruption with Esc, but does not completely define the combined interrupt/exit behavior of a running teammate view. Staying in the running view after Esc is the current design choice. Empty-editor activation and typing out of Fleet selection follow the secondary reference. Tool expansion and scrolling use Pi controls. The maintainer can evaluate these interactions without deciding the internal runtime design first.

## Execution boundary

`host.ts` uses the real Pi 0.85.1 SDK `InteractiveMode`, native messages, tools, editor and `FooterComponent`. The footer renders its normal project/model/usage lines before Fleet. Each displayed agent has an in-memory `AgentSession` with its own seeded usage. Opening a child switches the native footer with the public `setSession` API; the main footer is restored on return. Fleet and the native footer derive their numbers from the same fixture usage. Native rounding differs from Fleet rounding.

Only main owns an interactive runtime. Children use full-screen views composed of Pi's native components; their sessions supply native display context, not independent execution. Replies, source excerpts, tool output, paths under `src/subagent`, token totals and timings are samples. The displayed model is sample Sonnet metadata, not a connected provider. Costs derive from sample tokens; output tokens pause during tool execution. Sample tools are rendered but never executed. Plain text continues a fixed cancellation-review scenario; it is not interpreted by a model. Shell execution is disabled, child slash commands direct the user back to main, and session replacement/forking is blocked. These remain outside the UI interactions being evaluated.

Settings, sessions, auth and cache paths are isolated; credentials are not forwarded. Resource discovery is disabled, model catalog networking is off and the fixture model endpoint is loopback port 1. `HOME` is forwarded for native `~` path formatting. Normal host exit removes the temporary directory. The launcher does not change the live project's files.

The light/dark canvas uses Pi's semantic foreground and bundled page background colors. A decoration of the public terminal writer covers default SGR colors and fullscreen erase operations, including blank rows; disposal restores the writer. Theme changes trigger a full repaint. No private host fields are accessed and no dependencies were added.

## Verification

Current environment: Linux, Bun 1.4.0, Pi SDK 0.85.1, Tuistory 0.11.0. Actual terminal checks cover footer order and per-agent usage; row statistics; empty/nonempty editor focus; selection, entry and return; drafts; running input, interruption and completed continuation; tool expansion; native settings focus; 62-column and minimum-size layouts; and removal of F2 controls. Direct launch and actual Tuistory attach both passed light and dark canvas checks, each requiring six nonempty blank rows with the correct background, per-agent footer switching and normal host exit. The captures include streaming output, tool failure and completion. Temporary terminal probes are used instead of a permanent prototype test suite.

This is SDK-hosted UI evidence. Loading the production extension in the separately compiled Pi host, Arhen scheduling, context transfer, recovery and exact Claude Code parity remain unverified. UI acceptance remains with the maintainer.

Actual terminal captures: [main](evidence/fleet-main.png), [selection](evidence/fleet-selected.png), [child](evidence/fleet-child.png), [expanded tool](evidence/expanded.png), [streaming output](evidence/streaming.png), [failure](evidence/failure.png), [dark theme](evidence/fleet-dark.png), [narrow view](evidence/narrow.png).

## 中文说明

这个可运行原型用于评估底部 Fleet 和代理完整对话的样式与操作，遵循 #54 合并的[原型呈现标准](../../design.md#tui-prototype-fidelity)。终端内只显示产品内容和控制；模拟范围及限制写在本文中。产物保留在 Issue #49、分支 `codex/prototype-subagent-ui` 和草稿 PR #52，不合入 main；尚未导入正式 Arhen 运行时。

从主项目 checkout 执行上方启动命令，原生 statusline 会显示该项目。启动器另用临时目录运行进程和存放隔离的 agent 数据。支持 `--theme=light|dark|auto`；`--scenario=running` 从进行中的工作开始，`--scenario=completed` 直接显示检查结束的状态，此时 tester 仍等待输入。重新启动命令即可重播。这些开发控制不占界面空间或按键，F2 没有原型处理逻辑。共享会话为 `subagent-fleet-v4`，加入及重播命令见上方；返回 main、清空输入后，Ctrl+D 退出。

布局为 **对话 → 原生 editor → Pi 原有 statusline → Fleet**。每行都有状态图标、名称、活动、输入/输出 token 和耗时，选择只改变高亮。125 列显示工具数、轮数及费用；窄屏先缩短活动，保留 token 和耗时。Fleet 至少需要 50 列，子对话至少需要 18 行。旋转图标表示运行，`?` 等待输入，`✓` 完成，`■` 停止；`›` 表示键盘选择，`*` 表示当前会话。完成的代理保留，可继续交流；自动通知不进入可见 Follow-up 队列。

空输入按 Down/Left 进入 Fleet，Up/Down 选行，Enter 进入；Esc 或 main 上再按 Up 返回输入。选中运行中的子代理按 `x` 停止。在子对话输入并按 Enter 发送，其他代理继续推进。运行时 Esc 中断并留在当前对话，空闲时 Esc 返回 main；Ctrl+C 保留草稿返回。Ctrl+O 展开工具，PgUp/PgDn 滚动，Ctrl+End 回到最新。

参考的是 Claude Code 会话内的队友面板。上方列出此前调研的官方资料和第三方参考；当前机器未安装 Claude Code，尚未逐项实测两个程序完全一致。官方文档没有完整说明运行中 Esc 是否同时退出，因此原型采用中断后留在当前对话的选择。空输入激活和选中后直接打字来自第三方参考；工具展开及滚动采用 Pi 按键。这轮仍是 UI 评估，无需先决定内部技术方案。

界面使用真实 Pi SDK `InteractiveMode` 及原生消息、工具、editor、footer。每个代理都有独立的内存会话与样例用量；切换时通过公开的 `FooterComponent.setSession` 显示该代理的原生底栏，返回时恢复主会话。Fleet 与原生底栏使用同一份计数，格式化精度不同。

只有 main 拥有交互运行时；子代理是原生组件组成的全屏视图，内存会话只提供显示信息。回复、代码、工具输出、`src/subagent` 路径、token 和耗时都是样例。显示的 Sonnet 元数据不代表连接了模型；费用由样例 token 计算，工具运行时输出 token 暂停增长。工具不会执行，文字输入继续固定场景，不会被模型理解。Shell 禁用，子对话中的斜杠命令提示返回 main，持久化会话切换和 fork 被阻止；这些不属于本轮评估的 UI 操作。

会话、设置、认证及缓存使用隔离存储，不传递凭证，不发现额外资源，不刷新模型目录；样例模型地址指向 loopback 端口 1。转发 `HOME` 仅用于原生路径中的 `~`。正常退出清理临时目录，不修改真实项目文件。浅色/深色使用 Pi 语义颜色，通过公开终端写接口覆盖空白行与擦除操作，释放时恢复接口；主题变化会完整重绘。没有访问私有字段或添加依赖。

本轮在 Linux、Bun 1.4.0、Pi SDK 0.85.1、Tuistory 0.11.0 上检查底栏顺序与对应代理用量、行统计、输入焦点、选择进入返回、草稿、运行中输入与中断、完成后继续、工具展开、原生设置、62 列及最小窗口和 F2 清理。直接启动和实际 Tuistory attach 均通过浅色/深色检查：每次验证六条空白行确实包含正确背景色单元，并检查对应代理底栏和正常退出。上方八张链接均为实际终端截图，包括流式输出、失败和完成。验证使用临时终端脚本，没有添加永久原型测试套件。正式扩展在独立编译宿主中的加载、Arhen 调度、上下文转交、恢复及 Claude Code 完全一致性仍待验证，UI 等待维护者试玩验收。
