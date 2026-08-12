# P0/Open Beads：Codex Session 证据与实现说明

> 调研日期：2026-08-11  
> 范围：当前 Beads 中全部 `P0 + open` 的 canonical 工作项  
> 结论：当前批次共有 7 项；`ps-4xm` 已降为 P4，暂不纳入；`ps-axz` 与 `ps-nwe` 已分别合并并关闭为 duplicate。

## 1. 一页结论

这 7 项不是 7 个同等级的“红色线上事故”。这里的 P0 表示维护者已经决定把它们放进同一个当前实施批次，而不是单纯按故障严重度排序。其中：

- `ps-imw` 是最先要打通的运行时阻塞：合法的 child Agent 请求在到达 provider 前就被错误拒绝。
- `ps-ft6`、`ps-reb` 是同一次真实 Agent dogfood 暴露出的两个独立投影错误：一个在 Tool Activity 摘要，一个在 `/agents` 详情。
- `ps-b51` 是跨 Suite TUI 的共用显示正确性基础，覆盖 Unicode 截断与路径折叠。
- `ps-48b` 统一 transcript 中 Tool Activity 的“结果含义”和 marker 语法。
- `ps-klj` 修正 prompt 提交后仍停留在旧滚动位置的问题。
- `ps-ubz` 是已经冻结到 Revision 2 的 Fleetview 重设计，最后需要真实 PTY 回归。

| 建议实施序 | Bead | 类型 | 核心结果 | 主要证据 |
| ---: | --- | --- | --- | --- |
| 1 | `ps-imw` | Bug | 合法 child payload 能真正到达 provider | S1:L130143、L130250 |
| 2 | `ps-ft6` | Bug | 只统计实际启动的 Agent，不累计失败尝试 | S1:L130003、L130250 |
| 2 | `ps-reb` | Bug | `/agents` 详情只显示一次任务，并显示真正终止错误 | S1:L130085、L130250 |
| 3 | `ps-b51` | Bug | 所有用户可见预览按 grapheme/终端 cell 安全截断；路径折叠不再产生 `…/` | S1:L129410、L129440 |
| 4 | `ps-48b` | Feature | settled Tool Activity 按有效结果着色，并统一为 `• ` marker | S1:L129757、L129854 |
| 5 | `ps-klj` | Bug | 提交 prompt 时恢复 tail-following 并滚到底部 | S2:L107、L110 |
| 6 | `ps-ubz` | Feature | Fleetview 与 Statusline 对齐、无空白帮助行、只突出选择与异常文本 | S1:L130683、L130689 |

这里的“实施序”只是降低返工的次序，不是把后面的项目继续延期。7 项仍属于同一批：

1. 先修 `ps-imw`，否则真实 Agent 测试会在 provider 前失败。
2. 在同一轮 Agent dogfood 中验证 `ps-ft6` 与 `ps-reb`。
3. 先落 `ps-b51` 的共享显示约束，再让 `ps-48b` 和 `ps-ubz` 使用同一套终端宽度事实。
4. 最后做完整的 100×32、64×28 PTY 组合回归。

## 2. 证据边界与 Session 索引

本文把证据分成三层，避免把讨论中的设想写成已经实现的行为：

1. **Session 观察**：真实 Pi/Claude Code dogfood、用户决策和当时的诊断过程。
2. **Bead 契约**：当前 canonical description、design 和 acceptance criteria。
3. **现行源码核对**：截至调研日仍存在的实现机制；这只证明“为什么当前会这样”，不代表已经完成修复。

本地 Codex JSONL 使用以下别名。行号格式如 `S1:L130143`；路径已去掉用户名，不引用私人 prompt 或 payload 内容。

| 别名 | 本地记录 | 用途 |
| --- | --- | --- |
| S1 | `~/.codex/sessions/2026/07/31/rollout-2026-07-31T22-48-09-019fb8a5-9c94-7091-8158-cfda1417f323.jsonl` | 2026-08-11 的主要设计、真实 Pi dogfood、Claude Code 对照与 issue 创建记录 |
| S2 | `~/.codex/sessions/2026/08/11/rollout-2026-08-11T16-07-55-019fefdd-2668-7d21-8b4d-3f42c5066b96.jsonl` | `ps-klj` 的查重、创建与验收记录 |
| S3 | `~/.codex/sessions/2026/08/11/rollout-2026-08-11T19-25-07-019ff091-af14-7053-893f-70dc3e29b6e8.jsonl` | 当前批次的 P0 调整、`ps-4xm` 暂缓和重复项合并 |

