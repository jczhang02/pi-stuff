# Pi Stuff 下一轮统一执行清单

这份清单只收录已经确定要做的事情。目标不是“代码写完”，而是把 Pi Stuff 装进真实 Pi 后，常用界面舒服、功能可靠、长 Session 也能正常工作。

## 0. 先把项目记录整理正确

- [x] 以 Beads 为唯一正式任务记录；代码开始前，修正与当前决策不一致的旧任务。
- [x] 把 Background Shell、Monitor 和 `/tasks` 从“以后再做”改成正式待实现任务。
- [x] 关闭已经明确不要的 Plan Mode、结构化提问、Loop/Cron、`/doctor` 和内置 Skills 等旧任务。
- [x] 保留已经明确暂不做的 BTW Host 级调用和 Tool 相邻分组；它们只能等待 Pi 提供合适接口，不能为了实现而修改 Pi。
- [x] 检查 Beads 依赖图不存在循环、互相等待或无法到达的验收门；Magic Context 必须按“正式集成 → 独立压缩证明 → 清理旧 fork → 最终总验收”的顺序推进。
- [x] 实现完成后，把 Beads 状态同步到 GitHub Issues 镜像。

## 1. 先完成三项最重要的 UI 修正

### 1.1 Statusline（`ps-5cb.7.8.2`）

- [x] 做成已经确认的两行样式，视觉参考 `pi-footer`，但继续使用 Pi Stuff 自己的组件体系。
- [x] 第一行按这个顺序显示：模型 → Thinking 强度 → Fast（仅开启时）→ 当前目录 → Git → Context → 缓存命中率 → Cost 或 Codex weekly limit。
- [x] 不显示 token 数，不显示 worktime，Fast 未开启时不留空位。
- [x] 第二行只显示上一次用户输入的 Prompt，前面使用紧凑的蓝色实心圆点。
- [x] 两行的图标槽位和文字起始位置必须视觉对齐；同时修正 Nerd Font、宽字符和中文造成的偏移。
- [x] 图标大小保持一致，避免某些图标显得特别大。
- [x] 窄屏时整段隐藏低优先级信息，不能把字段截成难懂的残片，也不能发生重叠。
- [x] 使用真实 PTY 截图检查普通宽度、窄屏、中文 Prompt、Session 恢复和窗口缩放。

### 1.2 Fleetview 的位置和帮助行（`ps-5cb.7.8.5`）

- [x] Fleetview 永远位于两行 Statusline 下方，成为 Pi Stuff 最底部的区域。
- [x] 删除常驻的 `↓ to manage`。
- [x] Fleetview 自己保留一行固定高度的帮助槽位：静止时是空白行，进入管理时在原位替换成 `↑/↓ select · Enter view · x stop · Esc return`。
- [x] 窄屏时缩短整条帮助文案，不出现 `tx… done` 这类把不同字段挤在一起的内容。
- [x] 不在 Statusline 与 Fleetview 之间额外添加分隔线或空白；那一行空白属于 Fleetview 自己。
- [x] 验证 Agent 启动、完成、失败、停止、窗口缩放和打开 Dialog 时都不会闪烁、重叠或残留旧行。

### 1.3 Welcome（`ps-5cb.7.8.6`）

- [x] 保留已经确认的 Claude Code 风格 Welcome 卡片。
- [x] 把目前的 Pi 图案换成 pi.dev 官方标识的终端 ASCII 重建版。
- [x] 普通宽度显示完整 8×4 图案；空间不足时使用完整 4×2 图案，而不是把大图硬裁掉。
- [x] 图案下方保留一行有效空白，再显示模型信息，避免图案和文字贴得太近。
- [x] 图案使用 Pi 主题强调色；Pi Stuff 仍作为独立卡片标题，不冒充 Pi 本身。
- [x] 用真实终端截图检查普通宽度、窄屏和不同主题下的效果。

## 2. 实现普通后台任务

