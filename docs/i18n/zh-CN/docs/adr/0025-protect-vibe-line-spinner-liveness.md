<!-- translation-source: docs/adr/0025-protect-vibe-line-spinner-liveness.md; translation-source-sha256: 9ce6870cbd687fa316280e1f630883fdbd89662145029d67e33c2107e64e6862 -->

---
status: accepted
---

# 在 Pi Stuff 边界内保护 Vibe Line Spinner 活性

## 背景

Host 拥有的 Vibe Line Spinner 是 Pi 处理 Agent 工作时可见的活性信号。当同步投影、子进程或文件系统工作
独占 Host 线程时，Pi Stuff 会冻结该动画，即使底层操作最终仍能完成。隐藏 spinner、改变采样方式或提高
stall 门槛只会掩盖 Host 阻塞，而不会恢复活性。

## 决策

在已认证 Host profile 内，当 Agent 工作处于 active 状态时，Pi Stuff 所有的路径不得让同一个已渲染 Vibe
Line Spinner frame 连续保持不变超过 500 毫秒。验收从 Host event loop 外部观察已渲染终端，并要求操作最终
settle 且界面恢复。

Pi Stuff 所有的 Host-thread 路径不得同步等待外部进程。所属 Capability 应改用自己的异步 Effect/native
adapter，或把完整操作移到其现有 child 或 Worker 边界，同时保留 cancellation、timeout、failure 和 cleanup
语义。该规则不会创建通用 Suite process runtime，也不会把 lifecycle authority 移出所属 Capability。

普通同步计算与有界文件系统访问不会仅因其同步就被迁移。只有代表性的真实 PTY 证据表明其超过 500 毫秒
活性上限时才需要处理；此后应在共享 owning seam 采用最小修复。display-only Capability 只有在不改变规范
Session 或 Provider 内容的前提下满足该限制时才予以保留。

Conversation UI 只在固定 Thinking 标签中复用现有 `TRANSCRIPT_MARKER`（`•`）。显示中的 Host Thinking
run 只经过一次 Host 原生 Markdown component 渲染，然后在同行前缀 `• thoughts: ` 后只保留最后一条终端行；
隐藏的 run 使用 Host 拥有的 `• thoughts` 标签。前缀保留 Host Thinking 样式，并在 Host output padding 下
与 Tool Activity 对齐。整行超过 viewport 时，有界的渲染后投影保留内容尾部。Pi Stuff 不解析 Thinking
源码、不合并 run、不做模型分类、不运行刷新计时器，也不单独持久化显示状态。

Pi 目前没有公开的 Thinking 渲染后 seam。因此 Conversation UI 会在
`AssistantMessageComponent.updateContent()` 外安装一个有 guard、与版本绑定的 adapter，并替换 Host 创建的
Thinking Markdown children。同一 adapter 还会仅在同一条 Assistant message 内 Assistant prose 直接位于
Thinking run 之前时，补回 Host 缺失的 spacer；现有的开头间距与 Thinking-to-prose 间距保持不变。公开的
MIT Package `@99percentpeople/pi-thinking-fold@0.1.9` 已证明渲染后选行可行；Pi Stuff 只保留这一渲染
顺序，不复制其源码，也不采用其计时器、按键绑定、设置、Working Row 或模型专用行为。adapter 会验证认证
component 布局；布局不可用时明确失败。Host 提供等价公开 seam 后必须移除该 adapter。

硬保证目前仅适用于已认证 Linux x64 Host profile。极端输入规模下由 Host 所有的累积 Markdown 转换与渲染
仍是明确的上游限制；Pi Stuff 不声称修复或掩盖该 Host 行为。Pi Stuff 新增的工作量取决于消息 component
数量和终端列数，而不是累计 Thinking 长度。

## 已拒绝的替代方案

- 隐藏、替换或减慢 spinner 只会消除症状，Host 仍然处于阻塞状态。
- 把每一项同步计算或文件读取都移入 Worker，会在没有违规证据时增加投机性的并发与 lifecycle 机制。
- 声称涵盖 Host-owned rendering 的端到端活性会越过 Package 边界，并错误描述 Pi Stuff 的认证行为。
- 解析有界源码尾部无法识别原生 Markdown 换行后的最后一条终端行，而解析语义 block 会恢复已经删除的
  全源码启发式处理。
- 周期刷新计时器会在没有新 Provider delta 时增加工作，并与 Host 拥有的 Vibe Line Spinner 争用。

## 后果

每个违规 Capability 保留自己的 subprocess、Worker、cancellation 与 error 语义，同时移除该边界上的
Host-thread wait。连续累计 Thinking 表明，原有的语义 block 选择与宽度拟合源码投影仍会在同步 Markdown
路径上与 Vibe Line Spinner 争用，因此该投影已移除。最新行 adapter 必须在配对真实 Host Vibe Line 采样下
匹配其他条件相同但未安装 adapter 的 Host，并通过已认证真实 PTY 的 500 毫秒门槛。component 微基准会报告
其增量成本，但不能替代活性证据。未支持的平台可以在共享 seam 下获得同一结构修复，但本决策不对它们
作出认证。
