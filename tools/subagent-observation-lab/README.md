# Source-informed observation prototypes

These five throwaway candidates answer a UI question: which existing interaction model makes concurrent agents easiest to inspect and direct? The preceding workspace/split/timeline round remains in `../subagent-observation-prototype`; the user found those candidates insufficiently different.

This round starts from [nine first-party product references](REFERENCES.md). It adapts their information hierarchy and navigation to Pi components; it does not claim pixel or shortcut parity with those products.

| Candidate   | Reference                          | Primary object                                             | What to try                                                                                  |
| ----------- | ---------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `inspector` | Lazygit, K9s                       | Agent → tool invocation → evidence                         | Move between columns, select a tool, inspect its full output, enter the owning conversation  |
| `monitor`   | btop                               | Throughput, concurrent states and a sortable process table | Compare token output rates, reorder agents, inspect activity, open the selected conversation |
| `inbox`     | Linear Inbox, GitHub Notifications | An item that needs a human response                        | Read the tester's question, mark it read, reply, return after the test fails                 |
| `trace`     | Jaeger                             | An agent or tool interval on a shared time axis            | Collapse subtrees, zoom to a span, select a tool result, compare overlapping work            |
| `stacks`    | Zellij                             | Evidence surfaces across agents                            | Choose events, tests, questions or source content; select an entry and inspect its evidence  |

The candidates change what navigation selects, not just where the chat sits. Inspector selects a resource; monitor selects a measured process; inbox selects an unresolved item; trace selects an interval; stacks selects a type of evidence across agents. These are usable alternatives for comparison, not five skins for the same agent switcher.

## Run and join

From the retained `codex/prototype-subagent-ui` worktree:

```sh
bun tools/subagent-observation-lab/run.ts --variant=inspector --theme=light
```

Replace the variant with any name above. `--theme=dark` selects the other native Pi theme. Candidate selection belongs to launch arguments; the terminal has no variant toolbar or development shortcuts.

Named shared terminals:

```sh
bun run tui attach -s lab-inspector
bun run tui attach -s lab-monitor
bun run tui attach -s lab-inbox
bun run tui attach -s lab-trace
bun run tui attach -s lab-stacks
```

To create a separate session:

```sh
bun run tui -s my-inspector --cols 140 --rows 44 --background -- bun tools/subagent-observation-lab/run.ts --variant=inspector
```

Use at least 60 columns × 24 rows; 140 × 44 exposes the larger layouts. The terminal shows its own size notice below the minimum and retains Ctrl+D exit.

## Interaction shared across candidates

Each observation screen starts with navigation focus. `i` focuses the native composer for the selected agent. Enter or clicking a Fleet row opens that agent's complete conversation in the normal root layout. `Alt+Left` returns to observation. This is content replacement inside the prototype host, never an overlay or a change to a live Pi session.

The editor body, history, autocomplete and footer use Pi's native components. Only a child's upper-right editor border receives its identity; main has no added label. Drafts belong to individual agents. Fleet appears below the native footer and retains aligned activity, time, input tokens and output tokens. The editor remains visible while inspecting a dashboard, so input ownership is visible before sending.

| Candidate | Navigation-specific keys                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| Inspector | Up/Down or j/k selects an agent or tool; Tab/Shift+Tab or Left/Right changes column; arrows scroll the focused output      |
| Monitor   | Up/Down or j/k selects an agent; 0 sorts by name, 1 by time, 2 by input tokens, 3 by output tokens                         |
| Inbox     | Left/Right changes group; Up/Down or j/k selects an item; u toggles read/unread; Tab moves between queue and conversation  |
| Trace     | Up/Down selects an interval; Space collapses its agent group; z zooms the selected interval; Tab moves to full tool output |
| Stacks    | Up/Down selects a surface; Left/Right or Tab/Shift+Tab selects an entry; Space collapses it; z cycles its height           |

In a complete conversation, PageUp/PageDown and the mouse wheel move the native ScrollView. Ctrl+O toggles tool expansion. Ctrl+Shift+F inserts a search row into the ordinary layout; Enter and Shift+Enter navigate matches, and Esc closes it. Pi's floating search binding is disabled. `Alt+Left` also leaves search and returns to observation.

`x` stops a running or waiting agent while navigation has focus. Esc stops a running agent while editing. Ordinary messages continue the same in-memory agent conversation; messages sent while running queue until the active turn ends. `/help`, `/stats` and `/stop` produce normal persistent feedback. An unknown slash command remains in the editor and reports its failure in the conversation. Ctrl+C clears the composer; Ctrl+D with an empty composer exits.

## Sample execution and limits

All five candidates share the same offline scenario: main coordinates cancellation, reviewer inspects cleanup, tester waits for a scope decision, and explorer has finished tracing call sites. Reply to tester to include repeated cancellation: a streamed test run fails. Reply again to exercise recovery. Completed or stopped agents accept further messages. No model calls, shell tools, repository reads or changes occur.