这一部分包含三个配套能力：Background Shell、Monitor 和 `/tasks`。它们不是 Todo，也不是 Goal。

### 2.1 Background Shell

- [x] 长时间运行的测试、构建和开发服务器可以转入后台，主 Agent 无需等待，可以继续工作和回复用户。
- [x] 当前台 Bash 正在运行时，允许用 `Ctrl+B` 把它转到后台；其他时候不抢占这个快捷键。
- [x] 后台任务保留有上限的输出，不能让日志无限增长。
- [x] 退出 Pi 时终止本 Session 启动的整个进程树；先发 TERM，必要时再发 KILL。
- [x] 防止 PID 复用、旧任务误认、孤儿进程和崩溃后的脏状态。
- [x] 不增加任何 Permission 弹窗或确认提醒。

### 2.2 Monitor

- [x] Agent 可以等待一个明确事件，而不是反复占用主对话轮询。
- [x] 支持等待命令、日志、文件或 HTTP 端点中的已知结果，例如 `ready`、`ERROR`、CI 完成或服务可访问。
- [x] 事件发生、超时或失败后，在对话中留下简洁结果，并让主 Agent 继续处理。

### 2.3 `/tasks`

- [x] `/tasks` 打开一个全宽、非浮动的 Command Dialog。
- [x] 它只管理当前 Session 的实时后台活动：Background Shell、Monitor 和正在运行的 Subagents。
- [x] `/agents` 继续负责 Agent 详情；Todo、Goal 和 Beads 保持各自职责，不合并进 `/tasks`。
- [x] 列表和详情可查看状态、运行时间、最近输出，也可以停止任务并返回主对话。
- [x] 平时不在 Statusline 或对话底部常驻显示任务面板；任务完成后只留下紧凑结果。

### 2.4 实现来源

- [x] 重新比较成熟 Pi Package，至少验证 `pi-patty-bg-tasks` 和 `pi-background-tasks` 的许可证、质量、维护情况和 Pi 兼容性。
- [x] 不因为某个 Package 借鉴 Claude Code 就排除它；只看最终能力和实现质量。
- [x] 采用成熟实现后必须 fork，但 fork 的源码只能进入 `pi-stuff` Monorepo，不能再建立独立本地仓库或 GitHub 仓库。

## 3. 把 Magic Context 调整为可替换的正式集成（`ps-5cb.21`）

- [x] Pi Stuff 不再保存或维护 Magic Context Core 源码，也不维护独立 Magic Context fork。
- [x] 使用经过审核的、固定版本的官方 `@cortexkit/pi-magic-context` Package。
- [x] 官方 Package 放在现有 `pi-stuff-context` Adapter 后面；以后要替换上下文方案时，不影响 Suite 其他部分。
- [x] Session 的原始记录仍由 Pi Session 文件保存。Magic Context 负责选择、压缩和召回提供给模型的上下文，不取代 Session 文件。
- [x] 保留延迟启用、遗漏生命周期补放、项目隔离、BTW/Agent 有界投影、Pi Stuff Tool UI，以及有用的 `/ctx-*` 诊断和恢复命令。
- [x] 屏蔽 Magic Context 自带的重复 Todo 和 Statusline，界面只保留 Pi Stuff 的唯一版本。
- [x] 明确唯一压缩权威：同一段历史只能由 Magic Context 或 Pi 原生压缩中的一个执行，绝不能重复生成两份摘要、两个同位置边界或两次 Goal 继续事件；长 Session 可以由 Magic Context 用多个不重叠、严格向前的边界逐段整理。
- [x] Magic Context 健康时，手动 `/compact`、自动阈值压缩和上下文溢出恢复都只由 Magic Context 执行；Pi 可以保留触发与 Session 记录职责，但不能再生成原生摘要。
- [x] Magic Context 在接管前已经不可用时，可以完整选择 Pi 原生路径；一旦 Magic 已开始本次压缩，失败后不能再叠加一次 Pi 压缩，应明确报告失败并保留完整 Session JSONL。
- [x] 真实验证新 Session、长 Session 恢复、压缩后重新加载、项目隔离、存储故障、BTW、Agents 和 Tool UI。

