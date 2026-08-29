<!-- translation-source: docs/research/work-background-notification-ui-reference.md; translation-source-sha256: 5cebe5e4a5e00cc231581891400f1fdeb87fff105853d4c6c1bbf2994de7ddab -->

# Work background notification UI reference: Claude Code 2.1.220

**研究日期：** 2026-08-01
**范围：** 当会话内子 Agent 和后台 shell 命令完成、失败、被停止或需要权限时，用户会看到什么；以及这些信号如何区别于 `/tasks`、提示词下方的 Agent roster、操作系统通知和独立的 `claude agents` Agent View。

## 结论

Claude Code 不会把后台工作转化为一个永久仪表板。它将每类事实分配给四个界面之一：

1. **发起工具记录说明启动了什么。** 后台 Agent 会收束为一行紧凑的 `Backgrounded agent`，并释放主提示词。
2. **提示词下方的 roster 说明当前正在发生什么。** 它是活动子 Agent 的临时导航，不是持久历史。
3. **transcript 说明什么已经结束。** 完成、失败和用户停止都会产生紧凑的终止记录；父 Agent 在讨论结果前会先收到真正的完成通知。
4. **`/tasks` 说明本会话中仍可管理什么。** 成功完成的后台子 Agent 会一直保留在那里，直到任务列表清理；失败和被停止的子 Agent 会离开。后台 Bash 生命周期不同，结束时会离开。

最高优先级的例外是**权限提示**。后台子 Agent 的工具请求会接管编辑器区域，显示全宽、由分隔线引导的确认界面，明确指出发起请求的 Agent，并持续保持可操作状态直到用户作出决定。拒绝一个请求不会停止 Agent。

这并不意味着存在通用的“子 Agent 向用户提问”功能。当前官方子 Agent 文档承诺的是权限透传，而不是任意澄清问题；一次范围很窄的 2.1.220 黑盒探测无法让测试中的自定义子 Agent 使用 `AskUserQuestion`。Claude 的通用 **Needs input** 状态属于独立的完整会话 Agent View，在没有 Pi Stuff 产品决策和实现证据的情况下，不得将其复制到会话内子 Agent。

因此，对 Pi Stuff 来说，类似 Claude 的规则是：

> 启动记录是持久的，活动 roster 是临时的，终止结果返回 transcript，只有阻塞性权限请求会替代编辑器。不增加浮动窗口，也不增加新的 statusline。

## 不要合并这三个 Agent UI

| 界面 | 表示的单元 | 生命周期 | 入口 | 所负责的内容 |
|---|---|---|---|---|
| 提示词下方的 Agent roster | 当前对话中的子 Agent | 活跃期间，加上短暂的视觉停留 | 空编辑器下方向键 | 活动身份、选择和进入子 Agent |
| `/tasks` | 当前会话拥有的后台工作 | 会话内管理生命周期 | `/tasks` | 运行中的 shell/子 Agent 详情和停止操作；成功子 Agent 的保留 |
| Agent View | 独立的完整 Claude Code 会话 | 跨终端和进程重启持久存在 | `claude agents` | 跨项目派发、Needs input、回复、附加、停止、删除、固定和分组 |