The launcher gives the process a temporary project directory, HOME and agent storage, with an allowlisted environment. State stays in memory; the temporary directory is removed on normal exit and handled SIGINT/SIGTERM. Native SDK sessions provide model and usage metadata to the footer only. The named sessions are disposable and do not attach to real work.

The host uses Pi 0.85.1 native TUI layout, scroll, editor, footer and message components under Bun 1.4.0 and Tuistory 0.11.0. It is not a complete `InteractiveMode` instance or a production extension. It relies on pinned concrete theme/keybinding imports and the current writable `ScrollView.primary` implementation for keyboard-scroll ownership. Supporting every Pi command, extension, live session, model, terminal or recovery path is outside this UI experiment.

The trace's initial spans have fixed illustrative timings inside their owning task. Subsequent tool intervals follow observed sample events. Its root bars measure wall time, including waits between continuation turns; Fleet measures accumulated execution time. Monitor graphs measure changes in the sample output-token counters, not CPU, memory or model performance. The research notes propose freezing observation independently from execution; this candidate deliberately stops at live graphs and sorting and does not implement that pause control.

No production UI is selected by this artifact. The comparison exposes tradeoffs: resource inspection takes more navigation, a monitor emphasizes rates over meaning, an inbox depends on useful notification grouping, a waterfall needs horizontal space, and stacked workspaces can bury inactive output behind headers. Each offers a route to the full history.

## Findings and terminal evidence

The five models are distinct enough to compare in use. Inspector is the clearest route from an agent to one exact tool result. Inbox makes a pending human decision the first object on screen. Monitor and trace answer resource and timing questions more directly, but still need the conversation for meaning. Stacks retains four evidence headers—Activity, Tests, Decisions and Sources—and collects matching entries across agents. Tests and Sources expose native complete tool output; Activity is an event index, and Decisions contains agents waiting for a reply. Selecting a surface or entry changes input ownership; background updates do not. The initial per-agent stack was rejected during independent review and replaced with this evidence workbench. This experiment supports keeping those choices separate for evaluation; it does not establish one production winner.

The following are screenshots of the running terminals, captured with Tuistory, rather than drawn mockups:

| Candidate                                           | Captured state                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Inspector](evidence/inspector.png)                 | Reviewer selected, second tool invocation and complete output visible                       |
| [Monitor](evidence/monitor.png)                     | Active output graph, aligned process table and native conversation                          |
| [Inbox](evidence/inbox.png)                         | Tester question selected in Needs you, complete conversation beside it                      |
| [Trace](evidence/trace.png)                         | Concurrent task/tool intervals, selected read result and aligned time axis                  |
| [Stacks](evidence/stacks.png)                       | Tests surface expanded on reviewer output; Activity, Decisions and Sources headers retained |
| [Workbench event index](evidence/stacks-events.png) | Activity surface collecting messages and tool events across all agents                      |
| [Dark theme](evidence/inbox-dark.png)               | The same inbox structure under Pi's dark theme                                              |
| [60 × 26 terminal](evidence/monitor-narrow.png)     | Compact graph and all four agents; Enter opens complete conversation                        |

Actual checks on Linux with the pinned versions above:

- `bun run check` and `git diff --check` passed. The existing offline product suite, `bun run test`, passed: 50 tests, 303 assertions, 0 failures. That suite does not validate these new layouts.
- Temporary Tuistory probes exercised all five candidates in both light and dark themes at 140 × 44: separate drafts, Fleet selection, unknown-command feedback with draft preservation, tester failure and recovery, tool expansion, PageUp and mouse-wheel scrolling, inline search, returning to observation, resize to 60 × 26 and 50 × 20, and exit.
- Candidate-specific terminal probes covered column/group navigation, sorting, collapse/zoom and detail scrolling, followed by stop and continuation. Inspector was checked again after its focused row began following selection in narrow layouts.
- Separate launcher probes sent SIGINT and SIGTERM to owned processes and confirmed bounded child exit and removal of their temporary directory.
- Visual inspection covered all eight captures. It caught a clipped compact process table and mixed Chinese/ASCII spans that appeared misaligned in Tuistory's font rendering. The fixed table keeps all four agents, uses identical header/data widths and gives status text its own color span; the trace axis uses an ASCII column header. The screenshots above contain those fixes.
- A terminal-cell measurement of the 140-column monitor confirmed that all four process rows end their time, input and output fields at columns 46, 52 and 57 respectively. This measures terminal cells; the screenshot inspection separately checks the glyph rendering.

The initial command probe found a real draft-loss defect, fixed before the complete rerun. An initial search probe encoded Ctrl+Shift+F without its Shift modifier; the corrected probe sent CSI-u `ESC [ 102 ; 6 u`. This was a test-driver correction, not proof of an application failure. These were disposable verification scripts, not a permanent prototype test suite. Live models, a compiled Pi host and a complete native `InteractiveMode` were not tested for this round.

## 中文说明

这一轮重新制作了五个可运行原型，比较的是五种观察工作的方式：资源浏览器、监控台、收件箱、执行时间瀑布和证据工作台。[参考笔记](REFERENCES.md) 收集了九个产品的一手资料，分别说明已核实的行为和本次改编建议。这里借鉴信息组织和操作方式，不声称与参考产品像素或快捷键完全一致。

