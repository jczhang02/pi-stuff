<!-- translation-source: docs/research/pi-stuff-operation-block-dialog-study-20260829.md; translation-source-sha256: d04d875923e69a454d45e6a92bf050300056f65e8c3f3f73add93a3c8255d937 -->
# Pi Stuff 操作块与 Tool 对话框研究

状态：工作设计记录，不是已接受的行为或实现权威。

快照日期：2026-08-29。本研究记录当前讨论及其配套的真实 Host `/tools` Dialog 捕获。本文档不会改变任何 Tool 执行、Session 协议或已发布的渲染器行为。

## 权威性与冲突

当前行为仍由 `CONTEXT.md`、`DESIGN.md`、Tool Display Module README 和 ADR 0022 规定。
ADR 0022 有意拒绝了通用的 Claude 风格 `Tool(args)` 加子状态块，并保留了 Tool 专属的独立形态。本研究**不**提出通用卡片，而是探索一组有界的 Tool 专属块：仅当子项是有用的结果证据时，它们才共享父项/子项阅读顺序。

如果接受该提案，必须在实现前解决其与 ADR 0022 的关系。在此之前：

- **Bash Operation Block** 仍是唯一已接受的 Operation Block 术语和实现。
- 下文的 **Operation Block** 是所提议系列的工作用语。
- 研究示例是证据和设计意图，不是关于当前 UI 的声明。

## 工作术语

**Operation Block**：
对一个独立 Tool Activity 的仅显示投影，具有有界的操作身份，并在调用原生 Transcript 位置显示缩进的子结果预览。
展开后显示更多由 Tool 所拥有的证据，但不会改变协议事件、Session 历史或 Tool 结果。

**Bash Operation Block**：
现有的 Bash 专用块，其父项是有界命令，子项是有界 stdout/stderr 和终端状态证据。

避免使用以下名称：

- **Command Block**：错误地暗示每个操作都是 shell 或 Host 命令。
- **Log Block**：只描述一种可能的子项表示。
- **Tool Card**：与扁平、终端原生的视觉语言冲突。
- **Universal Tool Block**：与 Tool 专属所有权和 ADR 0022 冲突。

当前研究的关系是：

```text
Tool Activity
└─ Operation Block
   ├─ Bash Operation Block
   ├─ File Mutation Operation Block
   ├─ Background Output Operation Block
   ├─ MCP Invocation Operation Block
   └─ Code Mode Failure Operation Block
```

## 决策规则

仅当以下条件全部满足时，才使用 Operation Block：

1. 调用具有可识别的操作身份。
2. 其结果包含具体证据，且比 `done` 或 `applied` 这样的终端词更有用。
3. 证据具有有界的紧凑预览和有用的展开表示。
4. 该块不会重复 Todo、Agent roster、Goal status 或媒体等其他可见权威。

当 Tool 属于检索聚合、生命周期控制、通信、结构化/媒体输出，或属于有意保持静默的成功基础设施时，保留现有语义形态。

## 完整 Tool 决策矩阵