### 3.1 证明 Magic Context 可以独立、无感地压缩

这是一项阻断验收。测试时必须完全关闭 Pi 原生自动压缩和原生摘要兜底，避免“看似成功，实际偷偷用了 Pi 压缩”。

- [x] 使用真实 Pi、真实模型和真实 Context Window，而不是 Mock 或缩小版状态机。
- [x] 把上下文持续推到临界区，至少覆盖单个超长 Turn、大量 Tool 输出和多轮长 Session。
- [x] Magic Context 必须在请求超出窗口之前主动完成整理；主 Agent 不暂停、不报错，也不要求用户手动输入 `/compact`。
- [x] 每次完成一段整理时最多产生一条安静的压缩记录；用户看不到取消、重试、双重输出、任务中断或界面跳动。
- [x] Goal、Todo、Tool 状态、当前任务要求和仍在运行的工作不能在压缩时丢失或重复执行。
- [x] 压缩后继续追问时，Agent 能通过正常上下文或检索找回早期关键内容。
- [x] 退出 Pi 并冷 Resume 后仍然可用，原始 Session JSONL 保持完整。
- [x] 用事件、Session 记录和测试证据证明整个过程没有调用 Pi 原生压缩；Magic 边界与成功发布一一对应、严格向前，所覆盖的历史区间不重叠。
- [x] 检查 Prompt Cache 表现，确认 Magic Context 没有因为不必要地反复重写历史而明显破坏缓存命中。
- [x] 如果这项独立验证失败，不能宣称 Magic Context 已替代 Pi 压缩，也不能删除当前 fork 或完成 `ps-5cb.21`；必须重新选择集成方式。

- [x] 所有验证通过以后，才删除现有 Magic Context fork、工作目录和相关 GitHub 仓库。

## 4. 最终只保留一个 `pi-stuff` 仓库

- [x] 唯一正式源码 checkout 是当前 `pi-stuff` 仓库，不保留任何持久的兄弟源码目录。
- [x] 唯一正式 GitHub 仓库是 `jczhang02/pi-stuff`。
- [x] Web 和 MCP 不再依赖自己账号下的 GitHub Release tarball；优先改用固定版本的官方 Package，并继续放在 Pi Stuff Adapter 后面。
- [x] 如果某个能力确实必须修改上游源码，fork 直接作为 `pi-stuff` 内部 Package 保存，不创建新的仓库。
- [x] Codex、Goal 和 RTK 已在 Monorepo 中，确认来源和行为都保留后，删除对应的临时 fork。
- [x] 清理所有临时 worktree、额外本地源码仓库和多余的个人 GitHub fork。
- [x] 删除前逐项确认功能、许可证、来源记录和测试都已迁移；不能先删再补。
- [x] 保留 Settings Layer 中的 `packages/pi-stuff-current`。它只是指向当前安装版本的稳定链接，不是第二个源码仓库。

## 5. 对已经实现的能力做一次完整回归

这些能力原则上不重做，但必须确认真的能用、好用，并能在 Session 恢复后保持同样效果。

- [x] Tool UI：运行中、成功、失败、展开详情、窄屏，以及退出后 Resume 都使用统一渲染，不退回 Raw 样式。
- [x] Thinking UI：只显示当前实时 Thinking，原位更新，不把多个 Thinking 合并成一行，也不留下多余空白。
- [x] Todo：首行和 Agent 输出对齐，任务行距离紧凑，快捷键和显示上限正常，Session 恢复正常。
- [x] BTW：保持已经确认的简洁 Dialog，主任务继续运行，回答后恢复正确。
- [x] Agents/Fleetview：Subagent 启动、并发、完成、失败、停止、进入详情和返回都正确。
- [x] Goal：创建、持续执行、完成和恢复都正确。
- [x] Web 与 MCP：连接、调用、错误退化和 Tool UI 正确。
- [x] `/codex`：Fast 开关、Usage、Image Generation、Apply Patch 和 View Image 正确。
- [x] RTK：在长输出场景下有效减少上下文占用，不破坏命令结果。
- [x] `/ui`：只设置显示相关选项，不变成所有 Pi Stuff 功能的总设置页。
- [x] 确认 Permission Capability 已完全移除，不再出现权限提醒。

