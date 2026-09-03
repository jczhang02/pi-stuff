<!-- translation-source: docs/adr/0025-protect-vibe-line-spinner-liveness.md; translation-source-sha256: 1a2285837b2d1ca631728b2a336650ce4d9ebcee037fc9fa93a34d512e6f13da -->

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

Conversation UI 只在固定 Thinking 标签中复用现有 `TRANSCRIPT_MARKER`（`•`）。展开的 Host Thinking run
带有同行前缀 `• thoughts: `；隐藏的 run 使用 Host 拥有的 `• thoughts` 标签。两者都保留 Host Thinking
样式，并让 marker cell 在 Host output padding 下与 Tool Activity 对齐。Pi Stuff 不检查、合并、选择、截断、
拟合或单独持久化 Thinking 内容。

硬保证目前仅适用于已认证 Linux x64 Host profile。极端输入规模下由 Host 所有的累积 Markdown 转换与渲染
仍是明确的上游限制；Pi Stuff 不声称修复或掩盖该 Host 行为。

## 已拒绝的替代方案

- 隐藏、替换或减慢 spinner 只会消除症状，Host 仍然处于阻塞状态。
- 把每一项同步计算或文件读取都移入 Worker，会在没有违规证据时增加投机性的并发与 lifecycle 机制。
- 声称涵盖 Host-owned rendering 的端到端活性会越过 Package 边界，并错误描述 Pi Stuff 的认证行为。

## 后果

每个违规 Capability 保留自己的 subprocess、Worker、cancellation 与 error 语义，同时移除该边界上的
Host-thread wait。连续累计 Thinking 表明，原有的语义 block 选择与宽度拟合投影仍会在同步 Markdown 路径上
与 Vibe Line Spinner 争用，因此该投影已移除。剩余固定标签必须在配对真实 Host Vibe Line 采样下匹配
identity/native Thinking，并通过已认证真实 PTY 的 500 毫秒门槛。微基准报告其固定标签成本，但不能替代
活性证据。未支持的平台可以在共享 seam 下获得同一结构修复，但本决策不对它们作出认证。
