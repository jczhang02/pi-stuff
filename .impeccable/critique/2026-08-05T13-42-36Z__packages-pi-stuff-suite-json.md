---
target: all shipped Pi Stuff UI
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-05T13-42-36Z
slug: packages-pi-stuff-suite-json
---
# Pi Stuff 全量 UI 视觉审查

Method: dual-agent (A: `/root/ui_design_assessment` · B: `/root/ui_evidence_assessment`)

## Design Health Score

| # | Nielsen 启发式 | 分数 | 结论 |
|---|---|---:|---|
| 1 | 系统状态可见 | 3/4 | Thought、Tool、Todo、Fleetview 和后台工作反馈完整；后台 Agent 启动后显示 `done` 会误导。 |
| 2 | 符合真实世界 | 2/4 | 大部分词语直接；`Tasks` 同时指 Shell、Monitor、Agent，且 `done` 不总是完成。 |
| 3 | 用户控制与自由 | 3/4 | Esc/back、stop、steer、resume 与输入草稿恢复优秀；BTW 历史清除没有确认或撤销。 |
| 4 | 一致性与标准 | 3/4 | Divider、gutter、语义颜色和全宽 Command Dialog 高度一致；低高度裁切尚未统一。 |
| 5 | 预防错误 | 3/4 | 破坏性 Goal 操作会确认，终端文本会净化；BTW 的单键清空过于直接。 |
| 6 | 识别优于记忆 | 2/4 | 大部分界面有就地提示；少数快捷键依赖记忆。Fleetview 静止时留白是已确认的安静设计，不算缺陷。 |
| 7 | 灵活与高效 | 4/4 | 键盘导航、搜索设置、直接命令、后台工作和分层详情对熟练用户非常高效。 |
| 8 | 美观与克制 | 3/4 | 无关 chrome 会自动消失；繁忙状态叠加较多，过暗的必要文字会形成视觉噪声。 |
| 9 | 识别错误并恢复 | 3/4 | 错误跟随原操作，resume 后保留紧凑记录；错误/退出提示在极矮布局中可能被裁掉。 |
| 10 | 帮助与文档 | 3/4 | Welcome、命令说明、状态相关 footer 与 Goal Help 完整；少数高级操作仍靠既有知识。 |
| **总分** | | **29/40** | **可用且已有清晰设计体系；需要一轮聚焦修整。** |

## 设计辨识度

Pi Stuff 不是一套通用终端仪表盘。它的辨识度来自交互结构：Welcome 属于 scrollback、两行语义状态栏、Tool 固定 marker、Todo/Fleetview 只在相关时出现、Command Dialog 全宽且不浮动、关闭后精确恢复输入草稿。这套 Claude Code 风格、对话优先、低装饰的方向应该保留。

机械 detector 对 `packages/pi-stuff/suite.json` 返回零条规则命中；这是因为目标是 Pi Package 清单而非 HTML/CSS，不能据此判断 TUI 视觉质量。浏览器预览不适用本次原生 TUI 审查，证据改用 Pi 0.83 的真实 PTY、ANSI、PNG 和终端单元格宽度扫描。

## 总体印象

当前 UI 已经“能用、整体好用，而且像一个完整产品”，最成熟的是焦点切换和状态所有权：打开设置或详情时，编辑器、footer、Todo、Fleetview 不会互相争夺空间；关闭后又能恢复原草稿和原状态。现在最需要处理的不是换视觉风格，而是让状态用词更诚实、必要文字更清楚、所有对话框在极矮终端中遵守同一规则。

## 做得好的部分

- 两行状态栏、瞬态 Todo/Fleetview 与持久 transcript 的职责分开，完成后界面能安静地退场。
- 响应式策略以“按语义优先级移除字段”为主，不是粗暴截断整行；本次状态栏提示文本也已做到 Latin/CJK/emoji 相同起点。
- Tool、Agent、BTW、MCP、Goal、RTK、Context 的 resume、失败和降级路径都有真实 Pi 验证，长文本和 CJK 没有造成越界。

## 优先问题

### P1 — 后台 Agent 只是启动，却显示 `done`

后台 Agent 默认仍在运行，但 Tool transcript 会立刻落成 `Agent … done`；之后它甚至可能出现 `Agent stopped`。这会把“启动命令已经完成”和“Agent 工作已经完成”混在一起，是当前最明显的状态语义错误。

建议：后台单个/批量启动分别显示 `launched` / `3 launched`；前台执行结束显示 `finished`；stop、steer、resume 使用各自动作结果。只有所代表的工作确实结束时才使用 `done`。

建议后续命令：`/impeccable:polish Agent tool lifecycle wording`。

### P1 — Command Dialog 的极矮终端规则不统一