## 6. 用真实 Pi TUI 做最终验收

- [x] 安装前保存当前可恢复的 Pi Settings Layer 与 Pi Stuff 安装状态；安装或验收失败时必须能恢复，不覆盖或遗失用户自己的配置。
- [x] 从实际打包产物安装 Pi Stuff，不能只在源码测试或 Mock 中判断成功。
- [x] 完全退出已有 Pi 进程后，从新的 Shell 冷启动；确认实际只加载 `pi-stuff-current` 指向的打包版本，没有从源码目录、临时 worktree、旧 Extension 或重复 Package 偷偷加载能力。
- [x] 分别测试全新 Session、已有 Session Resume、长 Session、压缩后继续、普通宽度、窄屏、窗口缩放和不同主题。
- [x] 在真实任务中同时使用 Tool、Thinking、Todo、BTW、Subagents、后台命令、Monitor、Goal、Web、MCP、Codex、RTK 和 Magic Context。
- [x] 检查底部组件顺序、光标、草稿恢复、Escape、Dialog 返回、滚动、重绘、闪烁、重叠和残留行。
- [x] 主动制造命令失败、网络失败、Context 存储失败、Agent 失败和强制停止，确认退化方式清楚且不损坏 Session。
- [x] 对发现的问题立即修复并重复真实 TUI 测试，直到日常使用没有明显不适。
- [x] 运行完整自动化检查、Package 审计和安装测试。
- [x] 按主题分批提交并推送；最后 `main` 与 `origin/main` 一致，工作区干净。
- [x] 更新 Beads 和 GitHub 镜像，关闭真正完成的任务，并留下最终验收报告和截图证据。
- [x] 最终报告提供逐项证据索引：每个复选项都能对应到真实命令、测试结果、PTY 截图或 Session 记录；不能用一句“全部通过”代替证据。

## 明确不做

- Rewind / Checkpoint。
- Mem0 或另一套独立 Memory 系统；当前先让 Magic Context 负责上下文方案。
- Permission 插件或日常权限确认。
- LSP。
- Plan Mode、结构化 Ask 或额外提问系统。
- Loop、Cron、跨 Session 唤醒和常驻 Daemon。
- `/doctor`。
- 默认捆绑 Skills。
- 可交互浏览器。
- 浮动窗口、Dashboard 或 Sidebar。
- Fork 或修改 Pi Host。

## 完成标准

只有同时满足以下条件，整轮工作才算完成：

1. 上述已选功能全部落地，没有用文档或 Mock 代替真实实现。
2. 所有关键流程都在实际 Pi TUI 中使用并通过，而不仅是自动化测试通过。
3. UI 在普通宽度、窄屏、Resume 和长 Session 下都没有明显错位、重叠、闪烁或 Raw 回退。
4. Magic Context 在完全关闭 Pi 原生压缩时也能独立、无感地完成真实长任务；同时具备明确且不会双重压缩的故障退化路径，不会绑死 Pi Stuff。
5. 最终只剩一个正式 `pi-stuff` 源码仓库和 GitHub 仓库。
6. 冷启动实际加载的是安装后的唯一打包版本，不依赖源码目录、旧 Extension 或临时 worktree，并保留可用的安装回退点。
7. Beads、GitHub 镜像、代码、逐项验收证据和文档状态一致，`main` 工作区干净。