五种方式选择的对象不同：资源浏览器选择代理和工具，监控台选择带有指标的进程，收件箱选择待处理事项，瀑布图选择执行区间，证据工作台选择跨代理汇集的事件、测试、待答问题或源码。

在保留的 `codex/prototype-subagent-ui` worktree 中运行上面的命令即可。五个命名终端可直接加入；候选项和主题通过启动参数选择，界面内没有原型标识或开发控制。建议使用 140 列 × 44 行，最小为 60 列 × 24 行。

观察页默认处于导航状态。`i` 进入当前代理的原生编辑器；Enter 或点击底部 Fleet 行进入完整对话；`Alt+Left` 返回观察页。完整对话占用正常布局空间，搜索行也占用正常空间。PageUp/PageDown 和鼠标滚轮滚动记录，Ctrl+O 展开工具，Ctrl+Shift+F 搜索。子代理只有 editor 右上角身份标识，main 没有新增标识，Fleet 在原生底栏下面。

各方案的专有操作：资源浏览器用 Tab 切换栏、上下选择代理或工具；监控台按 0/1/2/3 切换名称/时间/输入/输出排序；收件箱用左右键切分组、`u` 标记已读、Tab 进入详情；瀑布图用 Space 折叠任务、`z` 缩放区间、Tab 聚焦工具输出；证据工作台用上下切换表面、左右或 Tab 选择具体条目、Space 折叠展开、`z` 调整当前表面高度。

五个方案共用相同的离线任务。tester 最初等待是否包含重复取消测试的决定；回复后测试失败，再回复可查看恢复过程。其他代理会继续运行，已结束的代理也可继续收到消息。草稿分代理保存；导航状态按 `x` 停止当前运行或等待的代理，编辑状态按 Esc 停止运行；空编辑器按 Ctrl+D 退出。

模拟发生在执行层：没有真实模型调用，没有执行工具，没有读取或修改项目。界面使用 Pi 原生组件，但宿主不是完整的 `InteractiveMode`，也没有接入真实 Pi 会话。时间瀑布中的初始区间是预设样本，后续区间随样本事件更新；根区间包含等待时间，Fleet 显示累计执行时间。监控曲线来自样本输出 token 的增量，不代表模型性能；研究笔记提出的“仅冻结观察、不暂停执行”没有在本候选中实现，本轮保留实时图表和排序。临时目录在正常退出和处理 SIGINT/SIGTERM 后清理，所有任务状态都在内存中。

这些原型用于选择观察方式，尚未选定生产方案。各自的代价也保留在界面里：资源浏览器需要逐层导航，监控台偏重数量，收件箱依赖恰当的事项归类，瀑布图需要横向空间，堆叠工作区会把未展开的内容藏在标题后面。每个方案都能进入完整记录继续检查。

实际操作后的判断是：资源浏览器最便于追查某次工具调用，收件箱最便于优先处理需要人的决定；监控台和瀑布图更适合数量与时序问题，仍需要对话解释工作内容；证据工作台保留 Activity、Tests、Decisions、Sources 四种证据标题，分别汇集跨代理事件、测试输出、待答问题和文件内容。选择表面或条目才改变编辑器归属，后台更新不抢走输入目标。独立审查认为最初按代理堆叠的方案仍像聊天，因此将它替换为当前按证据类型组织的实现。这一轮已经能比较这些差别，还没有证据选定唯一的生产方案。

上表八张图均由运行中的 Tuistory 终端截取，覆盖五种宽屏界面、深色收件箱和 60 × 26 的窄屏监控台。实际验证包括：

- 静态检查和 diff 检查通过；既有离线产品测试 50 项通过、303 次断言、0 失败。产品测试不等于新界面验收。
- 五种候选分别通过浅色、深色终端的完整共同流程：代理选择、独立草稿、未知命令反馈、失败与恢复、工具展开、翻页与滚轮、行内搜索、返回观察页、窄屏与尺寸不足处理、退出。
- 专有导航、排序、折叠与缩放、详情滚动、停止后继续均经过实际终端检查。资源浏览器修正窄屏列表跟随焦点后重新通过相关检查。
- SIGINT/SIGTERM 检查确认自有子进程按时退出，临时目录被清理。
- 逐张检查截图后，修复了窄屏进程表裁剪、状态文字混排造成的列观感偏差，以及时间轴标题与刻度的排版。
- 140 列监控台的终端格测量确认，四行进程的时间、输入、输出字段都分别在第 46、52、57 列结束；截图另外检查实际字体呈现。

最初的未知命令检查发现草稿丢失，修复后完整复测通过。最初搜索检查的按键编码遗漏了 Shift，改用 CSI-u `ESC [ 102 ; 6 u` 后通过；这是测试驱动修正，不能记作应用缺陷。临时检查脚本没有加入永久测试集。本轮没有测试真实模型、编译版 Pi 宿主或完整原生 `InteractiveMode`。
