<!-- translation-source: docs/research/agent-activity-ui-reference.md; translation-source-sha256: 9dafe3f1cfa2a7f20d55f68b08228f22798527b835a7361413478f33fff8f45b -->
# Agent 活动 UI 参考：Claude Code 与 `pi-subagents`

**研究日期：** 2026-08-01
**决策更新：** 2026-08-17
**范围：** 当一个或多个 Agent 处于排队、运行、完成、失败、停止或等待输入状态时，用户在主编码对话中看到的内容。管理界面仅用于保持其与 transcript 记录的区别。

## 结论

当前 Pi Stuff 方向将类似 Claude 的 roster 与刻意缩小的生命周期结合起来：

- 保留 **Pi Stuff 已接受的 transcript 生命周期**：一条紧凑的启动记录、一条已定稿的分组结果，以及按需查看详情。Claude Code 支持紧凑的启动/通知语法，但其捕获的后台完成状态是每个 Agent 一条通知，而不是 Pi Stuff 的分组结果。
- 使用 **Claude Code 的编辑器下方 roster 语法**：`main` 加上每个子 Agent 一行、实心圆选择标记，以及仅在编辑器为空时通过键盘进入。
- 保留 **Tintinweb 诚实的生命周期状态**作为能力输入，但不复刻其编辑器上方的活动组件、Agent statusline 或居中的对话查看器。
- **不要**继承 Tintinweb 的三个同时存在的实时状态投影，也不要继承居中的对话覆盖层。持久化的启动/工具记录可以与一个实时 roster 共存，因为它们回答不同问题；同一份变化中的细节不能同时在编辑器上方、下方和 statusline 中重复。
- 严格区分：(1) 持久化对话记录，(2) 瞬时实时活动，以及 (3) 明确打开且不浮动的管理/详情视图。

具体规则是：**对话说明发生了什么；单一实时 roster 说明正在发生什么；Command Dialog 展示其余所有内容。**

## 当前 roster 决策与原生 Pi 证据

此前限定的编辑器上方方案已被取代。Pi Stuff 保留其生命周期语义，但将唯一的实时 roster 放在**编辑器下方**，遵循 Claude Code 的交互模型。决策前比较了三种原生 Pi 投影：

1. **垂直 sessions——已选择：** `main` 和每个 Agent 各占一行；左侧显示任务，右侧显示最短状态。
2. **分组批次：** 增加所有权标题，但会重复 transcript 中已有的批次上下文，并占用更多高度。
3. **水平 rail：** 最大限度减少高度，但在选择前会隐藏同时存在的子任务和状态。

被舍弃的 prototype 证明，无需 fork Pi，即可通过公开的 `setWidget(..., { placement: "belowEditor" })`、`onTerminalInput` 和非 overlay 的 `ctx.ui.custom()` 接口实现这一点。其日期为 Pi `0.83.0` 的 capture 覆盖了真实选择和 Enter-to-detail 输入，并使用确定性的生命周期数据。当前行为与验收归 Agents Module 及其真实 Host verifiers 所有；Git history 保留该 prototype。

## 来源与复用限制

### Claude Code