Session 时间戳是 UTC；本文日期按 Asia/Shanghai。Session 文件不属于仓库，因此这些行号是本地溯源定位，不是可移植的仓库链接。

当前 Beads 状态以本地数据库为权威，并已刷新到 [`.beads/issues.jsonl`](../../.beads/issues.jsonl)。S3:L140-L141 记录了“`ps-4xm` 暂不处理，其他一起处理”的维护者决策；S3:L213-L214 记录了 P0/P4 调整、两个 canonical scope 更新和 duplicate 关闭结果。

## 3. `ps-imw`：修正 child payload 的 byte/token 单位错配

### 3.1 用户实际看到的故障

真实 Pi 0.84.1 使用 `openai-codex/gpt-5.6-sol` 启动 3 个后台 Agent 时，3 个 child 都在约 2–3 秒内失败，而且 provider usage 为零。即使关闭 Skills 和项目上下文，一个新的 `general-purpose` child 仍然无法启动（S1:L129988、L130003、L130143）。

这不是“模型上下文真的太长”。当时的最终 provider-visible payload 约 81.7 KB，本地 gate 却拿它和约 76K 的 token 派生容量直接比较，于是在 provider request 之前拒绝了请求（S1:L130143、L130250）。错误信息看起来像正常的 request-size 保护，实际比较的量纲并不一致。

### 3.2 当前源码为什么会这样