Tools 已经会先保留标题、当前选中/错误和 Esc footer，再把剩余高度给正文；Agents、Codex、Goal、RTK、UI 的部分状态仍可能先裁掉错误或退出提示。正常终端不明显，但 24×16 或运行中 resize 时会损害可控性。

建议：把 Tools 的 footer-first `fitRows` 规则提升为共享 Dialog 布局原语，并为 list/detail/loading/error/empty/composer 建立 24×16 到 100×32 的统一矩阵。

建议后续命令：`/impeccable:harden all Command Dialog low-height layouts`。

### P1 — 必要内容有时使用了过低对比度

源码把部分必要身份和状态放进了 `dim`，亮色证据里也能看到弱化；尤其 Todo 的“普通待办”和“被阻塞待办”都使用 `□`，主要差异落在明暗上。需要说明的是，一张暗色 running PNG 实际混用了亮色 ANSI 与暗背景，不能作为生产暗色主题的可靠证据。因此这里的风险来自语义 token 使用和可访问性，而不是把那张截图误判为生产效果。

建议：先补一套可信的同状态暗色、亮色和无 ANSI 对照证据，再让 `dim` 只承载可安全忽略的分隔符、快捷键、过期/已完成元数据；身份和状态用 `text`，必要的次级上下文用 `muted`；blocked Todo 增加文字或不同形状。

建议后续命令：`/impeccable:colorize semantic TUI text without changing the visual grammar`。

### P2 — 长 Bash Tool 的可选目标会缩成无意义碎片

宽度临界点附近会出现 `| s… · done`、`| … · done` 甚至标点残片。它不越界，Tool 名和最终状态也仍然存在，但留下的目标内容没有识别价值。

建议：如果可选目标无法保留一个可识别单元，就整体移除目标段，把空间留给 Tool 名和结果；为标点-only、单字符和 CJK 边界增加测试。

建议后续命令：`/impeccable:distill compact Tool target truncation`。

### P2 — BTW 历史清除是单键、立即且不可撤销

历史视图中的 `x` 会直接清除并持久化，没有确认或恢复。建议仍在同一个全宽界面内切成两步：`Clear earlier BTW history? y confirm · Esc cancel`，无需引入弹窗。

建议后续命令：`/impeccable:harden BTW history clearing`。

## 不应误改的既定设计

- Fleetview 静止时的帮助槽保持空白，是已经确认的安静布局；不要重新加入突兀的 `to manage`。
- UI 继续拒绝浮动窗口；设置使用 Pi 原生 SettingsList，其余管理界面使用全宽 Command Dialog。
- Welcome 是唯一允许边框的主要界面；普通输出和 Tool 记录不新增卡片。
- Thought、Tool、Todo、Fleetview 与状态栏保持各自唯一所有者，不能靠重复输出增强“可见性”。

## Persona 风险

- **Alex（熟练、急躁）**：最容易被假的 `done` 和无意义的 `s…` 拖慢判断；大量菜单缺少直接 ID 跳转时也要重复按键。
- **Sam（依赖可访问性）**：必要信息过暗、blocked Todo 只靠明暗区分，以及低高度时退出/错误提示消失，都是实际障碍。
- **Riley（压力测试）**：24×16 resize、BTW 单键清空和后台 Agent `done → stopped` 是最容易稳定复现的薄弱点。

## 次要观察

- `/tasks` 的标题与项目词汇中的 Background Work 不完全一致。若保留 Claude 兼容命令，可把界面标题改成 `Background work`，并把 `/work` 作为更明确的别名；这不是首批视觉修复。
- `/ui` 有八个平铺选项，Goal 在活跃状态下可达到九项。暂不应为了“四项一组”强制增加层级；只有用户实际寻找困难时再做轻量分区。
- 当前保留证据对 `/tools`、`/agents`、`/tasks`、`/btw`、`/codex`、`/mcp`、`/rtk`、`/goal` 的同状态暗/亮主题截图并不完整。运行验证已通过，但下一轮发布验收应补齐一套可视觉回归的证据矩阵。

## 验证摘要

- Pi Host：真实 Pi `0.83.0`。
- 原生验证：10 组 PTY verifier 全部通过。
- 聚焦 UI 测试：94 passed，0 failed，564 expectations。
- 静态终端帧：扫描 51 份，0 行超过记录的终端宽度。
- 当前状态栏对齐：100×32、64×28、48×22、32×18、24×16 全部通过；Latin、CJK、emoji 单元测试通过。
- 浏览器与 DOM overlay：不适用，未启动浏览器或服务器。

## 待确认的问题

1. 是否把 `Agent … done` 的语义修复列为下一项立即实现？
2. 是否允许把所有 Command Dialog 的低高度布局统一成 Tools 的 footer-first 规则？
3. 必要文字的对比度修整，是严格维持当前配色只更换语义 token，还是允许小幅调整主题 token 本身？