| # | Tool | 当前紧凑权威 | Operation Block 决策 |
| ---: | --- | --- | --- |
| 1 | `read` | Retrieval Group | 保留；分组检索比独立块更有用。 |
| 2 | `write` | 独立的 `Write path · line count` 行 | 采用 File Mutation Operation Block。 |
| 3 | `edit` | 独立的 `Edit path · applied` 行 | 采用 File Mutation Operation Block。 |
| 4 | `grep` | Retrieval Group | 保留。 |
| 5 | `find` | Retrieval Group | 保留。 |
| 6 | `ls` | Retrieval Group | 保留。 |
| 7 | `bash` | Bash Operation Block | 现有参考；保留。 |
| 8 | `apply_patch` | 独立的 `Patch target · changed files` 行 | 采用 File Mutation Operation Block。 |
| 9 | `view_image` | Media projection | 保留。 |
| 10 | `imagegen` | Media projection | 保留。 |
| 11 | `goal_complete` | Goal lifecycle event | 保留。 |
| 12 | `goal_blocked` | Goal lifecycle event | 保留。 |
| 13 | `web_search` | Web retrieval row | 保留。 |
| 14 | `fetch_content` | Web document row | 保留。 |
| 15 | `get_search_content` | Web continuation row | 保留。 |
| 16 | `mcp` | Independent semantic MCP row | 有条件采用：仅限具有有界多行文本/日志证据的直接调用。 |
| 17 | `background` | Background Work lifecycle/management row | 有条件采用：仅限 `action: "output"`。保留 `list` 和 `stop`。 |
| 18 | `monitor` | Monitor lifecycle row | 保留；后续完成属于不同的事件边界。 |
| 19 | `subagent` | Agent lifecycle row and Agent-owned surfaces | 保留。 |
| 20 | `TaskCreate` | Compact-silent; Todo is authority | 保留。 |
| 21 | `TaskGet` | Compact-silent; Todo is authority | 保留。 |
| 22 | `TaskList` | Compact-silent; Todo is authority | 保留。 |
| 23 | `TaskUpdate` | Compact-silent; Todo is authority | 保留。 |
| 24 | `ctx_expand` | Context semantic row | 保留。 |
| 25 | `ctx_search` | Context semantic row | 保留。 |
| 26 | `ctx_memory` | Context semantic row | 保留。 |
| 27 | `ctx_note` | Context semantic row | 保留。 |
| 28 | `ctx_reduce` | Successful call is compact-silent | 保留。 |
| 29 | `subagent_supervisor` | Agent lifecycle/control row | 保留。 |
| 30 | `intercom` | Agent communication row | 保留。 |
| 31 | `contact_supervisor` | Agent communication row | 保留。 |
| 32 | `structured_output` | Structured result authority | 保留。 |
| 33 | `tool_search` | Successful call is Transcript-transparent | 保留。 |
| 34 | `codemode` | Nested Tool/media authority; outer fallback on issue | 有条件采用：仅限未匹配错误、拒绝或取消。 |

Tool 名称统计：一个现有 Operation Block（`bash`），三个拟议的无条件使用者（`write`、`edit`、`apply_patch`），三个有条件使用者（`background`、`mcp`、`codemode`），以及 27 个保留当前语义系列的 Tool 名称。

## 拟议的 Transcript 形态

| Tool/状态 | 当前紧凑形态 | 拟议紧凑形态 |
| --- | --- | --- |
| `bash` | 带有 `⎿` 输出的 `Bash(command)` | 不变的参考形态。 |
| `write` | `Write path · N lines` | `Write(path)`，子项为 `Created/Overwritten · N lines · bytes`。 |
| `edit` | `Edit path · applied` | `Edit(path)`，子项为 `Replaced N lines · +A/−B`；展开详情拥有有界 diff。 |
| `apply_patch` | `Patch target · changed N files` | `Patch(N files)`，子项为 `+A/−B · paths`；展开详情拥有有界 diff。 |
| `background`、`output` | `Background task-id · read` | `Background(task-id)`，带有最近输出子项和省略行通知。 |
| `mcp`、直接文本调用 | `MCP target · done` | `MCP(server.tool)`，带有有界参数身份和多行结果子项。 |
| `codemode`、未匹配问题 | `Code Mode · <issue>` 回退行 | `Code Mode(<bounded code identity>)`，带有错误/拒绝/取消子项。 |

## 当前 `/tools` Dialog 契约

已发布的 Dialog 有两种导航模式（`list`、`detail`）和两种详情表示（`formatted`、`raw`）。
在较宽宽度下，它使用一个固定的分栏 Dialog；窄模式则在相同的列表和详情内容之间移动。

当前列表行只显示 Tool Activity 摘要、状态字形和可选调用计数。它们不会将 Tool 名称、目标、操作子类型或 Operation Block 子类型作为一级列表数据保留。

当前格式化详情显示：

```text
Tools / <activity summary>
<state icon> <complete state> · <call count>

◆ Result
<unlabelled target when available>
<Tool-owned formatted result>
```

