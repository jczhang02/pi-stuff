<!-- translation-source: docs/research/claude-code-transcript-source-decisions.md; translation-source-sha256: 5bdb9c5bce408f1f8473032b52b9c7548715a0d8f7742f101947e4aa1124f64b -->
# 从源代码检查得出的 Claude Code Transcript 决策

**日期：** 2026-08-01
**产品背景：** Pi Stuff，Pi 0.83.0 作为 Host
**检查的快照：** `tanbiralam/claude-code`，提交 `6f6f12b37f529488b10e53928dd5508bb93535c7`

## 来源与限制

这是产品行为研究，不是实现参考。

被检查的仓库自称是**来自 2026-03-31 的 Claude Code 泄露源代码快照**。它还说明，一些原始模块缺失，并由存根替代。被检查的树中没有 `LICENSE` 或 `COPYING` 文件。将其视为未许可材料：不要将其代码复制、移植、改编或机械翻译到 Pi Stuff 中。[`README.md:1-15`、`README.md:62-65`]

无法确定该树所代表的 Claude Code 确切产品版本。该重建版本将自己标记为 `1.0.0`，在构建时注入 `1.0.0-dev`，而被检查的 Git 提交创建于所声称的泄露日期之后。因此，它**不能证明 Claude Code 2.1.220 的行为相同**。[`package.json:2-10`]

