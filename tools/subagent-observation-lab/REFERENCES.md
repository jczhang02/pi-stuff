# Zero-overlay subagent observation: reference research

This note collects first-party interface references for a new subagent-observation
prototype. It responds to the finding that a single conversation, a two-chat split,
and a merged chat timeline are different arrangements of the same mental model.
The references below suggest models in which the primary object is a resource, a
state transition, a dependency, a time span, or an inspection checkpoint. The
subagent transcript can be an evidence surface inside those models, but it is not
the organizing object.

Sources were checked on 2026-09-13. Links marked as screenshots are first-party
image assets or an official page containing the image. `Verified` describes what
the cited product documents, source repository, or official screenshot shows.
`Adaptation` is a proposal for this prototype and is not a claim that the source
product has subagents.

## Constraint used while reading the references

The prototype must keep observation and interaction in persistent terminal
surfaces. Do not use a modal, floating pane, popover, temporary full-screen modal, or
hover-only detail view as the primary way to inspect an agent. Several references
use those mechanisms for their own products; those interactions are called out as
things to leave behind. A persistent inline row, a dedicated column, or a stable
detail region is compatible with the constraint.

## First-party product references

### 1. Lazygit — resource explorer with a focused inspector

**Verified.** Lazygit is a multi-panel terminal UI for Git. Its official README
screenshot presents resource lists at the side and a larger focused view for the
selected resource, with a persistent bottom key/status line. The documented
navigation is hierarchical: `/` filters the current view; `Enter` moves from a
selected commit to its files and from a file to its patch; `Esc` returns to the
previous panel; `Tab` switches panels; `+` and `_` cycle normal, half, and full
screen modes. In the files view, `Space` stages a selected line, while `v` starts
a range selection. The README also describes opening a commit graph in an enlarged
main view and highlighting parent commits as the user navigates.

**Adaptation.** Treat the agent list as a resource tree grouped by phase, owner,
or artifact rather than as a list of chats. Selecting a row can drill from an
agent to its latest tool result, diff, approval request, or failure evidence while
the surrounding tree remains visible. A stable bottom legend can expose the small
set of context-sensitive actions.

**Do not borrow.** Git-specific verbs and a large collection of single-letter
commands would obscure agent semantics. Lazygit also documents confirmation menus
and temporary menus; those modal interactions are excluded. A normal allocated
content view or pane zoom is still available in this exploration.

