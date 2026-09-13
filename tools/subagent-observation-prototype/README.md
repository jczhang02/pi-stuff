# Subagent observation prototypes

These three throwaway candidates answer one question: how should users inspect and interact with subagents without an overlay? They supersede the overlay UI in the earlier previews. They do not replace the runtime in #55 / #56.

The terminal contains the proposed product interface. Execution is a shared, deterministic in-memory cancellation-review scenario; it makes no model requests and executes no tools. Each agent has an isolated SDK session for native footer metadata. A temporary project and agent directory are removed on normal exit. All commands below run from this branch's checkout, `codex/prototype-subagent-ui`.

```sh
bun tools/subagent-observation-prototype/run.ts --variant=workspace --theme=light
bun tools/subagent-observation-prototype/run.ts --variant=split --theme=light
bun tools/subagent-observation-prototype/run.ts --variant=timeline --theme=light
```

Use `--theme=dark` for the dark theme. Restart the process to replay the scenario. Variant and replay controls are deliberately outside the product interface.

Shared terminals retained for this handoff can be joined from a repository checkout:

```sh
bun run tui attach -s observe-workspace
bun run tui attach -s observe-split
bun run tui attach -s observe-timeline
```

The launch commands remain reproducible after those local terminal sessions end. The retained branch is [codex/prototype-subagent-ui](https://github.com/jczhang02/pi-stuff/tree/codex/prototype-subagent-ui); the current question and ownership are in [#49](https://github.com/jczhang02/pi-stuff/issues/49), with the artifact in [draft PR #52](https://github.com/jczhang02/pi-stuff/pull/52).

| Candidate   | Visible content                                                                                | What selecting a child changes                                                        | Main tradeoff                                                                |
| ----------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `workspace` | One complete conversation, native editor/footer, bottom Fleet                                  | Replaces the layout's conversation/editor/footer with the child's retained components | Maximum reading width; other conversations remain behind Fleet rows          |
| `split`     | Main on the left, selected child on the right, bottom Fleet                                    | Changes the right pane and its input target; F6 moves input between panes             | Simultaneous comparison; each conversation has less width                    |
| `timeline`  | Every agent's complete messages in chronological order, one target editor/footer, bottom Fleet | Changes the input target; the combined history remains visible                        | Cross-agent chronology is obvious; messages from concurrent tasks interleave |

Split adapts to one pane below 110 columns and restores both panes when widened. The minimum usable size is 50 columns by 18 rows. No candidate opens a modal or full-screen overlay, including for search.

| Action                     | Interaction                                                                |
| -------------------------- | -------------------------------------------------------------------------- |
| Select agent               | Down with an empty editor, Up/Down, Enter; or click its Fleet row          |
| Return to main             | Alt+Left; draft, cursor and undo remain in the existing editor instance    |
| Switch split input         | F6, or click the other editor                                              |
| Send / answer / continue   | Type into the selected editor, Enter                                       |
| Stop                       | Esc while the selected agent runs, or Fleet selection + x                  |
| Scroll                     | Mouse wheel over a pane; PageUp/PageDown for the active pane               |
| Browse tools               | Ctrl+O for the input target's tool results                                 |
| Search                     | Ctrl+Shift+F opens an inline row; type; Enter/Shift+Enter move; Esc closes |
| Clear input                | Native Ctrl+C                                                              |
| Exit                       | Ctrl+D with an empty editor                                                |
| Inspect full task/activity | `/stats`                                                                   |
| Help                       | `/help`; supported commands use native editor completion                   |

## Fidelity boundary

The host composes Pi 0.85.1's `TuiAltScreen`, `VStack`, `HStack`, `ScrollView`, `CustomEditor`, `FooterComponent`, message components and built-in read/bash renderers. Scroll positions belong to retained native ScrollViews. Each editor instance belongs to one agent. Layout changes do not copy a transcript onto another screen or create an overlay.

This is an isolated composition host, **not Pi's complete InteractiveMode**. The preview does not establish a drop-in extension API for changing InteractiveMode's active session. Full model/session commands, compaction, authentication, external editors, arbitrary extensions and live execution are outside this UI experiment. Only `/help`, `/stats` and `/stop` execute here. Other commands give a visible message and retain the input.

Pi's public root does not export the concrete keybindings manager or active theme values. The prototype imports those implementations from the pinned installation. This is a prototype dependency on Pi internals, not a proposed public production interface. The underlying packages are unchanged. Native search normally uses an overlay, so that binding is disabled and an allocated inline input searches the visible transcript instead. The split view's owned ScrollView subclass changes its public `primary` field so keyboard scrolling follows input focus.

Pi 0.85.1's editor paints a soft cursor even when unfocused. The composition host suppresses that inactive cursor so the two-pane view shows only one input focus. The active editor body stays native. A child's label uses only the trailing top-border space, preserving native hidden-line indicators for multiline input; the main editor has no label.

## Findings and actual terminal evidence

The default recommendation is `workspace`: it preserves full reading width and keeps each agent's draft and scroll position. `split` is useful as an optional observation mode when comparing parent and child work; its smaller columns make long code and tool output harder to read. `timeline` exposes collaboration order without switching away, but concurrent messages interrupt each other's narrative. It is better suited to a collaboration record than the default conversation. These are recommendations for maintainer evaluation, not a selected production design.

The simpler composition was retained: the three candidates share one scenario and native renderers, with layout selection in one host. Footer sessions contain only the metadata needed by FooterComponent; the earlier attempt to serialize the entire fixture transcript into SDK messages added a second history representation without changing this UI experiment. Removing it preserved all three terminal flows.

Actual Linux terminal verification used Bun 1.4.0, Pi 0.85.1 and Tuistory 0.11.0:

- All three candidates passed the same interaction flow in both light and dark themes: independent drafts, directed submission, target-scoped inline search, PageUp/PageDown and wheel scrolling, tool expansion, waiting input, failure, recovery, continuation, scoped stop and normal exit.
- Resize from 140 × 38 to 80 × 30 and back passed; split restored equal panes. At 40 × 16, the size notice retained a working Ctrl+D exit.
- Native editor comparison passed for main, child body, multiline hidden-line indicators and inactive cursor at widths 50, 68 and 140.
- Fleet measurements at 50, 80 and 140 columns use one-based terminal cells, not screenshot pixels. The [alignment data](evidence/alignment.json) records aligned names, activities and metrics, with every row exactly the terminal width.
- `bun run check`, `git diff --check` and the existing product suite passed: 50 tests, 303 assertions. The terminal driver and editor probes were temporary verification scripts; no permanent prototype test suite was added.

The first terminal passes exposed a 2:1 HStack width allocation, incomplete fixture text and reads occurring before the next render. Explicit pane widths, completed fixture chunks and waiting for an actual viewport change resolved them. The interaction results above describe the corrected version. No live provider, full InteractiveMode integration or arbitrary extension compatibility was verified in this revision.

Actual captures: [workspace](evidence/workspace.png), [split](evidence/split.png), [timeline](evidence/timeline.png), [dark split](evidence/split-dark.png), [narrow split](evidence/split-narrow.png).

## 中文说明

这三个原型比较的是：拒绝浮层后，如何查看完整子代理记录、直接交互，并保持对其他代理的掌握。它们替代此前的浮层 UI 探索，不替换 #55 / #56 的运行时。

三个方案使用同一组取消逻辑审查任务。消息、工具输出和模型用量是内存样例，不调用模型，也不执行工具；每个代理保有独立 SDK 会话以驱动原生 footer。界面只显示拟采用的产品内容，原型选择、重播和限制说明放在这里。使用上面的命令启动，重启进程重播，`--theme=dark` 切换深色。

- `workspace`：整页切换到当前代理，保留底部 Fleet；阅读空间最大。
- `split`：左侧 main、右侧子代理，可同时阅读与输入；不足 110 列时回到单栏。
- `timeline`：全部代理的完整消息按时间顺序汇合，选择代理只改变输入目标；适合追踪协作经过，但消息会交错。

空输入 Down 进入 Fleet，方向键选择、Enter 进入，也可点击行；Alt+Left 返回 main。并排模式 F6 或点击编辑器切换输入。滚轮作用于所在栏，PageUp/PageDown 作用于当前输入栏。Ctrl+O 展开工具；Ctrl+Shift+F 在正常布局内打开搜索行，Enter/Shift+Enter 查找下一个/上一个，Esc 关闭。运行时 Esc 或 Fleet 中 x 停止；Ctrl+C 清空输入，空输入 Ctrl+D 退出。`/stats` 显示完整任务和活动，`/help` 查看操作。

这里运行的是原生 TUI 组件组成的隔离宿主，**不是完整的 Pi InteractiveMode**。原型能验证布局、滚动和输入归属，不能据此宣称正式 Pi 已支持完整会话切换。模型/会话高级命令、压缩、登录、外部编辑器、任意扩展组合和真实执行均未接入。固定版本的 keybindings/theme 内部导入以及 `primary` 切换也是实验接缝，尚未成为生产接口。

三个共享终端的加入命令见上方，均保留用于本次试玩；会话结束后仍可从保留分支重新启动。主编辑器没有身份标签。子标签只占原生顶框尾部横线，多行输入的隐藏行提示得以保留。Pi 0.85.1 会在失焦编辑器中继续绘制软件光标，因此并排宿主仅抑制这个失焦光标，当前编辑器内容保留原生显示。

默认建议采用 `workspace` 继续评估：完整阅读宽度、草稿和滚动位置最容易掌握。`split` 适合作为同时比较主/子代理的可选模式，但长代码会换行更多。`timeline` 适合追踪协作顺序，作为默认聊天页则容易被并发消息打断。这是建议，不是正式方案选择。

实现保留了较简单的共享场景和原生渲染器，只由宿主决定布局。原先为 footer 会话复制整份样例历史的做法已移除；SDK 会话现在只保存 footer 所需元数据，三个交互流程仍全部通过。

在 Linux、Bun 1.4.0、Pi 0.85.1、Tuistory 0.11.0 下，三个方案的浅色/深色流程全部通过：独立草稿、定向发送、当前记录搜索、键盘和滚轮、工具展开、等待回复、失败恢复、继续、定向停止及正常退出。140 × 38 与 80 × 30 往返缩放通过；40 × 16 的尺寸提示保留退出。50/68/140 列原生编辑器对比验证了主编辑器原样、子编辑器正文原样、多行提示和失焦光标。Fleet 的 50/80/140 列实测保存在上方 JSON，按终端字符格而非像素度量。

静态检查和现有产品测试通过，50 个测试、303 次断言。临时终端脚本不作为永久原型测试套件。初轮发现的并排宽度 2:1、样例文本尾部截断及读取下一帧过早均已修正，结果指修正后的版本。实际截图见上方链接；本轮没有验证在线模型、完整 InteractiveMode 接入或任意扩展兼容。