行为根据 Anthropic 当前文档及截至 Claude Code **2.1.220** 的官方 changelog 检查。检查到的本地 CLI 也报告版本为 `2.1.220`。对于默认后台执行、权限提示、`/tasks` 和 team 控制等行为，当前文档是权威来源（[subagents documentation](https://code.claude.com/docs/en/sub-agents)、[agent teams documentation](https://code.claude.com/docs/en/agent-teams)、[official changelog at v2.1.220](https://github.com/anthropics/claude-code/blob/v2.1.220/CHANGELOG.md)）。

并行生命周期的精确视觉证据来自真正的 Claude Code **2.1.197** Linux x64 npm release binary（SHA-256 `f54e69cbc89b2da61a415700af7ff52a147e862517d4f1b0eecf768448cf7f83`）。它在隔离的 `100 × 32` PTY 中以黑盒方式驱动。仅限 localhost 的 Anthropic Messages fixture 发出了两个并发 Agent 调用，并将不使用工具的结果延迟 12 秒。没有使用用户的 Claude 配置、凭据、session、源代码或外部 model API。因此，renderer、键盘路径、foreground-to-background 转换和完成通知都是真实 release 行为；任务文本则来自确定性的 fixture。已移除的 harness 仍可从 Git history 恢复。

一些布局决策在 `tanbiralam/claude-code` 的 commit [`6f6f12b`](https://github.com/tanbiralam/claude-code/tree/6f6f12b37f529488b10e53928dd5508bb93535c7) 中检查过。该 repository 不是 Anthropic 的官方 source release，包含重构/压缩后的材料，无法可靠关联到公开的 Claude Code 版本，而且检查时的 commit 没有 license 文件。因此它**仅作为产品证据**：不要复制、翻译、改编或移植其中的代码或组件结构。

### Tintinweb `pi-subagents`

源代码行为在当前 `master` commit [`2966cd5`](https://github.com/tintinweb/pi-subagents/tree/2966cd5a33c0640de9698b56a39c11f83207a835) 检查。package 声明 MIT，并仍将自身标识为 `0.14.3`（[package manifest](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/package.json#L1-L10)），但该 commit 包含 `Unreleased` 条目。实际 npm `0.14.3` release 报告的 git head 是 `c10b1836256e760da75296ccd4e57a77ada1325e`（[registry record](https://registry.npmjs.org/@tintinweb%2Fpi-subagents/0.14.3)）。未来的 fork 必须选择并记录一个精确 base；二者不可互换。

## 四个 surface 不得混淆

| Surface | 生命周期 | 用途 | Claude Code | Tintinweb | Pi Stuff 方向 |
|---|---|---|---|---|---|
| Agent tool record | 持久化对话历史 | 展示调用及已定稿结果 | 紧凑 Agent record；并行调用可以共享一个 tree | 每次调用一个 Pi tool result | 类 Claude 的分组 record |
| Live activity | 仅在工作活跃期间存在，并短暂保持终态 | 回答“有哪些 session，以及它们处于什么状态？” | 紧凑的编辑器下方 Agent roster | 编辑器上方 widget，加上 FleetView 和 statusline | 一个编辑器下方垂直 roster，不使用 statusline |
| Completion notification | 插入对话后持久存在 | 告知 parent 和用户后台结果已到达 | 一个彩色圆点和摘要 | 带 stats 和 preview 的样式化 block；支持分组交付 | 紧凑结果行；展开查看 preview |
| Management/detail UI | 明确打开；不属于 transcript | 浏览、操控、停止、阅读完整对话 | `/tasks`、Agent panel，以及独立的 `claude agents` view | `/agents`；FleetView 中按 Enter 打开居中的 conversation viewer | 使用通用 Pi Stuff panel 模式的非浮动 Command Dialog |

这一点很重要，因为旧版 Claude Code `/agents` wizard 已不再是正常的 Agent activity UI。官方 v2.1.198 changelog 移除了该 wizard；当前 `/agents` 报告 Agent locations。全屏 `claude agents` 产品也是独立 surface，不是 transcript component（[current agents documentation](https://code.claude.com/docs/en/agents)、[agent view documentation](https://code.claude.com/docs/en/agent-view)）。

## Claude Code：主对话中的具体行为

### 2.1.197 中直接观察到的并行生命周期

已发布的 binary 确认了此前 source study 无法确认的八个细节：

1. Foreground parallel work 同时拥有持久化 conversation group 和编辑器下方可选择的 Agent roster。roster 不是 statusline 或 overlay：它有一个 `main` 行，以及每个 child 一行。
2. 紧凑 group 起始为 `Running 2 agents… (ctrl+o to expand)`。每个 child 最初显示其配置类型、任务描述、tool-use count 和 `Initializing…`。
3. 按 `Ctrl+B` 会将未解决的 group 放入后台。transcript projection 收缩为 `2 background agents launched (↓ to manage)`，main Agent 继续运行，底部 roster 保持不变。
4. Foreground completion 会将 group 改为 `2 agents finished`，children 改为 `Done`。Background completion 则为每个 child 插入一条绿色通知，并向 roster 添加 elapsed/token stats。
5. `Ctrl+O` 是全局详细 transcript 模式。它将紧凑 group 替换为独立的 Prompt、Response、tool-use、token 和 duration blocks，然后在底部显示 `Showing detailed transcript · ctrl+o to toggle`。
6. 编辑器为空时，Down 进入 roster management，并将提示改为 `↑/↓ to select · Enter to view`；实心圆最初标记 `main`。
7. 再按一次 Down 选择第一个 child，并显示 view/stop controls。选择通过移动实心圆表达，而不是绘制带框的行。
8. 对 child 按 Enter 会在主工作区打开该 child session，同时 roster 保持该 child 处于选中状态。

这些观察取代了早期将源代码推导出的布局称为“Claude screenshot”的说法。frames 和 comparison reports 是决策证据而不是当前产品权威，如今仅保留在 Git history 中。

### 单个 foreground agent

运行期间，Agent tool record 只保留一个很小的活动窗口。被检查的 snapshot 最多使用三个最近的 progress messages，在尚无活动时显示 initializing state；当终端过短时，则将 body 替换为一行 progress summary（[Agent UI source](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/UI.tsx#L33-L33)、[progress rendering](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/UI.tsx#L444-L569)）。隐藏的工作以 count 表示，而不是增加更多行。

行为示意，不是复制的 source：

```text
● Explore  Find authentication path
  ⎿ Reading middleware.ts
  ⎿ Searching for session checks
  +7 earlier tool calls  (ctrl+o for detail)
```

完成后，变化中的 activity 被包含 tool-use count、token count 和 duration 的稳定终态摘要替代。Expanded transcript mode 可以显示 prompt、完整 progress transcript 和 response（[completion rendering](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/UI.tsx#L315-L409)）。这是现有 record 内的渐进式披露，而不是新增 card。

### 并行 agents

Claude Code 仅在两个或更多 Agent calls 来自**同一个 assistant response**，并且使用同一个支持分组的 tool 时，才会将其分组。Verbose/transcript mode 会恢复成独立 records（[grouping rule](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/utils/groupToolUses.ts#L48-L64)、[group construction](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/utils/groupToolUses.ts#L83-L181)）。它不是对 session 中全部 agents 的全局分组。

紧凑 group 有一个 parent headline，以及每个 agent 一个 tree child。每个 active child 都有自己的短任务 label、statistics 和最新 action。已完成的 foreground children 变为 `Done`；background launches 隐藏容易误导的 completion statistics，并说明它们正在后台继续（[grouped Agent rendering](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/UI.tsx#L649-L758)、[child-row component](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/components/AgentProgressLine.tsx)）。

行为示意：

```text
● Running 3 agents…
  ├─ Explore  Trace authentication
  │  ⎿ Searching route guards
  ├─ Explore  Check tests
  │  ⎿ Reading auth.integration.test.ts
  └─ Reviewer  Inspect failure paths
     ⎿ Waiting for first result
```

有价值的想法是：**一个 parent event 搭配独立变化的 children**。它让一次并行 model call 占据一个视觉位置，同时不隐藏哪个 child 卡住或失败。

### 后台启动与完成

后台启动会将原始 tool row 定稿为简短的“backgrounded”状态，并带有 management 和 expansion hints。其结果稍后作为独立的 task notification 到达。被检查的 renderer 刻意将该 notification 缩减为状态颜色的圆点加摘要；不会将结果直接倾倒进对话（[launch rendering](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/UI.tsx#L341-L363)、[notification renderer](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/components/messages/UserAgentNotificationMessage.tsx#L11-L82)）。靠近 prompt 的 pending notifications 最多显示三行，溢出部分聚合（[queued notification cap](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/components/PromptInput/PromptInputQueuedCommands.tsx#L29-L69)）。

当前 Claude Code 行为增加了 snapshot 无法建立的重要生命周期细节：

- 从 v2.1.198 起，除非立即需要结果，否则 subagents 默认在后台运行。Claude 会等待真正的 completion notification 后再报告结果（[official subagent docs](https://code.claude.com/docs/en/sub-agents)）。
- Background subagent 的 permission request 会在 main session 中显示，并指出发出请求的 agent。批准后继续；拒绝会拒绝该 tool，但不一定终止 agent（[official subagent docs](https://code.claude.com/docs/en/sub-agents)）。这是当前与 **needs input** 最接近的等价物。
- 已完成的 background tasks 仍在 `/tasks` 可见，而失败或停止的 tasks 会离开该列表。这是 management-state 行为，不是持久化 transcript-row 规则（[official subagent docs](https://code.claude.com/docs/en/sub-agents)）。
- 在 team mode 中，agent panel 支持选择、查看/发送 transcript、interrupt、折叠 idle row 和定时隐藏。这些 controls 属于 live roster 或 management surface，而不是每一条 conversation record（[official agent teams docs](https://code.claude.com/docs/en/agent-teams)）。

## Tintinweb：具体行为及其贡献

### Inline Agent result

Tintinweb 注册一个普通的 Pi `Agent` tool。调用行包含 role 和简短描述。Foreground run 期间，其 result 会流式显示 spinner、turn/tool/token statistics 和派生的 activity label。Completion、steered completion、stopped、error 和 hard-aborted 状态各有不同的终态处理。折叠的 completion 只说明 run 已完成；展开模式最多显示 50 行 output，然后指向 retrieval tool（[inline renderer](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/index.ts#L964-L1046)）。

其 state model 诚实且有用：`queued`、`running`、`completed`、`steered`、`aborted`、`stopped` 和 `error` 各自独立。它**没有 `needs-input` state**（[record type](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/types.ts#L86-L100)）。

inline launch record 中可以看到一个限制：tool result 对 model 区分“queued”和“started”，但紧凑视觉 renderer 对二者使用同一个通用的 background-running label（[background result text](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/index.ts#L1303-L1312)、[visual branch](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/index.ts#L999-L1002)）。Pi Stuff 不应重复这种歧义。

### Background widget

Tintinweb 的编辑器上方 widget 对哪些事实存在仍是有用证据，但其位置和密度不再是 Pi Stuff 候选方案。它给每个 running agent 两行：

1. role、具体任务、turns、tool calls、tokens/context pressure 和 elapsed time；
2. 一行通俗语言的最新 activity。

Queued agents 被压缩为一个 aggregate count。Widget 上限为 12 行，优先显示 running rows，其次是 queue 和最近完成的 rows，并对溢出进行 summary（[widget renderer](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/ui/agent-widget.ts#L349-L478)）。Finished successes 保持到随后一个 turn，errors 保持两个 turn；这是合理的瞬时生命周期想法（[linger policy](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/ui/agent-widget.ts#L274-L343)）。

然而，该实现还设置 statusline string，并将 widget 注册到编辑器上方（[status and placement](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/ui/agent-widget.ts#L481-L545)）。Pi Stuff 可以在显式 detail view 中复用生命周期事实，但不会复用这两种 placement。

### Completion notifications 与 grouping

每次后台 completion 都会成为 themed message，包含 status、task、statistics、折叠时的一行 preview、展开时最多 30 行，以及可选的 transcript path。多个 completions 可以在一个 custom message 中交付，同时保留每个 agent 一个 block（[notification renderer](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/index.ts#L232-L279)、[delivery grouping](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/index.ts#L318-L370)）。

Group-join 行为属于运行层面而非视觉层面：等所有 agents 完成，或在第一个 completion 后 30 秒释放 partial batch，并用 15 秒 timer 对落后的 agents 重新分批（[group join](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/group-join.ts#L23-L27)、[delivery lifecycle](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/group-join.ts#L59-L117)）。这会减少 notification spam，但不会创建 Claude Code 的实时 grouped Agent tool record。

### FleetView 与 conversation viewer

FleetView 是独立的编辑器下方 roster。在空 prompt 时，方向键进入其中；Enter 打开选中的 agent；最近完成的 agents 会短暂保留。没有 session、仍处于 pending queued 的 agents 会被隐藏，直到它们真正可打开（[FleetView roster](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/ui/fleet-list.ts#L144-L200)、[keyboard behavior](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/ui/fleet-list.ts#L209-L259)）。

选中的 conversation 使用 `overlay: true` 打开，宽度为 90% 且居中，并拥有 steering 和 stop controls（[viewer implementation](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/ui/fleet-list.ts#L281-L319)）。这正是 Pi Stuff 已拒绝的浮动窗口模式。其能力仍然相关；其容器不相关。

## 按状态比较

| 状态 | Claude Code 证据 | Tintinweb 证据 | Pi Stuff 预览规则 |
|---|---|---|---|
| Queued | 没有证据表明它是独立的持久化 transcript row；activity/management surfaces 拥有大部分 scheduling state | 真实 state；widget 聚合 count，但 compact launch row 隐藏了区别 | 当 queued child 有 session row 时保持可见；右侧显示 position；只有 roster 达到高度上限后才聚合 |
| Running | 最新 activity 加限定历史；并行 children 独立更新 | 包含 role、task、stats、activity 的丰富双行 row | 一行 roster：Agent name、task 和简短 elapsed state；tool activity 属于显式 detail |
| Completed | 用稳定的 `Done` summary 替代变化内容；background completion 随后成为紧凑 notification | 独立 success row，可展开 result preview | 持久化 grouped transcript outcome；terminal roster row 保持到下一次 main-session user submission，或用 `x` 提前 dismiss |
| Failed | Error color/state；当前 `/tasks` 对其的保留行为与 success 不同 | 独立 error，partial result 可用 | 持久化 failed child，显示最短原因和 partial-result marker；roster 依照相同的确定性 next-submission cleanup |
| Stopped | Panel/task controls 可以 interrupt；notification status 支持 killed | 独立 stopped state | 持久化 stopped child，带有 partial-output marker（若有）；roster 依照相同的确定性 next-submission cleanup |
| Needs input | Background permission prompt 在 main session 中出现并指出 agent | 无此 state | Permission 临时拥有 Command Dialog；真正的人类问题变为持久 attention row，不夺取非空编辑器焦点 |
| Steered | Team controls 可以向选中的 agent 发送消息 | First-class `steered` terminal state 和 mid-run messages | Steering 保留在 detail panel；只有用户可见上下文发生变化时，transcript 才记录一条简短的“direction updated”event |
| Many completions | Prompt-area notification list 有上限并会聚合 | Group join 合并 completion messages | 一个带每个 agent status 的 grouped notification；不产生几乎相同的 cards 连发 |

## 当前预览规范

选中的布局有三个 state owners。以下 sketch 描述行为和信息，而不是复制的像素。

### A. Transcript 中的持久化 launch record

```text
● Started 4 background agents · 3 running · 1 queued · ↓ manage
```

### B. 默认的编辑器下方 roster

```text
  ↓ to manage
  ● main
  ○ explorer    Inspect Claude activity UI                 14s
  ○ reviewer    Inspect tintin activity UI                 11s
  ○ pi-reviewer Check Pi interaction constraints     queued #1
  ○ test-runner Verify narrow terminal layout               6s
```

任务左对齐，并在宽度压力下可舍弃；简短状态右对齐并保留。不要在这里添加最新 tool activity、group headers 或 statusline counts。

### C. Selected roster

```text
  ↑/↓ to select · Enter to view · Esc to return
  ○ main
  ● explorer    Inspect Claude activity UI                 14s
```

选择移动实心圆。不创建 card、整行背景、border 或浮动 focus surface。

### D. 已定稿的 transcript record 与确定性 roster cleanup

```text
✓ 4 agents finished · 19 tool uses · 18s
  ├ Inspect Claude activity UI · Transcript and roster have different jobs.
  ├ Inspect tintin activity UI · One roster is enough.
  └ +2 more

  completed just now · ↓ to review
  ○ explorer    Inspect Claude activity UI      done · 18s · 24k
```

Transcript record 是持久的。Terminal roster row 在用户查看当前 main response 时继续可用，然后在下一次 main-session user submission 时消失。`x` 可以更早 dismiss terminal row。这一 event boundary 是确定性的，避免 timer 驱动的移动，并将完整的 result/error/partial-output 证据留在 transcript 和 Agent Command Dialog 中。

### E. Permission 与人类所需的输入

```text
● Reviewer needs permission
  ⎿ Run integration tests with network access?
    Enter allow · Esc deny this action
```

Permission request 是 modal 的，因为 tool 没有决定就无法继续。它指出 Agent 和 action，临时替换 editor 及其他 Pi Stuff-owned chrome，然后准确恢复此前的 main 或 BTW surface。`Esc` 只拒绝该 tool call，不会停止 Agent。

```text
● Reviewer needs your answer · Choose migration target

  ◯ reviewer    Choose migration target                    waiting
```

内部 child-to-supervisor question 不会自动造成 user interruption：main Agent 首先尝试通过 fork 的 supervisor channel 回答。只有当 main Agent 判断确实需要人类选择时，Pi Stuff 才会在 Todo 上方显示持久 attention row。它将 roster row 标记为 `waiting`，但不会夺取焦点、修改 draft、消耗 keystrokes，或将问题复制进 Todo。Down 和 Enter 打开 Agent Command Dialog 以便回复。

### F. 已接受的 Agent Command Dialog redesign

**状态：** 2026-08-17 接受；2026-08-18 实现。

对 child 按 Enter 会暂时隐藏 roster，并在其 divider 下方打开已接受的全宽 Command Dialog。它拥有完整 conversation、steer、stop、resume 和 local details。不要在 transcript 上绘制居中的带边框 overlay。该决策仅覆盖 Agent Command Dialog：不改变 Conversation Transcript marker、Fleetview 或其他 Capability 的 Dialog。`/agents` 在所有 terminal width 下都保持单列。

以下 sketch 是布局权威。它刻意没有 content-level indentation；section bodies 和 Activity 中的每个首字符都从同一个 Dialog content column 开始。

```text
Agents / reviewer
✓ completed · 18s

◆ Task
Review the /agents dialog for readability at 64 and 32 columns.

◆ Result
The Agent name needs priority. Section labels should be stronger,
and Activity should keep every event while shortening large Tool output.

◆ Activity
reviewer
I'll inspect the current list and detail layout.

✓ Read agent-dialog.ts · completed

✓ Search renderListRow · completed

reviewer
The name currently receives at most 38% of the available width.

↑/↓ scroll · PgUp/PgDn page · r resume · t tool details · ? keys · Esc back
```

#### Agent list

- Dialog list row 是 `selection marker`、Agent name、可选 task description，然后是带 elapsed time 或 queue position 的右对齐 lifecycle icon。`›` 仅表示 focus；绝不替代 lifecycle icon。
- 将 Agent name 紧接在 selection marker 后，并让其优先于 description。窄宽度下 task description 整体消失；不要在保留低优先级 description text 的同时，将 name 限制为固定百分比。
- Compact rows 使用固定 icons 替代 lifecycle words，例如 `● 12s`、`✓ 12s` 和 `○ #1`。Detail Header 保留完整 state word。
- Dialog 生命周期内保持 launch order。State changes 和新发现的 Activity 原地更新 row；不要重新排序 list，也不要移动 focused Agent。新 Agents 按 launch order 追加。
- 当 list 超出可见窗口时，保持 focused row 可见，并使用 `… N earlier` 和 `… N later`，而不是 scrollbar 或第二种 pagination mode。Pi 配置的 Up 和 Down actions 每次移动一个 Agent；Ctrl+P/Ctrl+N 是只读 aliases。PageUp/PageDown 和 `b`/Space 移动一个可见 page，Home/End 跳转到第一个或最后一个 Agent。将完整映射放在 `?` 后，而不是拥挤 Footer。
- List 拥有 navigation、inspect 和一个直接 control：对 queued、running、waiting 或 resuming Agents 使用 `x stop`。stopping 或 terminal states 不显示该操作。Steer、reply、resume 和 child-Agent navigation 属于 detail。
- `/agents` 是完整的 current-session list，不提供 `x dismiss`。Dismiss 仍是临时编辑器下方 roster 的独立行为。
- 不要用 `d1`、`d2` 或 `d3` labels 将 descendants flatten 成一张 list。Parent detail 暴露 `n child agents`；该 action 仅使用相同 row grammar 打开其 direct children。拥有 descendants 的 child 以同样方式继续逐层导航，Escape 精确返回上一层。

#### 跨状态稳定结构

- 配置的 Agent name 是主要视觉锚点。Breadcrumb 更弱；窄宽度下可选 description text 要让位于 name。
- 每种状态都使用相同的 page skeleton：Header、Task、一个可选 outcome slot、Activity 和 Footer。
- Header 显示 Agent name，随后是一个 status icon、完整 state word，以及已知时的 elapsed time。State 不单独作为 section。
- Task 始终存在，并完整显示一次 delegated task。
- Outcome slot 根据实际内容命名为 `Result`、`Error` 或 `Partial result`。如果为空则省略，不显示空 placeholder，也不重复 Task 或 Activity 已拥有的内容。
- Completed Agent 使用 `Result`。Failed 或 crashed Agent 使用 `Error`；如果还保留了有用的 partial output，则在同一个 outcome slot 内使用 `Partial result` 作为次级 label，而不是另设一个 marked section。Stopped 或 cancelled Agent 仅在存在此类内容时使用 `Partial result`。Queued、running 和 waiting Agents 没有 outcome slot。
- Outcome content 是实际为 Agent 保留的 sanitized result。Dialog 不生成替代 summary。Terminal Agent 初次打开在其 outcome；non-terminal Agent 初次打开在其最新 Activity。
- Activity 始终存在。Footer actions 随 state 变化，而 Escape 保持共用的 back/close 行为。

#### Section 与间距语法

- 保留 Suite 的全宽顶部 divider 和 Footer boundary。不要在单个 section 周围添加 horizontal rule、card、frame 或 floating container。
- Section headings 为 `◆ Task`、`◆ Result`、`◆ Error`、`◆ Partial result` 和 `◆ Activity`。紧凑的 semantic-theme diamond 只存在于 heading row，不变成 rail，也不表示 lifecycle state、focus 或 Transcript event。
- 除 Command Dialog 的一个 outer content gutter 外，不要增加 hierarchy indentation。Section bodies、Agent names、Agent messages、Tool rows、`⎿` result rows 和 wrapped continuation lines 与 section mark 共用同一个左边缘。
- 用空行、heading weight 和 semantic text colors 区分 sections 和 events。Agent name 比所有 section headings 都更醒目。

#### Activity 内容

- Activity 保留完整的相关 event order：Agent messages、用户可见的 steer 或 resume messages，以及每个带 target、outcome 和 retained result 的 Tool call。
- Agent messages 在单独一行显示配置的 Agent name，随后显示 message。用户指导在相同 speaker 位置显示 `You`；不借用 `›` selection marker。Agent messages 以及 retained Result 或 Partial result prose 使用 Pi 原生 Markdown renderer 和 semantic theme tokens。
- 一个 Tool event 是一个 item：第一行显示 lifecycle icon、operation 和 target。成功的 result bodies 默认折叠；`t` 显示或隐藏每个 Tool 有界的 `⎿` previews，但不改变 event order。Failed、rejected 或 cancelled results 默认保持可见，以免隐藏原因。Running Tool 原地从 `●` 更新为 `✓` 或 `×`；完成不会追加第二份 call。
- Tool output 始终是 sanitized literal terminal text，绝不是 Markdown。大 output 在原处缩短，并明确报告省略的行数。Dialog 绝不会静默丢弃更早或更晚的 Activity。
- Internal/system records、raw protocol JSON、delegated Task 和重复的 final Result 不出现在 Activity 中。
- Agent messages 使用配置的 Agent name，而不是通用的 `Agent` label。Tool rows 使用实际 outcome icon，而不是统一的 circle。

#### Live Activity

- 选中的 Agent 运行时，Activity 必须刷新；进入 detail 时只读取一次 transcript 是不够的。
- 当 viewport 位于最新 event 时，自动追加并跟随新的 Activity。第一次向上移动一行或一页会暂停跟随，并保留精确 reading position。
- Follow 暂停期间，追加内容但不移动 viewport，并显示 `↓ N new events`。通过 Down、Ctrl+N、PageDown、Space 或 End 到达底部时，清除通知并恢复跟随。不需要独立的 follow toggle。
- Lifecycle change（包括 completion 或 failure）更新 Header，但不会移动正在阅读较旧 Activity 的用户。重新打开 terminal Agent 时仍从其 outcome 开始。

#### 按 Agent state 划分的 Footer actions

| Visible state | State-specific actions |
|---|---|
| queued, running | `s steer`, `x stop` |
| waiting | `s reply`, `x stop` |
| stopping | none |
| resuming | `x stop` |
| completed, failed, crashed, stopped | `r resume` |
| cancelled | none |

`Steer` 表示向 live Agent 添加指导。Waiting state 复用该 input path，但标为 `reply`，因为用户是在回答 Agent。仅在 content 溢出时添加 scroll 和 page hints；仅在存在 children 时添加 `n child agents`；仅在 Activity 包含 Tool 时添加 `t tool details`；每个 detail state 始终保留并置于最后的 `Esc back`。绝不宣传 validation 会拒绝的 action。

#### Empty 与 degraded states

- 空 list 显示 `No Agents in the current session.`，并保留 `Esc close`。
- 没有 events 的 Agent 显示 `No Activity yet.`。Loading 显示 `Loading Activity…`；source 不可用时显示 `Activity unavailable.`，并在已知时包含一个 sanitized reason。
- Loading 或 read failure 是 Activity-source feedback，而不是 Agent lifecycle state。它不能替换 Header 的真实 lifecycle icon 或 word，不能夺取 focus，也不能移除 Escape path。

#### 仅 Dialog 使用的 icon 语言

- Conversation Transcript 的小号 U+2022 `•` marker 保持不变。Dialogs 从既有 Transcript system 派生克制、单元格安全的 semantic state language，但不复用其通用 message marker 作为 lifecycle icon。
- `›` 表示 focused selectable row，绝不表示 lifecycle state。
- Agent lifecycle icons 固定为：`○ queued`、`● running`、`! waiting`、`◐ stopping`、`↻ resuming`、`✓ completed`、`× failed` 或 `crashed`，以及 `■ stopped` 或 `cancelled`。
- Compact lists 可以以 icon 开头；detail status 始终保留完整 state word，因此 color 和 icon recognition 从来不是唯一证据。Activity 中的 Tool events 复用相同的 success、running 和 failure meanings。

#### Navigation 与适配

- Pi 配置的 Up 和 Down actions 在可滚动 detail 中每次滚动一行；Ctrl+P/Ctrl+N 是只读 aliases。PageUp/PageDown 和 `b`/Space 滚动一页，Home/End 跳到顶部或底部。
- 可滚动时 Footer 显示配置的 page actions，并保持 `? keys` 可见。Hints 应换行，而不是挤走 Agent name、selected state、attached error 或 Escape path。
- 窄宽度下优先保留 Agent name、section heading、state 和 action，其次才是可选 descriptions、targets、previews 或 metadata。内容换行时不要增加 indentation，也不要在 continuation lines 重复 section icon。

实现现在遵循此 contract：Agent names 引导稳定的 launch-order rows；descendants 使用 hierarchical navigation；Activity 实时刷新；Agent prose 使用共享的 Pi Markdown component；state-specific controls 省略无效 actions；Tool rows 使用实际 outcome icons 和 collapsed-success detail；Pi 配置的 page actions 与 `b`/Space 共享 paging path。Focused tests 和 real PTY verifier 覆盖 wide、narrow、low-height、lifecycle、overflow 和 restoration paths。

## 本研究支持的决策

1. **在 originating conversation event 处对并发 Agent outcomes 分组。** 这是可实现的：分组以单个 assistant response/tool batch 为 key，而不是以全局 history 为 key。
2. **在编辑器下方使用单行垂直 roster。** `main` 和每个 child 共享同一简单 row grammar；task 在左，最短 state 在右。维护者在审阅全部三种原生 Pi variants 后选择了这一方向。
3. **提供 contextual local-detail action。** 仅在编辑器为空时由 Down 进入 roster；Enter 在非浮动 Command Dialog 中打开选中的 child。`Ctrl+O` 仍是 Pi 的全局 transcript expansion，不重新用于本地 Agent detail。
4. **使用一个 active roster 加持久化 conversation record。** Claude 2.1.197 证明，当二者职责不同时，这两个 surface 可以共存。不要在编辑器上方、下方和 statusline 中重复相同的实时 detail。
5. **在 roster 达到上限前保持具体的 queue information。** 可见的 queued child 显示其 position；只有必要时，溢出才变为 `+N more`。
6. **区分 permission 与 human question。** Permission 临时拥有 Command Dialog。Human-required question 保持可见且可操作，但保留非空 editor；内部 supervisor coordination 除非 main Agent 将其升级，否则保持静默。
7. **保持 terminal outcomes 持久化。** Live rows 可以在短暂 linger 后消失，但 conversation record 必须保留 completed、failed、stopped 和 partial outcomes。
8. **让选中的 capability fork 与 UI references 分离。** Pi Stuff 将 fork `nicobailon/pi-subagents` 以获得 multi-Agent capability。Tintinweb 和 Claude Code 仅作为可观察的 UI references；二者的代码都不会被采用、复制、翻译或移植到最终 UI。
9. **使用上方已接受的 Agent Command Dialog contract 进行详细检查。** 其 state-stable sections、Dialog-only icon language、flush-left content、bounded complete Activity 和 compact-keyboard paging 是产品决策，而不是关于 Claude Code 精确像素的声明。

## main agent 在冻结 preview 或 fork base 前必须亲自验证的事实

1. **剩余 Claude states：** parallel foreground running/completed、global expansion、background running/completed、roster navigation、child selection 和 Enter-to-child 已从 `2.1.197` capture。Background permission request 则单独从真实的 `2.1.220` capture，并记录于 [Work background notification UI](./work-background-notification-ui-reference.md)。Single-Agent、failed 和 stopped pixels 仍未 capture；不要从 Pi prototype 推断它们的精确布局。
2. **`/agents` 与 `claude agents`：** 确认当前 CLI 仍将 `/agents` 作为 locations report，并且独立的 Agent View 通过 `claude agents` 启动；不要将旧 wizard screenshot 标为当前 UI。
3. **Tintinweb reference revision：** 记录某个 UI decision 是在已发布 npm `0.14.3`（`c10b183…`）还是当前 `master`（`2966cd5…`，包含 unreleased changes）中观察到的。这是行为证据的 provenance，不是 Tintinweb fork decision。
4. **Overlay rejection scope：** FleetView 本身是编辑器下方 roster，而不是 overlay。验证从它到 Tintinweb `ConversationViewer` 的每条路径都已替换或禁用，因为该 viewer 明确请求 centered overlay。
5. **Needs-input implementation boundary：** Tintinweb 的 record model 没有 needs-input state。选定的 `pi-subagents` fork 可以将内部 supervisor request 路由到 main Agent，但这本身不是 human question。原生 Pi lifecycle spike 只证明 UI ownership；universal allow/ask/deny tool policy 仍是独立的 Package decision。