Anthropic 明确表示，会话内子 Agent 不会作为独立行出现在 Agent View 中。Agent View 的每一行都是完整的后台 Claude Code 对话，而不是当前 transcript 的子项（[Agent View 文档](https://code.claude.com/docs/en/agent-view)）。从 2.1.198 开始，`/agents` 也不再打开旧的子 Agent 向导；它会告诉用户询问 Claude 或编辑 Agent 文件（[子 Agent 文档](https://code.claude.com/docs/en/sub-agents)）。

这个命名边界对 Pi Stuff 很重要。未来的会话管理器可以借鉴 Agent View 的概念，但当前 Agent fork 不应悄然变成第二个持久会话产品。

## 证据与来源

### 官方来源

行为依据 Anthropic 当前文档以及 Claude Code **2.1.220** tag 下的官方 changelog 进行核验：

- [Subagents：前台/后台行为、权限、完成结果传递、`/tasks` 和 API 错误](https://code.claude.com/docs/en/sub-agents)
- [Interactive mode：快捷键和后台 Bash](https://code.claude.com/docs/en/interactive-mode#background-bash-commands)
- [Commands reference](https://code.claude.com/docs/en/commands)
- [Keyboard bindings](https://code.claude.com/docs/en/keybindings)
- [Agent View](https://code.claude.com/docs/en/agent-view)
- [Terminal notifications](https://code.claude.com/docs/en/terminal-config#get-a-terminal-bell-or-notification)
- [Settings，包括 `preferredNotifChannel`](https://code.claude.com/docs/en/settings)
- [Notification hooks](https://code.claude.com/docs/en/hooks)
- [Official v2.1.220 changelog](https://github.com/anthropics/claude-code/blob/v2.1.220/CHANGELOG.md)

官方文档是受支持行为的权威来源。下面的发布版本观察补充了具体的当前 UI 和清理细节，但不会扩大文档中定义的契约。

### 已发布 2.1.220 黑盒观察

本地 Linux x64 发布二进制报告版本为 `2.1.220 (Claude Code)`，SHA-256 为：

```text
674f61f20ff306f3100cf9200e4c36c4b70278b5bef2884549819b942a89c863
```

测试在隔离的 `100 × 32` tmux PTY 中进行，使用临时 home、配置目录、项目和确定性的本地 Anthropic Messages fixture。无法使用用户凭据、Claude 配置、既有会话、项目源代码、浏览器集成和外部模型 API。代理变量阻止了非本地流量；遥测、更新器、错误报告和非必要网络行为均已禁用。

fixture 只提供合成模型 prose 和确定性工具调用。Claude Code 自身负责渲染、键盘路由、Agent 生命周期、权限 UI、任务注册表和 transcript 行为。因此：

- **布局、标签、状态转换、控件和清理行为**是真实的发布版本观察；
- **提示词、Agent 任务名称、命令、assistant prose、耗时和 token 数量**是合成测试内容；
- fixture 中 assistant 的措辞不能作为 Anthropic 模型行为的证据。

审查用权限图片来自真实 ANSI pane capture，并使用仓库此前基于 `freeze` 的终端捕获方法渲染为 PNG。它不是手工构建的 HTML mockup。删除的 artifact 尺寸为 `3672 × 2381`，SHA-256 为：

```text
bdff5df564db5ff15d7d0a622a5fa535aba35a43686e0d77606a138317d670c6
```

测试命令本应创建 `permission-probe.txt`。在该界面按下了 `Esc`；确认文件不存在，而子 Agent 继续运行并随后完成。这同时确立了视觉界面以及“拒绝一个工具调用，但不杀死 Agent”的生命周期。Git 历史保留了被删除的图片和 harness。

## 后台子 Agent 生命周期

### 1. 启动会释放主提示词

从 2.1.198 起，除非父 Agent 需要立即得到结果，Claude Code 默认在后台运行子 Agent。原始 Agent 工具记录会收束为一个简短的后台状态，同时主提示词变得可用。`Ctrl+B` 或 `Ctrl+X Ctrl+B` 也可以将前台 Agent 转入后台（[子 Agent 文档](https://code.claude.com/docs/en/sub-agents)、[键绑定](https://code.claude.com/docs/en/keybindings)）。

观察到的紧凑语法：

```text
● probe(permission state probe)
  ⎿ Backgrounded agent (↓ to manage · ctrl+o to expand)
```

编辑器下方，Claude 保留主/子 Agent roster 和 `↓ to manage` 提示。子 Agent 运行期间，父 Agent 可以继续对话。这正是固定启动记录的时机；不应继续假装父调用处于阻塞状态。

### 2. 前台完成会变更记录；后台完成会发送通知

前台和后台工作有意采用不同的结束方式。

- **前台** Agent 会阻塞父 Agent。完成后，现有 Agent 行会变更为终止状态的 `Done` 摘要，父 Agent 在同一轮继续执行。
- **后台** Agent 已经释放父 Agent。完成后，Claude 会插入后续的紧凑通知，例如 `Agent "…" finished · 5s`；父 Agent 收到结果，并在后续轮次作出响应。

Anthropic 表示，父 Agent 会等待真正的完成通知后才报告结果。2.1.211 的一项修复专门防止过早声称结果（[子 Agent 文档](https://code.claude.com/docs/en/sub-agents)）。该通知是自动化 system input，不是用户消息，也不代表获得了隐含批准。2.1.205 changelog 收紧了这条边界，使后台通知明确告诉 Claude：它们不代表人类输入（[官方 changelog](https://github.com/anthropics/claude-code/blob/v2.1.220/CHANGELOG.md)）。

即使可见行使用与对话事件相同的左侧圆点语法，Pi Stuff 也应保留这一语义边界：**Agent 完成是证据，不是用户同意。**

### 3. 失败必须明确且终止

在 2.1.220 探测中，确定性的 HTTP 400 子 Agent 失败产生了如下形态的可见记录：

```text
● Agent "fail state probe" failed: Agent terminated early due to an API error: …
```

随后父 Agent 收到 system task notification，可以解释或重试。`/tasks` 立即报告该失败子 Agent 没有任务。

这与当前官方行为一致。从 2.1.199 起，前台子 Agent 可以返回部分文本并附带明确的截断说明；后台子 Agent 会被标记为失败，后续通知包含 API 错误和最后输出（[API-error 文档](https://code.claude.com/docs/en/sub-agents#api-errors-in-subagents)）。即使错误文本通过同一个结果通道到达，也绝不能仅因此把失败渲染成成功的 Agent 发现。

### 4. 停止有本地路径和全局路径

当前 `/tasks` 详情视图显示 `x to stop`。按下 `x` 后，选中的运行中子 Agent 立即停止，任务详情关闭，transcript 中插入 `Agent "…" was stopped by user` 通知，并从 `/tasks` 移除。

全局 `Ctrl+X Ctrl+K` 路径会停止当前会话中的所有后台子 Agent。官方 interactive-mode 文档要求在三秒内重复该组合键；发布版本探测显示第一次按键后的确认，只有第二次组合键才真正停止 Agent（[interactive-mode 快捷键](https://code.claude.com/docs/en/interactive-mode#keyboard-shortcuts)）。结果是先显示 `All background agents stopped` 确认，随后显示每个 Agent 的终止记录。

本地停止之所以有意设计为一次按键，是因为目标在 `/tasks` 中可见；全局停止之所以需要确认，是因为作用范围更大。Pi Stuff 应保留这种差异，而不是让所有停止操作都经过同一个通用对话框。

### 5. 成功工作有两种不同的持久化方式

成功完成后，紧凑的 transcript 通知在正常退出并使用 `--continue` 后仍然存在。这是普通的对话历史。

`/tasks` 管理条目的行为不同：

- 原始进程仍在运行时，已完成的子 Agent 会继续留在 `/tasks` 中，排在运行中的工作之后；详情视图显示 `Completed`、耗时、token 和提示词；
- 退出并恢复后，即使 transcript 的完成记录仍在，`/tasks` 也为空。

第一点是 2.1.208 引入的官方行为：成功的后台子 Agent 会保留在 `/tasks`，直到会话清理其任务列表；失败和停止的子 Agent 会离开（[子 Agent 文档](https://code.claude.com/docs/en/sub-agents)）。第二点是一次直接的 2.1.220 观察，不是对“session cleanup”究竟何时发生的普遍文档定义。

Pi Stuff 不应让管理注册表成为结果的唯一记录。临时或会话内的 `/tasks` 行与持久 transcript 事件解决的是不同问题。

## 权限是即时阻塞输入

### 官方契约

从 2.1.186 起，需要权限的后台子 Agent 工具调用会在主会话中显示，并指出请求权限的子 Agent。批准后它可以继续；`Esc` 会拒绝这一次调用，但不会停止 Agent。更早版本会自动拒绝这些调用（[子 Agent 文档](https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background)）。

### 当前可见结构

2.1.220 界面具有以下特征：

- 全宽水平分隔线将此前对话与当前决策隔开；
- 标题同时包含工具类型和来源：`Bash command · from the probe agent`；
- 命令和描述出现在问题之前；
- 选择项是普通的垂直选择行：批准一次、批准并持久化适当规则，或拒绝；
- 页脚提示暴露 `Esc`、用于修改的 `Tab` 和用于解释的 `Ctrl+E`；
- 普通编辑器、Agent roster 和正常页脚让出位置，决策界面获得焦点；
- 决策完成后，正常工作界面恢复。

这是 Pi Stuff 已接受的 **Command Dialog** 家族：由分隔线引导、全宽、位于终端流程内、非浮动。它不是覆盖 transcript 绘制的居中模态框。

核心信息顺序是：

```text
tool kind · from <agent>

exact requested action
short reason

Do you want to proceed?
  1. approve once
  2. approve and remember rule
  3. deny

escape / amend / explain hints
```

请求 Agent 必须在标题中明确命名，而不能埋在 roster 颜色中。用户需要知道**授权什么**以及**谁的工作会继续**。

### 权限不是通用的“需要输入”

当前子 Agent 文档明确保证权限转发，但没有说明会话内后台子 Agent 可以在普通澄清问题上挂起自身。

为测试这一区别，隔离 fixture 定义了一个同时请求 Bash 和 `AskUserQuestion` 的自定义子 Agent，然后分别测试后台和前台路径。在观察到的两次子 Agent API 请求中，Claude Code 暴露了 Bash，但没有暴露 `AskUserQuestion`；合成的提问尝试因工具不可用而失败，子 Agent 继续运行。这是针对该配置的狭义负面观察，并不能证明未来版本或其他模式绝不支持任意提问。

因此，Pi Stuff 不能仅因为 Claude 具有上述权限 UI，就把每个子 Agent 都标记为支持 `needs-input`。如果 Agent fork 未来增加澄清请求，则需要独立的契约：

- 哪个子 Agent 工具或事件会产生请求；
- 父 Agent 是否可以自动回答；
- 同时发生的请求如何排队；
- 请求是否在 reload 后保留；
- 拒绝、取消、超时和子 Agent 终止分别意味着什么；
- 哪个界面会抢占 BTW 或其他活动中的 Command Dialog。

在该契约存在之前，Pi Stuff 的会话内阻塞状态具体是**需要权限**，而不是通用的**需要输入**。

## 临时 roster 及其清理

提示词下方的 roster 与 `/tasks` 不共享清理规则。

官方 2.1.181 changelog 表示，空闲子 Agent 行会在 30 秒后自动隐藏，可见列表最多五行，页脚提示会暴露管理控件（[官方 changelog](https://github.com/anthropics/claude-code/blob/v2.1.220/CHANGELOG.md)）。在当前 2.1.220 完成探测中，已完成行在 24 秒时仍可见，并在接近 30 秒边界的下一次检查中消失。这支持短暂保留终止状态，而不是立即消失。

失败和用户停止探测也显示 roster 行会短暂保留后消失，但没有测量每种状态的精确计时器，当前官方文档也没有指定计时器。不要仅凭这些证据把“所有结果均保留 30 秒”冻结为 Pi Stuff 的要求。

有用的原则应更弱、更清晰：

- 保持运行中和阻塞中的行处于活动状态；
- 让终止行停留足够长的时间，使用户能感知状态转换；
- 自动从活动 roster 中移除；
- 将结果保留在 transcript 中；
- 让显式管理界面采用自己的保留策略。

这样可以避免 roster 变成第二个归档，同时避免行在刚完成时瞬间消失造成的突兀感。

## `/tasks`：当前会话工作管理

Anthropic 将 `/tasks` 定义为后台任务视图，并将其与 `Ctrl+T` 打开的待办清单区分开（[interactive-mode 文档](https://code.claude.com/docs/en/interactive-mode)、[commands reference](https://code.claude.com/docs/en/commands)）。直接的 2.1.220 观察确定了两种形态。

### 后台子 Agent 详情

运行期间，详情视图显示子 Agent 提示词和本地 `x to stop` 操作。成功完成后，同一视图原地更新为终止摘要并保持打开。已完成条目在活动会话期间仍可选择。失败和停止会移除条目。

### 后台 Bash 详情

转入后台的 shell 命令会获得唯一任务 ID 和输出路径。`/tasks` 显示状态、运行时间、命令、当前输出和停止键。完成后，Claude 会插入包含退出状态的紧凑记录，关闭详情，并从 `/tasks` 移除任务。

官方规定，后台 Bash 是异步的，会将输出写入 Claude 可以读取的文件；Claude Code 退出时会清理它，除非整个会话本身在后台运行并接管该任务（[后台 Bash 文档](https://code.claude.com/docs/en/interactive-mode#background-bash-commands)）。它不应仅因为与两者都出现在 `/tasks` 中，就继承成功子 Agent 的保留策略。

对 Pi Stuff 来说，`/tasks` 可以使用一个视觉外壳，同时保留按类型区分的生命周期：

| 类型 | 运行中详情 | 成功后的保留 | 失败/停止 |
|---|---|---|---|
| 后台 Agent | 提示词、状态、时间、可选 transcript 条目 | 保留到会话清理 | 从管理列表移除；保留 transcript 结果 |
| 后台 shell | 命令、实时输出、运行时间、输出来源 | 终止时移除；保留紧凑 transcript 结果 | 从管理列表移除；保留 transcript 结果 |

## 操作系统和终端通知

工作完成或因权限请求暂停时，Claude Code 会触发通知事件。这与 transcript 通知分离，应作为可选的终端集成，而不是新的应用内 statusline（[终端配置](https://code.claude.com/docs/en/terminal-config#get-a-terminal-bell-or-notification)）。

`preferredNotifChannel` 默认值为 `"auto"`。在当前设置下，auto 会在 iTerm2、Ghostty 和 Kitty 中发送桌面通知，在其他终端中不执行任何操作。用户可以选择 `terminal_bell`、某个受支持的特定终端通道或 `notifications_disabled`；Notification hooks 可以运行自定义命令或播放声音（[设置参考](https://code.claude.com/docs/en/settings)）。

两点可以避免过度承诺：

- 默认设置下，终端响铃或桌面提醒并非普遍可用。在普通的不受支持终端中，`auto` 会有意保持静默。
- Notification hooks 只是副作用。它们不能阻塞或修改底层通知（[hooks 参考](https://code.claude.com/docs/en/hooks#notification)）。

隔离的 xterm capture 没有尝试证明外部桌面通知是否送达。官方终端/设置文档是该集成行为的权威来源。

## 通用的 Needs input 属于 Agent View

独立的 `claude agents` 界面提供了更宽泛的 **Needs input** 状态，而会话内子 Agent UI 并未确立该状态。它会在 `Ready for review`、`Needs input`、`Working` 和 `Completed` 下分组显示独立的后台会话。最后一个组是列表区段，而不是一对一的状态：成功、失败和停止的会话都可以被收集在那里。行图标仍会区分 Working、Needs input、Idle、Completed、Failed 和 Stopped（[Agent View 文档](https://code.claude.com/docs/en/agent-view)）。

对这些完整会话来说，Needs input 可能表示：

- 普通问题；
- 权限决策；
- sandbox 网络主机提示；
- MCP elicitation 或身份验证；
- managed-settings 请求。

`Space` 会打开 peek panel，显示确切问题、当前结果或状态，并允许回复；`Enter` 或 Right 会附加到完整对话。`Ctrl+X` 会停止会话，两秒内再次按下会删除会话。即使从 Agent View 移除后，transcript 仍可在本地恢复，受文档所述 worktree 保护约束（[Agent View 文档](https://code.claude.com/docs/en/agent-view)）。

Notification hook matcher 进一步强化了这一差异。`agent_needs_input` 和 `agent_completed` 仅在 Agent View 打开时触发，并指向后台**会话**。它们不是会话内子 Agent 事件。会话内子 Agent 使用 `SubagentStart` 和 `SubagentStop` hooks；权限则使用通用的 `permission_prompt` notification type（[hooks 参考](https://code.claude.com/docs/en/hooks#notification)）。

产品词汇应保持精确：

- **Agent/subagent**：当前 Pi 对话中的子上下文；
- **background session**：由类似 Agent View 的管理器表示的独立对话；
- **permission prompt**：来自任一上下文的即时操作请求；
- **ordinary question**：只有相关会话系统具备明确回复通道时才受支持。

## 当前 Pi Stuff 方向得到这些证据支持

以下决策沿用了已经选定的 Claude Code UI 方向，不需要维护者再次作出选择：

1. **后台启动会收束 Agent 工具记录并恢复主编辑器。** 该行只携带 Agent 身份、任务和 `manage`/`expand` 操作。
2. **一个位于编辑器下方的 roster 负责活动 Agent 可见性。** Pi Stuff 使用确定性的事件边界，而不是复制 Claude 的近似计时器：终止行会一直保留到用户审阅当前主响应，下一次主会话用户提交时消失，也可以通过 `x` 提前关闭。不增加重复 statusline，也不增加浮动 FleetView viewer。
3. **每个终止 Agent 结果都会成为紧凑且持久的 transcript 事件。** 成功、失败、停止和部分失败必须保持可区分。
4. **父 Agent 只消费真正的完成事件。** 后台结果是系统证据；其到达绝不冒充用户消息或批准。
5. **破坏性命令断路器提示会通过通用的全宽 Command Dialog 抢占编辑器。** 普通 Pi Stuff 工作不受限制，也不会产生提示。明确写出的工作目录外删除操作或经过测试的 Git 丢弃形式，可以针对那一次确切调用进行询问；灾难性或含义不明的目标会直接拒绝，不提供记住规则的选项。命名请求 Agent，显示确切操作和原因，并在结束后恢复此前的工作界面。
6. **拒绝一个权限请求不会杀死 Agent。** 停止 Agent 仍是独立的本地控制或确认后的全局控制。
7. **`/tasks` 是会话内的 Background Work 管理，而不是历史记录。** 它只包含活动的 Background Shell 和 Monitor 行。Agent 生命周期位于 `/agents`，启动工作的 Tool 调用仍可在 `/tools` 中检查；不需要通过行匹配或显示时删除来强制这些所有权边界。
8. **终端通知遵循 Claude 的 `auto` 策略。** 默认支持的终端桌面提醒，其他地方保持静默，提供明确的响铃/禁用选项和可选 hooks。不为此增加另一个屏幕上的页脚/statusline 计数。
9. **将 fork 特有的人类问题与 Claude 的权限证据分开。** 所选 Agent fork 的原生 supervisor 通道可以触发主 Agent 轮次并接受 supervisor 回复。Pi Stuff 首先让主 Agent 自动回答该内部请求。只有当主 Agent 明确升级为需要人类作出选择时，UI 才添加持久的注意行并将子 Agent 标记为 `waiting`；非空编辑器保持焦点并接收按键。这是 Pi Stuff 的综合设计，不是从 Claude 权限截图推断出的行为。
10. **幂等地恢复生命周期事件。** 生产事件需要稳定的 event 和 origin-group ID、持久的终止结果、reload reconciliation、跨进程 claiming，以及恢复后抑制重复 transcript 或 OS 通知。

行为示意，不是像素复制：

```text
● reviewer(check API failure paths)
  ⎿ Backgrounded agent (↓ to manage · ctrl+o to expand)

...main conversation continues...

● Agent "check API failure paths" finished · 18s
```

```text
────────────────────────────────────────────────────────────────
Bash command · from the reviewer agent

pnpm test --filter integration
Run the integration tests requested by the review

Do you want to proceed?
› 1. Yes
  2. Yes, and remember an appropriate project rule
  3. No

Esc to cancel · Tab to amend · Ctrl+E to explain
```

## 仍然存在的证据缺口

上述生命周期不需要维护者作出决策，但实现不得把以下未知项当作已确立的 Claude 行为：

1. **许多同时完成的任务：** 普通视图下的 2.1.220 capture 没有确立一批完成事件会被合并、排队，还是每个 Agent 渲染一行 transcript。现有 2.1.197 证据显示会产生单独的后台完成通知；Pi Stuff 的分组终止结果仍是其自身已接受的设计选择。
2. **普通 Claude 会话内 Agent 问题：** 当前文档没有承诺这类能力，范围很窄的探测也无法暴露 `AskUserQuestion`。Pi Stuff 所选 fork 具有独立的内部 supervisor 请求/回复接缝，但生产事件、持久化、升级和取消路径仍需认证。
3. **权限竞争：** 没有捕获多个后台 Agent 同时请求权限时的排序和焦点行为。
4. **按状态区分的 roster 停留时长：** 成功完成与 changelog 中约 30 秒的空闲行规则一致；失败/停止的精确计时器尚未确立。
5. **确切的 `/tasks` 清理触发条件：** 成功保留“直到会话清理”是官方行为；一次正常退出/恢复后消失只是直接观察。
6. **外部提醒：** 隔离 xterm 中没有观察桌面通知像素和平台送达情况。官方配置定义受支持的行为。
7. **合成的父 Agent 措辞：** fixture 证明了通知时序和渲染，而不是生产 Claude 模型将如何总结、重试或响应特定结果。

原生 Pi 生命周期 spike 现已证明 Command Dialog 相对于 BTW 的优先级、精确恢复、人工必须作出选择时由编辑器负责输入，以及选择后停止和混合终止行。实现仍需认证真实的同时权限仲裁，以及所选 Agent fork 的请求/回复传输、持久化、reload 和取消路径。正常完成/失败/停止 UI 生命周期已经可以遵循上述决策。