对于单例 activity，Header 中不保证出现 Tool 身份和目标。只有当 activity 包含多个调用时，Tool/member 行才会出现。
Raw 表示仍是协议检查权威，并包含 call ID、Tool 名称、参数、结果内容和 details。

这造成了主要设计缺口：Dialog 当前无法从其一级 `ToolActivityView` 可靠地投影所提议的 Operation Block 系列，因为该 view 目前缺少 Tool 名称、目标、操作子类型和块子类型元数据。

## 当前 Dialog 捕获证据

证据通过真实 Pi 0.84.3 在 120×50 PTY 中使用已存储的 Tool 调用/结果重放。重放期间未调用 Tool executor。每个选中详情都在隔离的 Host 进程中捕获。格式化捕获首先必须匹配其确切 Header；随后切换到 Raw 时必须显示确切的 fixture call ID。这样可以防止捕获之间泄漏选择状态。

| 候选项/状态 | 当前列表行 | 当前格式化详情 | 当前相对于提案的限制 |
| --- | --- | --- | --- |
| `write`，成功 | `Write · 3 lines` | `Tools / Write · 3 lines`；目标 `config/generated.json`；`◆ Result` 下显示 `Successfully wrote 22 bytes…`。 | 列表和 Header 省略了路径；语义变更只能从结果说明中推断。 |
| `edit`，成功 | `Edit · +1/-1` | `Tools / Edit · +1/-1`；目标 `src/worker.ts`；`◆ Result` 下显示成功说明。 | Header 省略了路径，格式化详情也没有显示已有的 diff。 |
| `bash`，成功 | `Bash · done` | `Tools / Bash · done`；描述 `Tool Display tests`；`◆ Result` 下显示四行输出。 | 虽然结果本身得到保留，但列表和 Header 都没有命令身份。 |
| `apply_patch`，成功 | `Patch · changed 2 files` | `Tools / Patch · changed 2 files`；目标 `src/a.ts +1`；`◆ Result` 下显示两个路径。 | 文件集合有用，但已有的 patch 证据只能在 Raw 中看到。 |
| `background`、`output` 成功 | `Background · read` | `Tools / Background · read`；任务 `bg-build-42`；`◆ Result` 下显示最近四行。 | 列表和 Header 都没有说明 `output`，也没有标识任务。 |
| `mcp`，直接调用成功 | `MCP · done` | `Tools / MCP · done`；目标 `repo:repo.build`；`◆ Result` 下显示三行返回内容。 | 列表和 Header 都缺少目标和操作身份。 |
| `mcp`，直接调用错误 | `MCP · failed` | `Tools / MCP · failed`；`× error`；目标 `repo:repo.build`；`◆ Result` 下显示完整错误。 | 列表和 Header 都缺少目标。 |
| `mcp`，拒绝 | `MCP · failed` | `Tools / MCP · failed`；`! warning`；目标 `repo:repo.deploy`；`◆ Result` 下显示阻止消息。 | 拒绝被标为 `failed`，在列表中无法与取消区分。 |
| `mcp`，取消 | `MCP · failed` | `Tools / MCP · failed`；`! warning`；目标 `repo:repo.watch`；`◆ Result` 下显示取消消息。 | 取消被标为 `failed`，在列表中无法与拒绝区分。 |
| `codemode`，错误 | `Code Mode · Code Mode failed: atlas failure` | Header 重复同一问题；`× error`；`◆ Result` 为空。 | 可操作问题位于界面框架而非结果正文中，并且缺少代码身份。 |
| `codemode`，拒绝 | `Code Mode · Tool execution was blocked by the user` | Header 重复同一问题；`! warning`；`◆ Result` 为空。 | 缺口相同；拒绝没有专用的格式化区段。 |
| `codemode`，取消 | `Code Mode · Code Mode execution was cancelled` | Header 重复同一问题；`! warning`；`◆ Result` 为空。 | 缺口相同；取消没有专用的格式化区段。 |
| 成功的 `codemode`，嵌套 `read` | `Read 1 file` | `Tools / Read 1 file`；目标 `nested.txt`；`◆ Result` 下显示嵌套结果。 | 没有缺口：成功的外层 Code Mode 封装不存在，嵌套 Tool 仍是唯一权威。 |