[`subagent-prompt-runtime.ts`](../../packages/pi-stuff/src/subagents/src/runs/shared/subagent-prompt-runtime.ts#L87) 中：

- `finalProviderPayloadCapacity()` 从 `contextWindow`、`maxTokens` 和 25% reserve 计算容量；这些值属于 token 语义。
- `validateFinalProviderPayload()` 随后在 [L123](../../packages/pi-stuff/src/subagents/src/runs/shared/subagent-prompt-runtime.ts#L123) 使用 `Buffer.byteLength(serialized, "utf8")` 得到 byte 数。
- 两个数被直接比较。
- 该检查在 [L528](../../packages/pi-stuff/src/subagents/src/runs/shared/subagent-prompt-runtime.ts#L528) 的 provider 调用前执行，所以被拒绝的请求根本没有到达模型。

根因因此很明确：安全 gate 本身有必要，但它把 token capacity 当作 byte capacity 使用。

### 3.3 正确的改动边界

应保留最终 payload gate，只把两边变成可比较的单位：

- 优先使用 provider-aware token accounting；如果 Host/provider 没有可靠 tokenizer，则使用经过认证、对 ASCII、CJK、高熵文本和 Tool schema 都保守的估算。
- reserve、fallback model、`maxTokens`、Skills、child extensions 和 Tool schemas 都必须计入最终 provider-visible payload。
- 诊断应明确报告采用的容量单位和保守估算，而不是继续把 token 数描述成 byte 上限。
- 不应通过简单放大常数或删除 gate 来绕过错误；那会把本地假拒绝变成 provider 侧不可控失败。

### 3.4 完成标准

- 合法且有界的 fresh child 在认证 Host/model 上完成一次真实请求并产生非零 usage。
- 真正超限的 payload 仍在本地失败，且错误信息准确、内容有界。
- 单元测试明确保证不会再直接比较 byte length 与 token capacity。
- 覆盖 ASCII、CJK、高熵内容、Tool schema、Skills、child extensions、fallback model 和输出 reserve。

### 3.5 与其他 P0 的关系

这是 Agent 相关工作的运行时前置条件。`ps-ft6`、`ps-reb` 和 `ps-ubz` 可以写代码，但如果 `ps-imw` 未修，真实 provider dogfood 会持续被本地 gate 截断，无法证明完整生命周期正确。

## 4. `ps-ft6`：Tool Activity 只投影实际启动的 Agent

### 4.1 用户实际看到的故障

同一真实 Pi turn 中，第一次请求 3 个 Agent，被 preflight 拒绝，实际启动数为 0；随后重试 3 个新 Agent并成功。最终 compact Tool Activity 却显示 `Launched 6 background agents`。流式参数尚不完整时，target 还短暂出现 `undefined · Agent task`（S1:L129988、L130003、L130250）。

因此有两个相关但不同的显示错误：

1. settled summary 把“请求过多少个”当成“真正启动多少个”；
2. streaming target 把缺失字段直接字符串化。

### 4.2 当前源码为什么会这样

[`agent-tool-presentation.ts`](../../packages/pi-stuff/src/subagents/src/extension/agent-tool-presentation.ts#L64) 先计算：

- `requestedCount = params.tasks?.length ?? 1`；
- 只有 foreground 且已有 result 时，才用 `result.details.results.length`；
- background 路径继续使用 requested count。

Tool Activity 再聚合同一 phase 中的两次尝试，于是失败的 3 次请求和成功的 3 次启动被加成 6。target builder 也会在 partial args 未齐时读到缺失字段。

### 4.3 正确的改动边界

- “launched”只能来自明确的 child launch acknowledgement/result，不能来自参数中的意图数量。
- preflight refusal 应贡献一个 issue，而不是成功启动计数。
- partial args 中缺失的 name/task/count 应省略或使用明确的中性占位，绝不能显示 `undefined`、`null`、空 separator 或虚构计数。
- 一次失败尝试随后被同等重试成功时，最终 marker 交给 `ps-48b` 的 deterministic recovery 规则处理；`ps-ft6` 只负责把事实投影正确。
- model-visible Tool result 和 durable Session record 不变，只修 UI projection。

### 4.4 完成标准

关键回归场景是“3 个被拒绝，然后 3 个成功”：最终必须显示恰好 3 个 launched Agent，并得到正确的 recovered marker。还要覆盖 foreground/background、single/parallel、streaming partial args、reload/resume、Ctrl+O，以及 100×32 和 64×28 PTY。

### 4.5 为什么不与 `ps-imw` 或 `ps-reb` 合并

三者来自同一次 dogfood，但根因和修改层不同：

- `ps-imw`：provider 前的 payload safety gate；
- `ps-ft6`：Agent Tool 的 transcript/activity projection；
- `ps-reb`：current-session 到 Command Dialog 的详情 projection。

把它们塞进一个 bead 会让任何一个局部完成都无法独立验收，也会把运行时风险和纯显示风险混在一起。

## 5. `ps-reb`：在 `/agents` 详情中只显示一次真正的失败

### 5.1 用户实际看到的故障

同一批 3 个失败 Agent 在 `/agents` 列表中能正确显示 `failed`，但进入详情后：

- delegated task 出现在 `Task`；
- transcript 的 User 内容再次出现同一任务；
- `Partial result` 又显示一层任务包装；
- 最有用的 terminal error 反而没有显示。

这一点在 100×32 和 64 列真实 PTY 中都可见（S1:L130085、L130250）。

### 5.2 当前源码为什么会这样

[`current-agents.ts`](../../packages/pi-stuff/src/subagents/src/session/current-agents.ts#L19) 的 `AgentTranscriptTarget` / `AgentRow` 有 `partialResult`，但没有明确的 terminal error 字段。

[`partialResult()`](../../packages/pi-stuff/src/subagents/src/session/current-agents.ts#L503) 优先从 `finalOutput`、`summary`、`output` 和 recent output 等通用字段选择文本。这些字段可能只是任务包装或重复摘要，而不是实际错误。

[`agent-dialog.ts`](../../packages/pi-stuff/src/subagents/src/ui/agent-dialog.ts#L647) 依次渲染 State、Transcript，并在 [L720](../../packages/pi-stuff/src/subagents/src/ui/agent-dialog.ts#L720) 额外追加 Partial result；由于 projection 没有 terminal error，Dialog 无法把错误放到高优先级位置。

### 5.3 正确的改动边界

- 从已有 Agent metadata/output 中提取 terminal error，经过 ANSI/Bidi 清理、长度和终端宽度限制后，作为明确字段进入 current-session projection。
- failed/crashed 详情应在 `State` 正下方显示错误，低高度窗口也必须优先可见。
- delegated task 由 `Task` 区域负责；如果 transcript/partial result 只是 byte-equivalent 或可确定的同一 task wrapper，就不再重复。
- completed Agent 仍保留真正的 result 和 transcript，不能因为去重而丢掉有效输出。
- reload/resume 后投影必须一致；Esc/back 不能被长错误挤出可见区域。

### 5.4 完成标准

用真实失败 payload 验证：详情顶部能看到有界的真实错误，任务只出现一次，低高度仍能退出；completed、failed、crashed、reload/resume、ANSI/Bidi、CJK/emoji 和 100×32/64×28 都有覆盖。

## 6. `ps-ubz`：按真实 Claude Code 证据重做 Fleetview

### 6.1 这不是“照抄 Claude Code”

该项的目标是用真实 Claude Code subagent UI 作为可见行为参考，同时继续遵守 Pi 的 Host composition：Fleetview 仍是 editor 下方、Suite 最底部的 Operate-mode ambient surface；Agent detail 仍使用现有全宽、非浮动 Command Dialog。

Session 先确认本机没有可直接使用的 Claude binary，因此没有假装完成对照（S1:L130443）。随后下载并校验官方 Claude Code 2.1.197 Linux x64 binary，在 localhost-only deterministic fixture 中复现 foreground/background、roster navigation、selection 和 child view；没有读取用户配置、凭证，也没有外部模型流量（S1:L130495、L130525）。Pi 侧使用认证的 0.84.1 PTY harness，在 100×32 与 64×28 下重跑，现有 roster/dialog 26 项测试通过（S1:L130559）。

### 6.2 对照真正暴露的问题

首轮观察认为“两格 gutter + 圆点”与 Claude 接近，问题更像是：

- idle 时永久保留的空 help row；
- routine state、main marker、长 `general-purpose` 名称同时抢视觉权重；
- roster 像诊断面板，而不是安静的 Agent presence。

后来用户指出 Claude 的 Fleetview 实际与 Statusline 起始列对齐，不应保留 Pi 自己没有语义的两格空 inset。再次按 cell 检查后确认：Claude 前两格属于它自己的结构/navigation slot；Pi 已用移动的 filled marker 表示选择，不需要复制空 slot（S1:L130636、L130683）。

因此最终权威是 **Design Revision 2**（S1:L130689），不是更早的“两格 inset”候选。

### 6.3 当前源码与冻结设计的差距

[`agent-roster.ts`](../../packages/pi-stuff/src/subagents/src/ui/agent-roster.ts#L370) 当前仍然：

- 总是把 `renderHint()` 放进 roster rows；idle 时这会保留一行空白；
- hint、overflow 与 roster prefix 使用前导空格；
- [L461](../../packages/pi-stuff/src/subagents/src/ui/agent-roster.ts#L461) 的 `markerPrefix` 是两格空白后再放 marker；
- main/selected marker 与多种状态 marker 使用强调色，routine 状态也可能争夺注意力。

这些行为说明 Revision 2 尚未实现。

### 6.4 冻结后的实现契约

布局：

- 没有 child Agent 时，Fleetview 渲染 0 行。
- idle 时不保留 blank help row；Statusline row 1、latest-prompt row 2 后直接接 main/child rows。
- 管理模式把 footer row 2 原位替换成控制提示；退出后精确恢复原 prompt row。
- Fleetview marker、管理提示和 overflow 都从 terminal cell 1 开始；cell 2 恰好一个空格；文本从 cell 3 开始。

视觉：

- 非管理模式中，main marker 是 filled 但使用 normal color；child marker open + muted。
- 管理模式中只有 selected marker 使用 accent。
- marker 只表示 main/selection，不表示 success/failure。
- routine state 与 elapsed time 使用 muted；waiting 只给右侧状态文本 warning；failed/crashed 只给右侧状态文本 error，且必须保留文字，不能只靠颜色。
- 使用配置中的 Agent name，不在 renderer 内发明 alias；配置本身应偏向 `scout`、`worker`、`reviewer` 等短角色名。

保留：

- wide 最多 5 个 child、narrow 最多 4 个；
- live-before-terminal、selected-row retention、overflow、完整描述或省略、30 秒 terminal linger；
- Enter、方向键、Esc 和 `x stop` / `x dismiss` 行为；
- 全宽非浮动 Agent detail。

明确不做：Fleet title、border/card、floating window、永久 help、Statusline Agent count、latest-tool activity、token stats、重复 transcript summary、spinner 或 Claude 源码复制。

### 6.5 完成标准

真实 100×32 与 64×28 PTY 必须同时证明：

- 0 child = 0 Fleetview rows；
- idle 无空行；
- marker/hint/overflow 从 cell 1 开始，文本从 cell 3 开始；
- manage hint 原位替换并精确恢复 footer row 2；
- main/live child/terminal child 的提示分别正确；
- 只有 selected marker 强调，异常色只落在右侧状态文字；
- name、description、right state 不重叠；
- resize、reload/resume、Command Dialog 往返、draft/editor focus 无回归。

### 6.6 与 `ps-48b` 的规则优先级

`ps-48b` 只统一 **conversation transcript** 的 marker。它吸收的历史 `ps-axz` note 曾写过 Fleetview 保留两格 gutter，但该段已被 `ps-ubz` Revision 2 的后续实测和用户决策覆盖。实现时：

- transcript 看 `ps-48b`；
- Fleetview 看 `ps-ubz` Revision 2；
- Command Dialog 继续保持自己的 selector grid，除非另有 issue。

## 7. `ps-48b`：按有效结果着色，并统一 transcript marker

### 7.1 为什么“有一个失败就整组红”不成立

用户先询问当前 Tool Activity 是否只要一个 Tool 失败，整组就变红。源码核对确认答案是“是”：settled group 的 `issueState` 只要有失败就为 error，folded marker 因此为红色；正文仍为灰色（S1:L129451、L129459、L129465）。

用户随后明确反对“已经结束的组只因中间失败就一直红”，并给出目标规则（S1:L129736、L129746、L129757）：

| settled phase 的事实 | 最终 marker |
| --- | --- |
| 全部成功 | 绿 |
| 失败后，被可证明等价的成功操作覆盖 | 绿，表示 recovered |
| 有有用成功，但仍有未解决或无法证明已恢复的失败 | amber/warning |
| 实际工作没有产生任何有意义的成功效果 | 红 |
| 只有 rejection/cancellation | 不用红；按中性/警告语义 |

Recovery 必须是确定性、纯 UI projection：只能用 exact normalized retry，或 Tool 内部声明的 effect key。不能发 LLM side-query，不能 fuzzy guess；无法证明等价就保持 amber（S1:L129765、L129775）。

### 7.2 marker 与 spacing 决策

同一 session 中，用户要求参照 Codex，把 transcript marker 换成更小的 `U+2022 •`，并保持一个可见空格（S1:L129783、L129785）。

最初讨论曾错误地把范围理解成只有 assistant prose。用户追问后，范围被纠正为：

- assistant prose；
- folded/running Tool Activity Group；
- Ctrl+O 展开的 standalone/per-Tool rows；
- 同层级 wrapped continuation 的文本起点。

这些位置统一使用 `• text`，不是 `● text`，也不是 `•  text`（S1:L129843、L129851、L129854、L129860、L129868、L129870）。

### 7.3 当前源码为什么不符合

[`tool-display/activity.ts`](../../packages/pi-stuff/src/tool-display/activity.ts#L510) 聚合 raw state counts，并在 [L526](../../packages/pi-stuff/src/tool-display/activity.ts#L526) 使用 `failed > 0 ? "error"`。它还没有“已恢复”“混合未解决”“无有效成功”等 effective outcome。

[`tool-display/render.ts`](../../packages/pi-stuff/src/tool-display/render.ts#L133) 当前 marker 是较大的 `U+25CF ●`；[L156](../../packages/pi-stuff/src/tool-display/render.ts#L156) 根据 raw `issueState` 选色；wrapped continuation 还有独立的空格规则。因此颜色、glyph 与对齐目前都可能跨组件漂移。

### 7.4 合并后的 canonical scope

原 `ps-48b` 负责 effective outcome，原 `ps-axz` 负责 marker/spacing。两者已合并为 canonical `ps-48b`，因为它们最终都落在同一个 Tool Activity/transcript rendering boundary，且验收互相依赖：

- 不能先把 marker 换成 `•` 却仍保留错误的红色语义；
- 也不能只算对颜色，却让 assistant、folded group 和 expanded row 使用不同 marker/grid。

`ps-axz` 保留为 closed duplicate，用于保存原始对齐证据，不再单独实施。

### 7.5 完成标准

- running 与 settled 明确区分。
- all-success、recovered、mixed-unresolved、all-failed、rejected、cancelled 都符合上表。
- failure count 继续显式存在，expanded member 保留自己的状态色。
- recovery 在 reload/resume/compaction 后完全确定，不改变 prompt、schema、Session 或 API token。
- assistant、group、expanded Tool row 使用 `U+2022 + 1 display cell`；同级 continuation 对齐。
- 覆盖 streaming、Ctrl+O、light/dark、CJK、narrow terminal 和真实 TUI 截图。
- 不顺手改 Fleetview、Dialog selector、Todo checkbox、MCP toggle 或 Statusline 图标。

## 8. `ps-klj`：提交 prompt 时回到 conversation 尾部

### 8.1 问题与证据强度

问题本身很直接：用户已经向上滚动 conversation 后按 Enter 提交 prompt，viewport 仍停在旧位置，新 prompt 和后续 assistant/Tool 输出可能完全不在屏幕内。

与其他 6 项不同，当前可定位的 S2 证据从 issue 查重和创建开始，没有一段独立保存的、逐帧真实 PTY 复现叙述。S2:L107 明确决定只记录“submission boundary 触发 scroll-to-bottom”，不新增抽象；S2:L110 创建 bead，S2:L114 验证 description/design/acceptance，S2:L117 确认只写入 Beads。因此本文不把未保存的额外现场细节当成已验证事实。

### 8.2 当前源码的可疑边界

[`input-enhancement.ts`](../../packages/pi-stuff/src/conversation-ui/input-enhancement.ts#L372) 包装 editor；其 [`onSubmit` setter](../../packages/pi-stuff/src/conversation-ui/input-enhancement.ts#L466) 当前只是把 callback 直接交给底层 editor，没有恢复 tail-following 或滚动 conversation 的动作。

仓库中其他局部 UI（例如 BTW）有自己的 `followTail` 状态，但不能据此假定 conversation Host 使用同一个私有 API。实现时应先沿 Pi 当前 prompt submission 与 conversation scroll seam 确认可复用入口，不应新造第二套滚动状态。

### 8.3 正确的改动边界

- 只在“真正提交 prompt”的共享边界恢复 tail-following，并把 viewport 移到当前 bottom。
- 普通编辑、补全、换行、history navigation、selection 等非 submit 动作不得强制滚动。
- 后续 assistant/Tool streaming 应继续保持可见，直到用户再次主动向上滚动。
- 复用 Host 已有 conversation scrolling mechanism；没有证据支持时，不在 report 中预设具体私有方法名。

### 8.4 完成标准

一个最小回归必须从“conversation 已向上滚动”开始：按 Enter 后立即到达当前底部，新 prompt 和随后输出持续可见；再证明非 submit editor action 不改变 scroll position。

### 8.5 为什么单独保留

它与 `ps-48b` 都影响 conversation，但修改生命周期不同：`ps-48b` 是 transcript row projection，`ps-klj` 是 input submission 与 viewport state。合并只会制造一个跨 rendering/input 的大 issue，没有共享根因。

## 9. `ps-b51`：统一 Unicode 截断与路径折叠

该 canonical bead 合并了两个看似不同、实际共享“终端显示宽度契约”的问题：

1. 原 `ps-b51`：用户可见 preview 使用 JavaScript `.length` / `.slice()`，可能拆开 surrogate/grapheme，或超出终端 cell 预算。
2. 原 `ps-nwe`：多个路径折叠器独立生成字体敏感的 `…/`，即使逻辑 cell 正确，ellipsis 最后一颗点与 slash 仍可能在常见 monospace font 中视觉粘连。

### 9.1 路径折叠的真实诊断

真实输出包括：

- Tool Activity：`…/.pi/agent`；
- `/rtk` binary row：`/opt/…/bin/rtk`；
- RTK search/linter：`/…/深层/file.ts`。

PTY/tmux 对 `U+2026` 与 `/` 的 cell 计数是正确的；ANSI dim、indent 和控制字符也被排除。问题在 glyph ink/right bearing，而不是 cursor column 算错（S1:L129200、L129233、L129252）。

后续审计又确认 RTK `compactPath()` 使用 code-unit length，某个 `maxLength = 14` 的 CJK 结果实际 `visibleWidth = 15`（S1:L129352、L129386、L129410）。这解释了为什么现有 character-grid 测试能通过，却仍有肉眼错位。

### 9.2 Unicode 截断的真实诊断

Agent arg preview、current Agent text 和 streamed output 等位置直接使用 JavaScript `.slice()`。JavaScript 计算 UTF-16 code unit，不理解 grapheme，也不理解终端 cell：

- 31 个 emoji 在 60 code-unit 边界截断时，会留下 unpaired high surrogate 再拼 `...`；
- CJK 的 code-unit 数可能在上限内，但显示宽度已经超出；
- combining mark 与 ANSI-styled input 也不能用裸 `length` 安全预算。

这一独立根因在 S1:L129410、L129421、L129432-L129433 和 L129440 中被最小复现并记录。

### 9.3 当前重复实现位置

现行源码至少包含以下用户可见 seam：

- [`path-utils.ts / compactPath()`](../../packages/pi-stuff/src/rtk/upstream/techniques/path-utils.ts#L34)：用 `length/slice` 做路径预算；
- [`rtk-dialog.ts / compactRtkBinaryPath()`](../../packages/pi-stuff/src/rtk/rtk-dialog.ts#L35)：独立的 RTK binary path 折叠；
- [`agent-tool-presentation.ts`](../../packages/pi-stuff/src/subagents/src/extension/agent-tool-presentation.ts#L16)：Agent Tool target/arg preview；
- [`current-agents.ts / boundedText()`](../../packages/pi-stuff/src/subagents/src/session/current-agents.ts#L196)：current Agent 可见文本；
- [`shared/utils.ts / boundStreamedRecentOutput()`](../../packages/pi-stuff/src/subagents/src/shared/utils.ts#L426)；
- [`shared/utils.ts / extractToolArgsPreview()`](../../packages/pi-stuff/src/subagents/src/shared/utils.ts#L515)。

这不是“修一个截图里那条路径”就能结束的问题；同一错误模式已经跨 Agent、Tool、Background Work、RTK、Web 和 MCP projection 出现。

### 9.4 合并后的正确契约

- 先做 ANSI/Bidi/控制字符清理，再按 grapheme 与 terminal visible width 截断。
- 优先复用 Host 已有 terminal-width utilities；只有现有能力确实不足时，才补一个 Suite 共享 helper。
- 所有 Suite-owned collapsed paths 使用同一套 cell-aware grammar。
- 折叠结果不能让 `U+2026` 紧邻 slash，并要尽量保留最近有用目录与 basename。
- absolute、relative、home、hidden directory、Windows separator、CJK 与 emoji path 都必须有定义。
- **严格区分显示投影与协议/存储上限**：不能因为修 UI preview 就缩短 model-visible Tool result 或 durable transcript。

### 9.5 为什么合并是合理的

原 `ps-nwe` 与 `ps-b51` 的表面症状不同：一个是字体 bearing，一个是 UTF-16/grapheme/cell。但执行时都需要：

- 找出所有 Suite-owned user-visible bounding/path seams；
- 统一到 terminal cell-aware contract；
- 用 CJK/emoji/窄终端与真实 PTY 验证；
- 保持 protocol/storage/model-visible 内容不变。

因此合并能避免两个实现者分别造两个“差不多”的宽度 helper。`ps-nwe` 作为 closed duplicate 保存原始字体与路径证据；canonical `ps-b51` 的验收必须保留两类回归，不能只修其中一半。

### 9.6 完成标准

- 用户可见 preview 不产生 unpaired surrogate，不拆 grapheme，不超 terminal-cell budget。
- 覆盖 ASCII、CJK、emoji、combining mark、ANSI input。
- collapsed path 不出现 `…/`，且仍保留有用路径上下文。
- 覆盖已确认的 31 emoji 边界、CJK visible-width overflow 和三类旧路径输出。
- 100×32、64×28 的 plain/dim 实际视觉检查通过。
- durable transcript、完整 Tool result、protocol/storage byte cap 完全不变。

## 10. 为什么只合并两组

本轮已经完成的合并如下：

| Closed duplicate | Canonical P0/open | 合并理由 |
| --- | --- | --- |
| `ps-axz`：Codex-style bullet/spacing | `ps-48b`：Tool Activity outcome + transcript marker | 同一 transcript rendering boundary；颜色语义与 marker/alignment 必须一起验收 |
| `ps-nwe`：font-sensitive path elision | `ps-b51`：terminal-cell-safe truncation + path elision | 同一 terminal presentation contract；共享跨 surface 审计和 Unicode/PTY 回归 |

其余五项不建议继续合并：

| Bead | 应保持独立的原因 |
| --- | --- |
| `ps-imw` | provider 前 safety gate，涉及容量与真实请求，不是 UI 修饰 |
| `ps-ft6` | Agent Tool Activity 的事实计数与 partial target |
| `ps-reb` | current-session projection 与 `/agents` detail 信息层级 |
| `ps-klj` | prompt submission 与 viewport lifecycle |
| `ps-ubz` | Fleetview footer composition、selection 和 responsive layout |

它们可以在一个工作批次内连续处理，但没有足够共享根因。继续合并会让 issue 变成跨 runtime、session、input、transcript、footer 的“大杂烩”，反而更难领取、回滚和验收。

## 11. 建议的实施与验证矩阵

| 阶段 | 工作项 | 最小实现目标 | 必须留下的验证 |
| --- | --- | --- | --- |
| A：打通 Agent | `ps-imw` | 单位一致的 provider payload gate | 单元边界 + 一次真实 child 非零 usage |
| B：修正 Agent 投影 | `ps-ft6`、`ps-reb` | 启动事实正确；错误详情可见且不重复 | 同一 3-fail/3-success 场景，100×32/64×28 |
| C：统一显示基础 | `ps-b51` | 一个已有或最小共享的 cell-aware contract | emoji/CJK/combining/ANSI/path tests + real PTY |
| D：整理 transcript | `ps-48b` | effective outcome + `• ` grid | outcome matrix、Ctrl+O、reload/resume、themes |
| E：修提交体验 | `ps-klj` | submit 恢复 tail-following | scrolled-up submit regression |
| F：落 Fleetview Revision 2 | `ps-ubz` | cell-1 alignment、无 idle 空行、安静状态层级 | Claude/Pi matched PTY、resize/manage/dialog/reload |

每个阶段都应遵守 [ADR 0002](../adr/0002-group-complete-tool-activity-between-narrative-boundaries.md) 的 narrative boundary、[`CONTEXT.md`](../../CONTEXT.md) 的 Pi-as-Host 边界，以及 [兼容性契约](../compatibility.md)：只改变 Suite-owned projection，不把新的状态协议塞进 model-visible Tool schema 或 durable Session。

## 12. 最终状态

截至本文生成时：

- **P0/open canonical：7 项**：`ps-imw`、`ps-ft6`、`ps-reb`、`ps-b51`、`ps-48b`、`ps-klj`、`ps-ubz`。
- **closed duplicate：2 项**：`ps-nwe → ps-b51`、`ps-axz → ps-48b`。
- **暂不处理：`ps-4xm`**，状态仍 open，但优先级为 P4，不属于当前批次。
- 本文只完成说明、证据整理与工作边界冻结；7 个 canonical bead 仍是 open，尚未声称实现完成。