**Sources.** [Official README](https://github.com/jesseduffield/lazygit),
[keybindings](https://github.com/jesseduffield/lazygit/blob/master/docs/keybindings/Keybindings_en.md),
[configuration](https://github.com/jesseduffield/lazygit/blob/master/docs/Config.md),
[official README screenshot](https://user-images.githubusercontent.com/8456633/174470852-339b5011-5800-4bb9-a628-ff230aa8cd4e.png).

### 2. K9s — live resource table with breadcrumbs and row actions

**Verified.** K9s describes itself as a terminal UI that continually watches
Kubernetes resources. The official README links separate Pods, Logs, and
Deployments screenshots. Its normal interaction is table-oriented: a selected
resource can open logs (`l`), YAML (`y`), a description (`d`), or a related view;
`Space` marks resources; `Ctrl-w` toggles wide columns; and `Ctrl-r` refreshes the
view. `:` enters resource command mode, `/` filters the current view (including
regular-expression filters), and `Esc` backs out to the prior view. `?` shows the
active help, `Ctrl-a` lists aliases, and `Ctrl-g` toggles breadcrumbs. The official
columns documentation makes the table schema configurable and supports live
tuning of visible, hidden, wide, and sorted columns. The hotkeys documentation
also says custom resource shortcuts are listed in help and reloaded automatically.

**Adaptation.** Use one compact, continuously refreshed table for agents. Columns
can carry status, current activity, waiting reason, last artifact, token/cost
budget, and dependency count. A breadcrumb can answer “which parent task and
phase led here?” without opening another screen. Row-level actions can stop,
retry, inspect, or mark an agent; `?` can reveal the exact actions available for
the focused row.

**Do not borrow.** K9s has destructive shortcuts such as delete and kill and uses
dialogs for some confirmations. Do not map those commands directly to stopping an
agent. Do not depend on colored status cells alone, and do not make a command
prompt or resource detail a popup; keep the filter and inspector in the allocated
layout.

**Sources.** [Official README](https://github.com/derailed/k9s/blob/master/README.md),
[commands and keybindings](https://k9scli.io/topics/commands/),
[hotkeys](https://k9scli.io/topics/hotkeys/),
[custom columns](https://k9scli.io/topics/columns/),
[Pods screenshot](https://raw.githubusercontent.com/derailed/k9s/master/assets/screen_po.png),
[Logs screenshot](https://raw.githubusercontent.com/derailed/k9s/master/assets/screen_logs.png),
[Deployments screenshot](https://raw.githubusercontent.com/derailed/k9s/master/assets/screen_dp.png).

### 3. btop — persistent telemetry dashboard and frozen inspection

**Verified.** The official btop README describes a dashboard for processor,
memory, disks, network, and processes, and links screenshots for the normal view,
TTY view, alternate layout, main menu, options menu, and help menu. Its feature
list explicitly includes a selectable process list, selected-process details,
filtering, sorting, process tree view, mouse scrolling, and pausing the process
list. The process list can therefore be held still while the rest of the resource
view continues to make the current state legible. Graph boxes can be rearranged
through presets and the UI supports both keyboard and mouse actions.

**Adaptation.** Make the top of the screen a compact fleet telemetry band: counts
of running, waiting, failed, and completed agents, active tools, and budget or
elapsed-time gauges. Under it, show a dense agent list and a selected-agent detail
readout. A `pause observation` action should freeze the changing list for reading
without changing the agent's execution state; the words “observation paused” must
be visible.

**Do not borrow.** A constantly moving process list is a poor reading surface for
long tool output. Dense graphs that need wide terminals, a configuration menu that
takes over the screen, and status conveyed only by hue would violate the narrow
terminal and accessibility goals.

**Sources.** [Official README](https://github.com/aristocratos/btop/blob/main/README.md),
[official manpage](https://github.com/aristocratos/btop/blob/main/manpage.md),
[normal dashboard screenshot](https://raw.githubusercontent.com/aristocratos/btop/main/Img/normal.png),
[TTY screenshot](https://raw.githubusercontent.com/aristocratos/btop/main/Img/tty.png),
[alternate layout screenshot](https://raw.githubusercontent.com/aristocratos/btop/main/Img/alt.png).

### 4. Zellij — persistent surfaces, stacks, and explicit focus

**Verified.** Zellij's official tutorial shows a top tab bar containing the session
name and tabs, and a bottom status bar showing mode entry shortcuts and immediate
context actions. Tiled panes can be focused with `Alt` plus arrows or `hjkl`; pane
mode can create a pane down, right, or stacked. Stacked panes keep only a title
line visible for all but the focused pane, so several surfaces remain addressable
without consuming full width. Zellij describes command panes as first-class
surfaces with exit codes, one-key reruns, and suspended start. Its feature page
states that hidden floating panes continue running in the background and that
layouts can define tabs, terminals, commands, and plugins. The keybinding guide
uses explicit modes (`Ctrl-p` for pane mode), and the layout guide exposes stable
focus, size, name, border, and split-direction properties.

**Adaptation.** Build a workspace whose surfaces are different evidence types:
agent roster, event log, diff, test output, approval queue, and artifact preview.
The focused surface owns input, while the status line names the active surface
and its available actions. A stack can compress low-priority evidence to one-line
rows and expand only the chosen item. Background agents remain represented by
compact rows with live state, instead of disappearing when the user changes focus.

**Do not borrow.** Zellij's floating and pinned always-on-top panes are explicit
overlays and are outside the allowed design. Do not create one pane per chat and
call that a new model; the meaningful distinction is the type of evidence each
surface exposes. Do not hide a running agent without a persistent status row.

**Sources.** [Basic UI and pane tutorial](https://zellij.dev/tutorials/basic-functionality/),
[features](https://zellij.dev/features/),
[creating layouts](https://zellij.dev/documentation/creating-a-layout.html),
[keybinding presets](https://zellij.dev/documentation/keybinding-presets),
[UI screenshot](https://zellij.dev/img/zellij-ui.png),
[new panes screenshot](https://zellij.dev/img/zellij-new-panes.png),
[stacked panes demonstration](https://zellij.dev/img/stacked-panes-feature-demo.gif).

### 5. Linear Inbox — priority queue and reversible triage

**Verified.** Linear's official Inbox documentation describes a persistent sidebar
notification center and shows a dark-mode screenshot with `Priority` and `Other`
tabs. `G` then `I` navigates to Inbox; `J`/`K` or the arrow keys move through the
list or individual notification view. `U` toggles read state, `Alt/Option-U` marks
all read, and `H` snoozes the selected notification. `Ctrl/Cmd-F` brings up a quick
search bar; `Esc` clears it. Display options can show snoozed items, put unread
items first, enable or disable the priority inbox, and choose grouping. Snoozing
hides the item until its scheduled time. Opening an item gives a special view for
issue changes and Inbox actions, while right-click exposes a contextual action
menu.

**Adaptation.** Make “needs my decision”, “waiting”, “unread result”, and “later”
explicit queue states. Selection should permit a visible inline action such as
acknowledge, snooze, retry, stop, or continue; the user should not have to open a
chat merely to clear an observation. Priority can be derived from blocking impact
and waiting age, with a visible grouping toggle.

**Do not borrow.** A generic notification center can make an agent look like an
unimportant message. Do not hide work without a visible snooze state and return
time. Do not use a right-click menu, command menu, or special full-page item view
as the only route to an action; allocate an inline action rail or stable detail
area instead.

**Sources.** [Linear Inbox documentation](https://linear.app/docs/inbox),
[Linear changelog with Priority Inbox screenshot](https://linear.app/changelog),
[Inbox screenshot asset](https://webassets.linear.app/images/ornj730p/production/b442b340278740de70919c868dce1afca4335fe7-3600x2080.png?auto=format&dpr=2&q=95&w=1440).

### 6. GitHub Notifications — filterable queue with bulk transitions

**Verified.** GitHub's official notification docs define an Inbox containing
notifications that are not unsubscribed or marked Done. The left side of the
workflow contains default filters for assignment, participation, review request,
and mentions, and up to 15 custom filters can be added. A selected item can be
Saved, marked Done, Unsubscribed, Read, or Unread; bulk selection applies a triage
choice to several items. Clicking a notification enters the source conversation,
where the top area keeps Done, Unsubscribe, Read, Save, and return-to-Inbox actions.
The filter syntax includes repository, discussion type, reason, author, and
organization; reasons include review requested, mention, state change, security
alert, and CI activity. The official keyboard reference lists `G` then `N` for
notifications, `E` for Done, `Shift-U` for unread, `Shift-I` for read, and
`Shift-M` for unsubscribe. The docs also provide direct screenshots of the Inbox
indicator, bulk triage, saved notification, and custom filter form.

**Adaptation.** Model an agent observation as a queue item with a reason badge:
blocked, review requested, failed, waiting for input, or completed. Preserve
Saved/Done semantics as `keep for later` and `resolved`, with explicit retention
and undo behavior. Bulk select can acknowledge a batch of routine completions or
stop a group only after the action is stated in the row and confirmed inline.

**Do not borrow.** Do not copy the web Inbox's route change or its filter dialog
into a terminal overlay. The `Done` action must not silently erase evidence; keep a
recoverable resolved lane. Query syntax is useful as a concept, but an unbounded
filter language would dominate a small TUI.

**Sources.** [Managing notifications from Inbox](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox),
[Inbox filter reference](https://docs.github.com/en/subscriptions-and-notifications/reference/inbox-filters),
[single-notification triage](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/triaging-a-single-notification),
[keyboard shortcuts](https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts),
[bulk triage screenshot](https://docs.github.com/assets/cb-20787/images/help/notifications-v2/triage-multiple-notifications-together.png),
[custom-filter screenshot](https://docs.github.com/assets/cb-72123/images/help/notifications-v2/custom-filter-example.png).

### 7. GitHub Actions — dependency graph as the primary view

**Verified.** GitHub's official Actions documentation says every workflow run
generates a real-time graph. The graph displays each job, puts a status icon next
to its name, and uses lines to show job dependencies; selecting a job opens its
log. The documented route is repository Actions tab, workflow in the left
sidebar, run summary, then graph. GitHub's first-party changelog describes the
graph as a way to view complex workflows, track progress in real time, and reach
logs and job metadata; its example uses distinct visual states for successful,
running, and failed jobs.

**Adaptation.** Represent the parent task and child agents as a DAG. Nodes can be
queued, running, waiting, failed, stopped, or complete; edges explain why a child
has not started and what will be unblocked by its completion. The selected node
can populate a persistent detail strip or right column with the last event, tool
result, and next action. The graph can remain visible while that evidence changes.

**Do not borrow.** A graph without a textual status summary is hard to operate in
a terminal and can hide the actual failure. Do not make logs a hover card or
overlay. Do not imply dependencies that the runtime does not actually enforce;
the prototype must label simulated edges clearly in its delivery notes.

**Sources.** [Using the visualization graph](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph),
[workflow concepts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows),
[workflow visualization changelog](https://github.blog/changelog/2020-12-08-github-actions-workflow-visualization/),
[official graph screenshot](https://docs.github.com/assets/cb-63715/images/help/actions/workflow-graph.png).

### 8. Jaeger — trace waterfall with causal tree and selected details

**Verified.** Jaeger's official trace UI has a trace header with summary and
minimap controls, a timeline of nested spans, and a graph view. The official UI
configuration documents options to collapse the trace title, hide the minimap,
and hide the summary for constrained layouts. The Jaeger UI repository documents
collapsing span subtrees, a service filter that prunes unselected subtrees without
changing underlying data, a critical-path visualization, adjustable name and
timeline columns, and two detail modes: inline or side panel. The source also
records that keyboard accessibility was added for span names and child expanders.
The timeline therefore answers both “what ran concurrently?” and “which child
caused this parent’s delay?” while preserving a selected span's detail context.

**Adaptation.** Give each agent or tool round a horizontal interval on a shared
time axis, with indentation for parent/child work and a bar for active duration.
The selected row can expand an inline detail block containing its last output,
error, approval request, or artifact. Collapse/expand and service-like filters can
reduce noise without deleting history. A critical-path color or marker should be
paired with text such as `blocking 2 dependents`.

**Do not borrow.** Jaeger's service-filter popup, hover tooltip, and optional side
panel are not sufficient as the only controls under the no-overlay rule. A
waterfall can become unreadable with too many tiny spans; aggregate repetitive tool
rounds and provide a text table fallback for narrow terminals. Preserve causal
ordering when rows are collapsed.

**Sources.** [Jaeger frontend/UI configuration](https://www.jaegertracing.io/docs/2.0/deployment/frontend-ui/),
[Jaeger UI repository](https://github.com/jaegertracing/jaeger-ui),
[service filter ADR](https://github.com/jaegertracing/jaeger-ui/blob/main/docs/adr/0009-service-filter-trace-timeline.md),
[trace timeline state architecture](https://github.com/jaegertracing/jaeger-ui/blob/main/docs/rfc/0006-target-state-management-architecture.md),
[official embedded trace screenshot](https://www.jaegertracing.io/img/frontend-ui/embed-trace-view.png),
[collapsed header screenshot](https://www.jaegertracing.io/img/frontend-ui/embed-trace-view-with-collapse.png),
[constrained trace screenshot](https://www.jaegertracing.io/img/frontend-ui/embed-trace-view-with-hide-details-and-hide-minimap.png).

### 9. Visual Studio Code debugger — checkpoint inspection across targets

**Verified.** VS Code's official debugger documentation defines a Run and Debug
view, debug toolbar, debug console, and sidebar sections for Call Stack,
Breakpoints, Variables, and Watch. Continue/Pause, Step Over, Step Into, Step
Out, Restart, and Stop are explicit controls. Variable values are relative to the
selected stack frame, so changing the selected frame changes the inspector's
meaning. In multi-target debugging, each session appears as a top-level Call Stack
item, and the toolbar or stack selection changes the active session. The docs also
describe visible breakpoint/logpoint icons and filtering variables by name or
value. The official screenshots show the initial Run and Debug view, a running
debug session, and the call-stack view.

**Adaptation.** Treat an agent's current model/tool round as a checkpoint. A
left-hand execution list can show parent task, child agent, and current round;
selecting a frame changes a stable inspector with prompt context, tool input/output,
changed files, and pending decision. Expose `continue`, `pause`, `stop`, and
`retry` as text-labeled actions in a persistent toolbar or footer. Multiple active
agents can be top-level frames, while the selected frame owns the detail context.

**Do not borrow.** VS Code documents a floating debug toolbar and hover inspection;
both can turn critical controls into transient surfaces. Do not copy a giant IDE
sidebar or imply that an agent can be stepped at arbitrary model-token boundaries.
Represent only checkpoints the runtime can actually pause, resume, or retry.

**Sources.** [VS Code debugging documentation](https://code.visualstudio.com/docs/debugtest/debugging),
[debugger UI screenshot](https://code.visualstudio.com/assets/docs/debugtest/debugging/debug-start.png),
[debug session screenshot](https://code.visualstudio.com/assets/docs/debugtest/debugging/debug-session.png),
[call-stack screenshot](https://code.visualstudio.com/assets/docs/debugtest/debugging/debug-callstack.png),
[official debugger extension guide](https://code.visualstudio.com/api/extension-guides/debugger-extension).

## Candidate mental models for a genuinely different prototype

These are interaction models, not names for alternate chat layouts. Each keeps
one focused selection and a persistent detail surface; the main object changes.

| Candidate                | Dominant question                                          | Persistent screen skeleton                                                                       | Focus transition                                                                                                    | Good first scenario                                                                 | Main risk                                                                                     |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Resource Explorer**    | “What exists, and what can I inspect next?”                | Breadcrumb/header; left agent tree or resource table; center evidence; right or bottom inspector | Row selection drills from agent to artifact, tool round, approval, or failure while the resource tree stays mounted | Browse five agents, expand one failed tool result, return to the same row           | A generic list can collapse back into a chat launcher unless evidence types are first-class   |
| **Telemetry Deck**       | “What is happening across the fleet right now?”            | Metric band; compact live roster; selected-agent metrics and last event                          | Pause observation, sort/filter, then pin one agent's snapshot without changing execution                            | Watch concurrent runs, freeze the list, inspect a budget spike, resume              | Too much animation and chart density can make textual output unreadable                       |
| **Surface Workbench**    | “Which work surface should receive my attention?”          | Tab/status strip; tiled or stacked surfaces for roster, logs, diffs, tests, approvals, artifacts | Directional focus moves between evidence surfaces; the active surface owns input                                    | Keep tests, diff, and approval request visible while agents continue                | A pane per conversation merely repeats split chat; surfaces must represent different evidence |
| **Triage Queue**         | “Who is blocking me, and what decision can I make now?”    | Persistent queue grouped by priority/reason/state; inline action rail; resolved/later lane       | `ack`, `snooze`, `retry`, `stop`, or `continue` acts on the selected item and leaves an audit marker                | Process waiting-for-input and failed-agent items, then bulk-ack routine completions | Hiding items or using notification copy can erase causality and urgency                       |
| **Execution DAG**        | “Why is this work waiting, and what will it unblock?”      | Dependency graph with text status; selected-node detail strip; compact event list                | Select node, follow parent/child edges, inspect evidence without leaving the graph                                  | Show queued/running/failed/recovered children and unblock one dependent             | A graph alone lacks readable logs and can imply unsupported scheduling guarantees             |
| **Trace Waterfall**      | “When did each round run, overlap, or cause delay?”        | Shared time axis; indented agent/tool rows; collapsible spans; inline selected-span detail       | Move through rows or expand/collapse subtrees; filter service/agent groups                                          | Compare parallel work, find the critical path, inspect one failed span              | Small terminals cannot show many tiny intervals; aggregation and text fallback are required   |
| **Debugger Checkpoints** | “What state was active when this agent stopped or failed?” | Execution stack; stable Variables/Context/Watch inspector; text toolbar                          | Select session/frame, then continue/pause/stop/retry the active checkpoint                                          | Switch among agents, inspect the selected round's prompt/tool/result, recover       | Arbitrary model-token stepping is fictional unless the runtime exposes real checkpoints       |

### Recommendation for implementation selection

The most visibly divergent first pair is **Execution DAG** and **Resource
Explorer**. The graph makes dependency and blocked state primary; the explorer
makes artifacts and row actions primary. A **Trace Waterfall** is the strongest
third candidate when concurrency and duration are central. **Triage Queue** is
useful when user attention, acknowledgements, and waiting input dominate. Use
**Telemetry Deck** or **Surface Workbench** when the evaluation needs continuous
fleet awareness, but ensure their surfaces are metrics or evidence types rather
than multiple chat transcripts.

For every candidate, preserve these evidence-driven rules:

1. Keep the selected item visible in its collection and make focus explicit with
   a cursor, marker, or text label.
2. Pair every semantic color with words or symbols such as `running`, `waiting`,
   `failed`, `stopped`, or `complete`.
3. Make background progress visible and keep drafts, scroll positions, and
   observation filters attached to the selected resource or session.
4. Put search, filtering, details, and actions in allocated rows or columns;
   reserve no modal or floating surface for normal observation.
5. Show the same scenario across variants so the evaluation compares mental
   models rather than different fixtures. Mark simulated dependencies and
   execution in delivery documentation, outside the evaluated terminal.

---

# 无浮层的子代理观察：参考调研

这份笔记为新的子代理观察原型整理第一方界面参考。此前的单一对话、双栏
对话和合并时间线，仍然只是同一个聊天心智模型的不同排法。下面的参考把
主要对象改成资源、状态迁移、依赖关系、时间区间或检查点；子代理记录可以
作为这些模型中的证据表面，但不再负责组织整页界面。

来源于 2026-09-13 核查。标为“已核实”的内容来自产品官方文档、官方源码仓库
或官方截图。“改编建议”是本原型的建议，不表示来源产品已经支持子代理。

## 阅读参考时采用的约束

原型必须把观察和操作放在持续存在的终端区域中。不要把模态框、浮动面板、
弹出层、临时全屏模态层或只能悬停才能看到的详情当作主要观察方式。有些参考产品
确实使用了这些机制，相关段落会明确标出应舍弃的地方。保持在已分配的布局中
显示的行内详情、专用列或稳定详情区符合约束。

## 第一方产品参考

### 1. Lazygit：带焦点检查器的资源浏览器

**已核实。** Lazygit 是 Git 的多面板终端界面。官方 README 截图展示了侧边
资源列表、面向选中资源的较宽主视图，以及持续显示的底部按键/状态行。文档化
的导航具有层级关系：`/` 过滤当前视图；在选中的 commit 上按 `Enter` 进入文件，
在文件上按 `Enter` 进入补丁；`Esc` 返回上一个面板；`Tab` 切换面板；`+` 和 `_`
在普通、半屏和全屏模式间切换。文件视图用 `Space` 暂存选中行，`v` 开始范围选择。
README 还说明，在放大的主视图中可以查看 commit 图，向下移动时会高亮选中提交的
父提交。

**改编建议。** 把代理列表当成按阶段、负责人或产物分组的资源树，而不是聊天列表。
选中一行后，可以从代理深入到最近的工具结果、diff、审批请求或失败证据，同时保留
外围资源树。稳定的底部提示行可以公开少量上下文相关操作。

**不要借用。** Git 专用动词和大量单字母命令会遮蔽代理语义。Lazygit 还使用确认菜单
和临时菜单；本原型排除这些模态交互。占用正常布局的内容页和窗格缩放仍可使用。

**来源。** [官方 README](https://github.com/jesseduffield/lazygit)、
[按键](https://github.com/jesseduffield/lazygit/blob/master/docs/keybindings/Keybindings_en.md)、
[配置](https://github.com/jesseduffield/lazygit/blob/master/docs/Config.md)、
[官方 README 截图](https://user-images.githubusercontent.com/8456633/174470852-339b5011-5800-4bb9-a628-ff230aa8cd4e.png)。

### 2. K9s：带面包屑和行操作的实时资源表

**已核实。** K9s 将自己描述为持续观察 Kubernetes 资源变化的终端界面。官方 README
分别链接了 Pods、Logs 和 Deployments 截图。常规交互是表格导向的：选中资源后可用
`l` 打开日志、`y` 查看 YAML、`d` 查看描述、打开关联视图；`Space` 标记资源；`Ctrl-w`
切换宽列；`Ctrl-r` 刷新视图。`:` 进入资源命令模式，`/` 过滤当前视图（包含正则过滤），
`Esc` 返回上一视图。`?` 显示当前帮助，`Ctrl-a` 列出别名，`Ctrl-g` 切换面包屑。官方列配置
文档允许调节表结构、显示/隐藏/宽列和排序列，并支持实时调节。Hotkeys 文档说明自定义
资源快捷键会列在帮助中并自动重新加载。

**改编建议。** 使用一个持续刷新的紧凑代理表。列可以表示状态、当前活动、等待原因、最近
产物、token/费用预算以及依赖计数。面包屑回答“我是从哪个父任务和阶段走到这里的？”而
不必打开另一页。行操作可停止、重试、检查或标记代理；`?` 显示当前行真正可用的操作。

**不要借用。** K9s 的删除和 kill 等快捷键具有破坏性，也会在部分确认流程中使用对话框，
不应直接映射为停止代理。不要只依赖彩色状态单元格，也不要把命令提示或资源详情做成弹出层；
过滤器和检查器应占用已经分配的布局。

**来源。** [官方 README](https://github.com/derailed/k9s/blob/master/README.md)、
[命令与按键](https://k9scli.io/topics/commands/)、[Hotkeys](https://k9scli.io/topics/hotkeys/)、
[自定义列](https://k9scli.io/topics/columns/)、[Pods 截图](https://raw.githubusercontent.com/derailed/k9s/master/assets/screen_po.png)、
[Logs 截图](https://raw.githubusercontent.com/derailed/k9s/master/assets/screen_logs.png)、
[Deployments 截图](https://raw.githubusercontent.com/derailed/k9s/master/assets/screen_dp.png)。

### 3. btop：持续遥测台与冻结检查

**已核实。** 官方 btop README 描述了处理器、内存、磁盘、网络和进程的仪表盘，并链接
普通视图、TTY 视图、备用布局、主菜单、选项菜单和帮助菜单截图。功能列表明确包括可选择
的进程列表、选中进程详情、过滤、排序、进程树、鼠标滚动和暂停进程列表。因此，进程列表
可以暂时保持不动，让用户读清当前状态，而其他资源视图仍然可更新。图表框可以通过预设
重新排布，界面同时支持键盘和鼠标操作。

**改编建议。** 在屏幕上方做紧凑 fleet 遥测带：运行中、等待、失败、完成代理数，活动工具
数，以及预算或耗时计量。下方放密集代理列表和选中代理详情。`暂停观察`应该冻结变化中的
列表以便阅读，但不能改变代理执行状态；界面必须用文字显示“观察已暂停”。

**不要借用。** 不断移动的进程列表不适合阅读长工具输出。需要很宽终端的密集图表、接管屏幕
的配置菜单，以及只用颜色传递状态的做法，都不符合窄终端与可访问性目标。

**来源。** [官方 README](https://github.com/aristocratos/btop/blob/main/README.md)、
[官方 manpage](https://github.com/aristocratos/btop/blob/main/manpage.md)、
[普通仪表盘截图](https://raw.githubusercontent.com/aristocratos/btop/main/Img/normal.png)、
[TTY 截图](https://raw.githubusercontent.com/aristocratos/btop/main/Img/tty.png)、
[备用布局截图](https://raw.githubusercontent.com/aristocratos/btop/main/Img/alt.png)。

### 4. Zellij：持续表面、堆叠和明确焦点

**已核实。** Zellij 官方教程展示了顶部 tab bar（包含 session 名和 tabs）以及底部 status
bar（显示进入模式的快捷键和当前上下文操作）。平铺 pane 可用 `Alt` 加方向键或 `hjkl`
移动焦点；Pane 模式可以向下、向右或以堆叠方式创建 pane。堆叠 pane 只让非焦点项显示一
行标题，因此多个表面仍可访问而不占满宽度。Zellij 把 command pane 当作一等表面，显示退出
码、支持按 `Enter` 重跑，并可以暂停启动。功能页说明隐藏的浮动 pane 仍在后台运行，layout
可以定义 tabs、终端、命令和插件。按键指南使用明确模式（`Ctrl-p` 进入 Pane 模式），layout
指南暴露了稳定的焦点、尺寸、名称、边框和分割方向属性。

**改编建议。** 构造一个由不同证据类型组成的工作区：代理名单、事件日志、diff、测试输出、
审批队列和产物预览。当前焦点表面拥有输入权，状态行显示当前表面和可用操作。可以用堆叠把
低优先级证据压成一行，只展开当前选中项。用户切换焦点时，后台代理仍以带实时状态的紧凑行
存在，而不是消失。

**不要借用。** Zellij 的浮动和置顶 always-on-top pane 是明确的浮层，不符合约束。不要给每个
聊天开一个 pane 后就称为新模型；真正的区别应是每个表面暴露的证据类型。也不要在没有持续
状态行的情况下隐藏运行中的代理。

**来源。** [基础 UI 与 pane 教程](https://zellij.dev/tutorials/basic-functionality/)、
[功能页](https://zellij.dev/features/)、[创建 layout](https://zellij.dev/documentation/creating-a-layout.html)、
[按键预设](https://zellij.dev/documentation/keybinding-presets)、[UI 截图](https://zellij.dev/img/zellij-ui.png)、
[新 pane 截图](https://zellij.dev/img/zellij-new-panes.png)、[堆叠演示](https://zellij.dev/img/stacked-panes-feature-demo.gif)。

### 5. Linear Inbox：优先级队列与可逆分诊

**已核实。** Linear 官方 Inbox 文档描述了侧边栏中的持续通知中心，并展示带 `Priority` 与
`Other` 标签的深色截图。`G` 后按 `I` 进入 Inbox；在列表或单条通知视图中用 `J`/`K` 或
方向键移动。`U` 切换已读状态，`Alt/Option-U` 全部标记为已读，`H` 让选中通知延后。`Ctrl/Cmd-F`
打开快速搜索行，`Esc` 清除搜索。显示选项可以显示延后项、把未读置顶、启用或关闭优先级 Inbox
并选择分组。延后会把条目隐藏到指定时间，之后重新出现。打开条目会进入可修改 issue 和处理
Inbox 的特殊视图，右键则显示上下文菜单。

**改编建议。** 把“需要我决定”“等待中”“未读结果”和“稍后处理”做成明确队列状态。选中一行
即可执行可见的行内操作，如确认、延后、重试、停止或继续，不必为了清除观察记录而打开聊天。
优先级可以由阻塞影响与等待时长推导，并提供可见分组切换。

**不要借用。** 泛化的通知中心会让代理看起来像无关紧要的消息。隐藏工作时必须展示延后状态
和返回时间。不要把右键菜单、命令菜单或特殊整页详情做成唯一操作入口；应提供行内操作轨或
稳定详情区。

**来源。** [Linear Inbox 文档](https://linear.app/docs/inbox)、
[含 Priority Inbox 截图的 Changelog](https://linear.app/changelog)、
[Inbox 截图资源](https://webassets.linear.app/images/ornj730p/production/b442b340278740de70919c868dce1afca4335fe7-3600x2080.png?auto=format&dpr=2&q=95&w=1440)。

### 6. GitHub Notifications：可过滤队列与批量状态迁移

**已核实。** GitHub 官方通知文档规定，Inbox 包含尚未退订或标记 Done 的通知。左侧提供
分配、参与、请求审查和提及等默认过滤器，最多可添加 15 个自定义过滤器。选中条目可以保存、
标记 Done、退订、标记已读或未读；批量选择后可以对多个条目应用分诊操作。点击通知会进入产生
通知的对话，顶部仍保留 Done、退订、已读、保存和返回 Inbox 的操作。过滤语法支持仓库、讨论
类型、原因、作者和组织；原因包括请求审查、提及、状态变更、安全告警和 CI 活动。官方按键
参考列出 `G` 后 `N` 进入通知，`E` Done，`Shift-U` 未读，`Shift-I` 已读，`Shift-M` 退订。文档
还提供 Inbox 指示器、批量分诊、保存通知和自定义过滤器表单的直接截图。

**改编建议。** 把代理观察做成带原因标签的队列项：阻塞、请求审查、失败、等待输入或完成。
将 Saved/Done 语义改成“稍后保留”和“已解决”，同时明确保留与撤销。批量选择可以确认一批
例行完成项；停止一组任务时，只有在行内清楚写出动作并确认后才执行。

**不要借用。** 不要把 Web Inbox 的路由切换或过滤器对话框搬进终端浮层。Done 不应静默删除
证据，应保留可恢复的已解决队列。查询语法可以借用概念，但无限制过滤语言会占满小型 TUI。

**来源。** [Inbox 管理](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox)、
[Inbox 过滤器](https://docs.github.com/en/subscriptions-and-notifications/reference/inbox-filters)、
[单条通知分诊](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/triaging-a-single-notification)、
[键盘快捷键](https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts)、
[批量分诊截图](https://docs.github.com/assets/cb-20787/images/help/notifications-v2/triage-multiple-notifications-together.png)、
[自定义过滤器截图](https://docs.github.com/assets/cb-72123/images/help/notifications-v2/custom-filter-example.png)。

### 7. GitHub Actions：以依赖图为主视图

**已核实。** GitHub 官方 Actions 文档说明，每次 workflow run 都会生成实时图。图中显示每个
job，名称旁有状态图标，job 之间用连线表示依赖；选中 job 后可以打开日志。文档规定的路径是
仓库 Actions 标签页、左侧 workflow、某次 run 的摘要，再到图。GitHub 第一方 Changelog 把它
描述为查看复杂 workflow、实时追踪进度和访问日志/元数据的方式，示例用不同视觉状态表示成功、
运行中和失败。

**改编建议。** 把父任务与子代理表示成 DAG。节点状态可以是排队、运行、等待、失败、停止或
完成；边说明子任务为什么还没有开始，以及完成后会解除什么阻塞。选中节点后，在稳定详情条
或右列显示最近事件、工具结果和下一步操作，图本身保持可见。

**不要借用。** 没有文字状态摘要的图在终端中难以操作，也会藏住真实失败。不要把日志做成悬停
卡片或浮层。不要暗示运行时并未真正执行的依赖；原型中模拟的边必须在交付文档中明确标出。

**来源。** [可视化图](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph)、
[workflow 概念](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows)、
[workflow 可视化 Changelog](https://github.blog/changelog/2020-12-08-github-actions-workflow-visualization/)、
[官方图截图](https://docs.github.com/assets/cb-63715/images/help/actions/workflow-graph.png)。

### 8. Jaeger：带因果树和选中详情的 trace 瀑布

**已核实。** Jaeger 官方 trace UI 有包含摘要和 minimap 控制的 trace header、嵌套 span 的时间
轴以及图视图。官方 UI 配置文档提供折叠 trace 标题、隐藏 minimap、隐藏摘要的选项，以适应
空间受限的布局。Jaeger UI 仓库记录了折叠 span 子树、仅保留选中服务并裁剪其子树且不改变
底层数据的 service filter、critical path 可视化、可调名称列/时间轴列，以及行内或侧边详情两种
模式。源码还记录了为 span 名称和子展开器增加键盘可访问性。因此时间轴同时回答“哪些工作并发？”
和“哪个子任务造成父任务延迟？”，并保留选中 span 的详情上下文。

**改编建议。** 给每个代理或工具轮次分配共享时间轴上的水平区间，用缩进表达父子工作，用条形
表示活动时长。选中行可展开行内详情，显示最近输出、错误、审批请求或产物。折叠/展开和类似
service 的过滤器可以降低噪声但不删除历史。critical path 的颜色或标记必须和“阻塞 2 个依赖项”
这样的文字同时出现。

**不要借用。** Jaeger 的 service-filter 弹出层、悬停 tooltip 和可选侧边面板，在无浮层规则下
都不能成为唯一控制。瀑布图在大量微小 span 时会失去可读性；应聚合重复工具轮次，并为窄终端
提供文字表格兜底。折叠行时仍需保留因果顺序。

**来源。** [Jaeger 前端/UI 配置](https://www.jaegertracing.io/docs/2.0/deployment/frontend-ui/)、
[Jaeger UI 仓库](https://github.com/jaegertracing/jaeger-ui)、[service filter ADR](https://github.com/jaegertracing/jaeger-ui/blob/main/docs/adr/0009-service-filter-trace-timeline.md)、
[trace 时间轴状态架构](https://github.com/jaegertracing/jaeger-ui/blob/main/docs/rfc/0006-target-state-management-architecture.md)、
[官方嵌入 trace 截图](https://www.jaegertracing.io/img/frontend-ui/embed-trace-view.png)、
[折叠标题截图](https://www.jaegertracing.io/img/frontend-ui/embed-trace-view-with-collapse.png)、
[受限布局截图](https://www.jaegertracing.io/img/frontend-ui/embed-trace-view-with-hide-details-and-hide-minimap.png)。

### 9. Visual Studio Code 调试器：跨目标的检查点观察

**已核实。** VS Code 官方调试文档定义了 Run and Debug 视图、调试工具栏、调试控制台，以及
包含 Call Stack、Breakpoints、Variables 和 Watch 的侧栏。Continue/Pause、Step Over、Step
Into、Step Out、Restart 和 Stop 都是明确操作。变量值相对于选中的 stack frame，因此切换 frame
会改变检查器的含义。多目标调试时，各 session 成为 Call Stack 顶层项，工具栏或 stack 选择会
改变活动 session。文档还说明 breakpoint/logpoint 的可见图标，以及按名称或值过滤变量。官方截
图展示初始 Run and Debug、运行中的调试 session 和 call-stack 视图。

**改编建议。** 把代理当前模型/工具轮次看作检查点。左侧执行列表显示父任务、子代理和当前轮次；
选中 frame 后，稳定检查器展示 prompt 上下文、工具输入/输出、变更文件和待决策。用持续工具栏
或底栏暴露 `continue`、`pause`、`stop` 和 `retry` 等文字操作。多个活动代理可以是顶层 frame，
而选中的 frame 拥有详情上下文。

**不要借用。** VS Code 文档中的浮动调试工具栏和悬停检查，会把关键控制变成临时表面。不要照搬
巨大 IDE 侧栏，也不要暗示可以在任意模型 token 边界暂停代理。只表示运行时真正可以暂停、继续
或重试的检查点。

**来源。** [VS Code 调试文档](https://code.visualstudio.com/docs/debugtest/debugging)、
[调试器 UI 截图](https://code.visualstudio.com/assets/docs/debugtest/debugging/debug-start.png)、
[调试 session 截图](https://code.visualstudio.com/assets/docs/debugtest/debugging/debug-session.png)、
[call-stack 截图](https://code.visualstudio.com/assets/docs/debugtest/debugging/debug-callstack.png)、
[官方调试器扩展指南](https://code.visualstudio.com/api/extension-guides/debugger-extension)。

## 真正不同于聊天排列的候选心智模型

下面是交互模型，不是聊天布局的别名。每个模型都保留一个明确选中项和持续详情表面，改变的
是主要对象。

| 候选           | 主要问题                               | 持续屏幕骨架                                                      | 焦点如何变化                                                   | 适合的首个场景                                    | 主要风险                                                 |
| -------------- | -------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| **资源浏览器** | “现在有什么，下一步可以检查什么？”     | 面包屑/标题；左侧代理树或资源表；中央证据；右侧或底部检查器       | 选中行从代理深入到产物、工具轮次、审批或失败，同时资源树不卸载 | 浏览五个代理，展开一个失败工具结果，再返回原行    | 如果证据类型不是一等对象，普通列表会重新变成聊天启动器   |
| **遥测台**     | “整个 fleet 此刻发生什么？”            | 指标带；紧凑实时名单；选中代理指标和最近事件                      | 暂停观察、排序/过滤，再固定一个代理快照而不改变执行            | 观察并发运行，冻结名单，检查预算峰值，再恢复      | 动画和图表过多会让文字输出难读                           |
| **表面工作区** | “哪个工作表面现在需要我的注意？”       | tab/status 条；名单、日志、diff、测试、审批、产物等平铺或堆叠表面 | 方向键在证据表面间移动，当前表面拥有输入                       | 代理继续时同时保留测试、diff 和审批请求           | 每个聊天一个 pane 只是重复双栏聊天；表面必须代表不同证据 |
| **分诊队列**   | “谁在阻塞我，现在能做什么决定？”       | 按优先级/状态/原因分组的持续队列；行内操作轨；已解决/稍后队列     | 对选中项执行确认、延后、重试、停止或继续，并留下审计标记       | 处理等待输入和失败代理，再批量确认例行完成        | 隐藏条目或照搬通知文案会抹掉因果和紧迫性                 |
| **执行 DAG**   | “为什么在等待，完成后会解除什么阻塞？” | 带文字状态的依赖图；选中节点详情条；紧凑事件表                    | 选节点、沿父子边移动，在图旁检查证据                           | 展示排队/运行/失败/恢复的子代理，解除一个依赖     | 图本身缺少可读日志，也可能暗示运行时没有的调度保证       |
| **Trace 瀑布** | “每轮何时运行、重叠或造成延迟？”       | 共享时间轴；缩进的代理/工具行；可折叠 span；选中 span 行内详情    | 在行间移动或折叠子树，过滤代理组                               | 比较并行工作，找到 critical path，检查失败 span   | 窄终端放不下很多小区间，需要聚合和文字兜底               |
| **调试检查点** | “代理停止或失败时，哪个状态处于活动？” | 执行栈；稳定 Variables/Context/Watch 检查器；文字工具栏           | 选择 session/frame，再操作活动检查点的继续/暂停/停止/重试      | 在代理间切换，检查某轮 prompt/工具/结果，恢复运行 | 如果运行时没有真实检查点，任意 token 级单步就是虚构      |

### 实现选择建议

最容易一眼看出差异的首对是**执行 DAG**与**资源浏览器**。图把依赖和阻塞状态放在首位，
浏览器把产物和行操作放在首位。并发和耗时是核心时，**Trace 瀑布**是第三个强候选。用户
注意力、确认和等待输入占主导时，使用**分诊队列**。需要持续 fleet 感知时可以使用**遥测台**
或**表面工作区**，但表面应是指标或证据类型，而不是多个聊天记录。

每个候选都应保留这些有来源依据的规则：

1. 选中项留在它所属的集合中，用光标、标记或文字标签明确焦点。
2. 每个语义颜色都配合 `running`、`waiting`、`failed`、`stopped` 或 `complete` 等文字/符号。
3. 后台进度保持可见；草稿、滚动位置和观察过滤器绑定在选中的资源或 session 上。
4. 搜索、过滤、详情和操作放在已经分配的行或列中；正常观察不保留模态或浮动表面。
5. 各变体使用同一场景，让评估比较心智模型而不是不同样例。模拟依赖和模拟执行写在交付
   文档中，不占被评估的终端界面。