每一行都捕获了 Raw 表示。它始终显示 `Call ID`、`Tool name`、`Arguments`、`Result content` 和 `Details`；长载荷会纵向分页。成功的 Code Mode 路径在 Raw 中解析为 call ID `dialog-code-success-read` 和 Tool 名称 `read`，确认检查权威属于嵌套操作，而不是外层封装。

这些捕获为本提案确立了四个具体的 Dialog 缺口：

1. 单例 activity 的列表和详情 Header 摘要丢失目标/操作身份。
2. MCP 拒绝和取消虽然处于 warning 状态，却都折叠为相同的 `failed` 摘要。
3. Code Mode 的问题文本放在列表/Header 中，而格式化的 `◆ Result` 为空。
4. Raw 信息完整但面向协议；它不能替代 Tool 专属的格式化证据。

## 拟议的 `/tools` Dialog 语法

Operation Block 仍是 Transcript 投影。Dialog 不应绘制 `⎿` 连接符或复现紧凑块，而应使用 Tool 专属语义区段检查同一 activity。

### 列表窗格

每个候选列表行都应在结果之前保留身份：

```text
› <Tool label> <target> · <semantic outcome> <state icon>
```

在窄宽度下，应在截断 Tool 身份和可操作结果之前移除计数和目标片段。

### 格式化详情窗格

| 候选项 | Header | Tool 专属区段 |
| --- | --- | --- |
| `bash` | `Tools / Bash · <description or bounded command>` | `◆ Command`、`◆ Output`、终端状态和省略输出通知。 |
| `write` | `Tools / Write · <path>` | `◆ Change`：创建/覆盖、行数、字节数。内容仍保留在 Raw 中，除非未来有界预览被证明有用途。 |
| `edit` | `Tools / Edit · <path>` | `◆ Change`：替换摘要；`◆ Diff`：有界的 Tool 所有 diff。 |
| `apply_patch` | `Tools / Patch · <path or N files>` | `◆ Files`：创建/更改/移动/删除；`◆ Diff`：有界 patch 证据；出现时显示 fuzz 警告。 |
| `background`、`output` | `Tools / Background output · <task-id>` | `◆ Background`：任务身份/状态；`◆ Output`：最近的有界输出以及省略的字节/行证据。 |
| `mcp`、直接文本调用 | `Tools / MCP · <server.tool>` | `◆ Invocation`：有界的有意义参数；`◆ Result`：有界的返回文本/日志。结构化/媒体结果保留其所属表示。 |
| `codemode`、未匹配问题 | `Tools / Code Mode · <bounded code identity>` | `◆ Code`：仅有界身份；`◆ Error`、`◆ Rejection` 或 `◆ Cancellation`：完整的可操作问题。嵌套的成功 activity 仍是唯一权威。 |

### Raw 详情

Raw 保持不变，并继续暴露协议层面的 call ID、Tool 名称、完整参数、结果内容和 details。拟议的格式化区段不得为了填充空间而复制协议字段。

## 证据待办

候选集的宽屏当前状态证据已经完整。其余证据应等到提案获得已接受的权威并具有具体 formatter 后再收集：

1. 捕获已实现内容在窄屏和低高度下的几何表现，包括截断和分页。
2. 验证 Bash、Background 输出和 MCP 文本结果的有界输出省略通知。
3. 在 Tool 专属的格式化区段实现后，捕获 Edit 和 Patch diff。
4. 实现后重新运行相同的隔离选择/Raw ID 检查。

使用经认证的真实 Pi Host 和确定性的已存储 Tool 结果。不要仅为获取 UI 证据而调用 file、shell、network、Goal、Agent、background 或 MCP effects。