下面所有源代码引用都指向被检查的提交，仅用于识别可观察到的产品决策。在可能的情况下，当前公开行为通过 Anthropic 官方的 [interactive-mode](https://code.claude.com/docs/en/interactive-mode)、[fullscreen](https://code.claude.com/docs/en/fullscreen)、[keybindings](https://code.claude.com/docs/en/keybindings) 和 [subagents](https://code.claude.com/docs/en/sub-agents) 文档进行交叉核对。

## 核心模型：三种不同的历史

源代码层面最有力的发现是，Claude Code 并没有一种未加区分的“会话输出”。它有三层：

1. **Session record：** 恢复和模型连续性所需的语义化用户、assistant、tool、attachment 和 system 事件。
2. **Default conversation：** 面向普通工作的紧凑投影。
3. **Detailed transcript：** 揭示默认会话中被抑制或汇总的信息的检查投影。

这一差异解释了许多原本令人困惑的选择。工具结果可以被存储但不渲染；进度可以在运行时可见却从不存储；多个已存储的工具调用可以变成一行摘要；详细 transcript 可以重建更多细节，而不让默认会话变得嘈杂。

## 会话内容类别

| 类别 | 默认会话 | 详细 transcript | Session 持久化 |
| --- | --- | --- | --- |
| 用户输入 | 作为回合锚点可见 | 可见 | 是 |
| Assistant prose | 流式显示，然后作为普通文本保留 | 可见 | 是 |
| Thinking | 当前 thinking 可能显示；已完成的 thinking 在普通投影中被抑制 | 可以详细显示选定的/最新的 thinking block | 作为 assistant 内容存储，但不作为普通 prose 处理 |
| Tool operation | 带实时状态的一行语义化操作行 | 带详细参数/细节的相同操作 | Tool call 是 |
| Tool result | 紧凑的、工具专属的结果；可能不渲染任何内容 | 详细的、工具专属的结果 | 是 |
| 重复读取/搜索/MCP 查询 | 汇总为活动摘要 | 原始调用和结果 | 原始事件仍被存储 |
| Subagent 工作 | 有界进度或完成摘要 | 可展开 prompt、进度和返回内容 | 主结果持久化；详细 sidechain 工作单独存储，而不是作为主会话进度 tick |
| Todo 及类似工作状态 | 位于专用状态/任务界面，而不是重复的 transcript 消息 | 不会仅因状态变化而提升到 transcript | 底层工具事件可能持久化；高频状态显示是独立的 |
| System feedback | 可操作的警告/错误；抑制信息噪声 | 更多信息性细节 | 选定的 system 事件持久化 |
| Progress ticks | 就地更新其所属操作 | 在可用时用于渲染详情 | 否；明确是临时状态 |

该表是对具体决策的产品解释，并不声称这些是公开的 TypeScript API 类型。

## 快照中有证据支持的产品决策

### 1. 持久化语义事件；派生可见 transcript

持久化层将 user、assistant、attachment 和 system 记录定义为 transcript 消息，同时明确排除 parent chain 中的 progress 记录。对于外部用户，它还会在日志记录前过滤掉大多数内部 attachment。[`src/utils/sessionStorage.ts:128-156`、`src/utils/sessionStorage.ts:4351-4366`、`src/utils/sessionStorage.ts:4450-4460`]

另外，UI 会在渲染前立即对这些消息进行规范化、过滤、重新排序、分组和折叠。因此，折叠是显示投影，而不是对底层会话进行破坏性重写。[`src/components/Messages.tsx:475-529`]

**Pi Stuff 决策：** 将存储与显示分开定义。“默认隐藏”绝不能隐含“已丢弃”，“运行时可见”也绝不能隐含“已持久化”。

### 2. 将内容 block 作为有意义的单元渲染，而不是 API 响应 blob

包含多个 content block 的 assistant 或 user 消息会被规范化为带稳定派生 identity 的多个可渲染单元。因此，即使 text、thinking、tool call、image 和 tool result 在一个 API 消息中到达，也可以接受不同的呈现规则。[`src/utils/messages.ts:730-818`]

**Pi Stuff 决策：** 可见单元应当是有意义的会话项，不一定是一条 provider 消息。保留 parent/owner 关系，使拆分后的项目在适当情况下仍作为一个操作运行。

### 3. Progress 属于其操作

独立的 progress 消息会从行列表中移除，根据其所属的 message/tool call 查找，并传递给该行的 renderer。在工具流式传输、运行或等待未解决 hook 时，该行保持动态；解析完成后变为稳定状态。[`src/components/Messages.tsx:499-504`、`src/components/MessageRow.tsx:140-167`、`src/components/Messages.tsx:779-830`]

Bash、PowerShell 和 MCP 的高频 progress 被明确描述为仅限 UI 的状态：就地替换而非追加，并排除在 JSONL 持久化之外。[`src/utils/sessionStorage.ts:180-190`、`src/screens/REPL.tsx:2608-2627`]

**Pi Stuff 决策：** elapsed time、行数、当前文件、最新动作和 spinner frame 应当更新所属的 tool/agent item。不应创建新的永久会话行。

### 4. 使用共享的操作外壳，同时保留工具自有语义

通用工具契约提供面向人的名称、紧凑活动/摘要文本、操作渲染、进度渲染、结果渲染、截断检测，以及自定义错误/拒绝渲染。工具可以有意不返回 transcript UI，当其结果显示在其他位置时尤其如此。[`src/Tool.ts:524-539`、`src/Tool.ts:561-678`]

通用外壳提供状态与层级：queued/running/resolved/error 状态、工具标签、紧凑输入描述、可选 progress，以及其下方的结果。[`src/components/messages/AssistantToolUseMessage.tsx:101-121`、`src/components/messages/AssistantToolUseMessage.tsx:182-275`]

**Pi Stuff 决策：** 标准化操作项的语法，但让每个工具决定最有用的简短描述和结果摘要。diff、测试运行、web fetch 和文件读取应共享结构，但不应被迫使用完全相同的内容。

### 5. 按人的含义折叠，包括跨工具名称折叠

工具会对一次调用是否在语义上属于 search、read 或 directory listing 进行分类。这包括 `grep`、`find`、`cat` 和 `ls` 等 shell 命令；UI 不仅依赖字面工具名称。[`src/Tool.ts:418-433`]

连续的 retrieval 操作及其结果会成为一个派生分组。Assistant prose 和 edit 等不可折叠操作会打断该分组；thinking、attachment 和 system message 不会使其碎片化。[`src/utils/collapseReadSearch.ts:329-447`、`src/utils/collapseReadSearch.ts:755-780`、`src/utils/collapseReadSearch.ts:782-948`]

紧凑形式报告语义计数并改变时态：进行中的工作使用“Searching”“Reading”或“Running”，已完成的工作使用“Searched”“Read”或“Ran”。详细形式恢复每个原始 tool use 及其结果。[`src/components/messages/CollapsedReadSearchContent.tsx:220-258`、`src/components/messages/CollapsedReadSearchContent.tsx:260-292`、`src/components/messages/CollapsedReadSearchContent.tsx:345-412`]

**Pi Stuff 决策：** 按活动和回合片段折叠探索噪声，而不仅仅按相邻关系或工具名称折叠。保留 assistant prose 和有后果的操作作为边界。

### 6. 防止实时摘要闪烁以及工作看起来冻结

快速变化的当前动作提示至少保持 700 ms，使用户能够读到。长时间运行的 shell 活动仅在两秒后添加 elapsed time 和输出行数：快速操作保持简洁，工作缓慢时则向用户提供反馈。[`src/components/messages/CollapsedReadSearchContent.tsx:26-29`、`src/components/messages/CollapsedReadSearchContent.tsx:193-218`、`src/components/messages/CollapsedReadSearchContent.tsx:269-292`]

**Pi Stuff 决策：** 实时文本需要时间规则，而不只是颜色和 spinner。防止单帧提示、单调计数回退和措辞快速变化。

### 7. 仅在分组确有意义时对并行工作进行分组

通用分组过程仅应用于明确提供分组渲染的工具；仅当至少两个相同工具的调用来自同一个 assistant 响应时才应用；并且只在非 verbose 模式下应用。详细模式会在原始位置恢复单独的调用。[`src/utils/groupToolUses.ts:19-31`、`src/utils/groupToolUses.ts:48-64`、`src/utils/groupToolUses.ts:83-99`、`src/utils/groupToolUses.ts:119-181`]

在该快照中，分组渲染用于 Agent 调用，其摘要区分运行中、已完成和后台启动的 agent，并在分组下保留每个 agent 一行。[`src/tools/AgentTool/AgentTool.tsx:1380-1386`、`src/tools/AgentTool/UI.tsx:728-758`]

**Pi Stuff 决策：** 不要将无关操作合并成通用的“activity card”。只有仍可被理解为一个用户层面动作的并行/重复任务族才应分组。

### 8. 展开应当是选择性的，并与紧凑项配对

工具会报告其紧凑结果是否确实被截断。只有在 verbose 模式下能展示更多信息的折叠分组和结果才获得点击展开行为。Tool call 与 tool result 共享 expansion key，因此展开一个操作会同时展开其两半。[`src/Tool.ts:610-615`、`src/components/Messages.tsx:559-594`、`src/components/Messages.tsx:723-727`]

在非 fullscreen 上下文中，紧凑项可以提示全局 transcript shortcut；在虚拟化 fullscreen viewer 中，这一重复提示会被抑制。[`src/components/CtrlOToExpand.tsx:10-45`]

**Pi Stuff 决策：** 只有存在详情时才显示“expand”。展开应属于整个操作，而不是彼此断开的 call/result 片段。

### 9. 详细 transcript 是检查模式，而不是默认布局

打开 transcript 模式会提供 `verbose=true`，展开渲染投影，添加滚动/搜索导航，并保留专用 footer，说明用户正在查看详细 transcript。[`src/screens/REPL.tsx:317-337`、`src/screens/REPL.tsx:4392-4403`]

当前官方文档确认，`Ctrl+O` 会打开详细工具使用信息、展开折叠的 MCP 调用，并支持 transcript 搜索、显示全部、native-scrollback dump 和 editor export。官方 fullscreen 文档还说明，`/focus` 是更安静的投影，包含最后一个 prompt、带 diff 统计的一行工具摘要以及最终响应。参见 [interactive mode](https://code.claude.com/docs/en/interactive-mode#transcript-viewer) 和 [fullscreen rendering](https://code.claude.com/docs/en/fullscreen#search-and-review-the-conversation)。

**Pi Stuff 决策：** 保留一个安静的默认投影和一个一致的详细模式。不要为每个工具发明单独的 modal 或定制展开交互。

### 10. Thinking 被视为当前工作细节，而不是普通的持久 prose

在普通非 verbose 投影中，已完成的 thinking block 会被抑制。在详细 transcript 模式中，renderer 可以显示 thinking；更高层的 selector 会隐藏旧的 thinking，并优先显示当前回合的最新 block；流式 thinking 有单独的短生命周期路径。[`src/components/Message.tsx:524-558`、`src/components/Messages.tsx:381-419`、`src/components/Messages.tsx:714-719`、`src/screens/REPL.tsx:4401-4403`]

**Pi Stuff 决策：** 绝不要把 thinking 设计成普通 assistant answer。如果公开显示，应将其作为实时/当前诊断内容处理，并明确通过详细模式访问，而不是把它变成永久的主会话杂音。

### 11. 错误附着在失败层级，重试噪声则是临时的

Tool cancellation、rejection、error 和 success 都通过所属工具结果进行解析。优先使用工具专属错误 UI；通用 fallback 在紧凑模式下最多显示十行，并提示用户通过详细 transcript 查看其余内容。[`src/components/messages/UserToolResultMessage/UserToolResultMessage.tsx:36-89`、`src/components/messages/UserToolResultMessage/UserToolErrorMessage.tsx:23-101`、`src/components/FallbackToolUseErrorMessage.tsx:11-15`、`src/components/FallbackToolUseErrorMessage.tsx:30-86`]

API retry error 遵循不同策略：早期 retry attempt 被隐藏，当前渲染投影只保留连续 API error 中的最后一个；API-error 行保持动态，使恢复后可以移除它们。除 verbose 模式外，信息性 system message 也会被抑制。[`src/components/messages/SystemAPIErrorMessage.tsx:21-40`、`src/utils/messages.ts:1001-1025`、`src/components/Messages.tsx:812-817`、`src/components/messages/SystemTextMessage.tsx:200-215`]

**Pi Stuff 决策：** 区分操作失败、可恢复的传输重试和信息性系统状态。操作失败应保留在所属操作中；成功的自动恢复不应留下重试行轨迹。

### 12. 高容量 subagent 工作和工作控制状态不应淹没主会话

前台 subagent 运行期间，只显示有界的进度尾部；隐藏的工作会作为额外的 tool-use count 进行汇总。完成后，普通会话保留带 tool count、token 和 duration 的紧凑“Done”记录，而 transcript 模式可以显示 delegated prompt、详细进度和返回内容。后台运行则留下管理导向的摘要。[`src/tools/AgentTool/UI.tsx:445-569`、`src/tools/AgentTool/UI.tsx:315-409`]

Subagent sidechain 消息有独立的 transcript 写入路径，因此详细 worker history 不必复制到主会话的 progress stream 中。[`src/utils/sessionStorage.ts:1451-1461`、`src/utils/sessionStorage.ts:4325-4346`]

Todo 对工作控制状态也展示了相同的分离：它的 transcript renderer 有意缺失，同时更新外围 UI 所拥有的 task state。工具契约明确将 Todo 作为结果在其他位置呈现的示例。[`src/tools/TodoWriteTool/TodoWriteTool.ts:48-70`、`src/tools/TodoWriteTool/TodoWriteTool.ts:88-103`、`src/Tool.ts:561-565`]

`/btw` 同样会在可关闭的 command surface 中渲染问题和答案，并以 `display: "skip"` 结束，而不是将 side answer 添加到主会话。[`src/commands/btw/btw.tsx:36-65`、`src/commands/btw/btw.tsx:125-180`、`src/commands/btw/btw.tsx:229-242`]

Anthropic 当前官方文档说明了相同的产品意图：详细的 subagent 工作保留在 subagent context 中，只有相关摘要返回主会话。当前 `/btw` 行为比被检查的快照更新：side question 仍保留在 session-local BTW history 中并可重新打开，但仍不会进入主会话历史。参见 [subagents](https://code.claude.com/docs/en/sub-agents#isolate-high-volume-operations) 和 [interactive mode](https://code.claude.com/docs/en/interactive-mode#side-questions-with-btw)。

**Pi Stuff 决策：** 主会话记录 delegation 和 outcome，而不是 worker 的完整 stream。Todo 和 BTW 应保持为专用工作界面，而不是伪装成 assistant message。

## 推荐的 Pi Stuff 策略

源代码证据支持以下暂定策略，供之后用户确认：

1. 保持语义化 session event log 与每个 visual projection 分离。
2. 让默认会话回答三个问题：用户要求了什么，发生了哪些有后果的工作，以及 agent 得出了什么结论。
3. 将实时 progress 附加到所属操作，不持久化 progress tick。
4. 为工具提供通用操作语法，但提供工具专属的紧凑和详细 renderer。
5. 按语义活动折叠高容量探索；保留 prose 和有后果的操作作为边界。
6. 活动摘要使用现在时，已稳定的摘要使用过去时并包含结果。
7. 让详细 transcript 成为全局检查模式，在有用时辅以选择性的每操作展开。
8. 将错误保留在所属失败操作中；让已恢复的重试噪声消失。
9. 保持 subagent 工作隔离，将有界进度和持久化 outcome summary 返回主会话。
10. 让 Todo、BTW、settings 和 management state 保留在专用界面中，而不是向会话发送常规成功消息。

这些是根据被检查的快照和官方行为推断出的产品决策，不是要复现的代码。视觉样式、确切行数、颜色、glyph 和 shortcut 仍是独立决策。
