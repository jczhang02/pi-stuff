<!-- translation-source: docs/adr/0025-protect-vibe-line-spinner-liveness.md; translation-source-sha256: 786452f698aa9f41bcc9d935eebc4b52541c4bd9d821b9c9876efe5676f04591 -->

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

保留的 Live Thoughts 复用现有 `TRANSCRIPT_MARKER`（`•`）作为前导图标。在完整标签与紧凑形式下，它渲染
后的 marker cell 都必须在 Host output padding 下与 Tool Activity 精确对齐。Thought 身份由 `thoughts:` 标签
和 Host theme 表达；Pi Stuff 不引入单独的星号或在不同终端字体下可能产生光学偏移的近似 glyph。

硬保证目前仅适用于已认证 Linux x64 Host profile。极端输入规模下由 Host 所有的累积 Markdown 转换与渲染
仍是明确的上游限制；Pi Stuff 不声称修复或掩盖该 Host 行为。

## 已拒绝的替代方案

- 隐藏、替换或减慢 spinner 只会消除症状，Host 仍然处于阻塞状态。
- 把每一项同步计算或文件读取都移入 Worker，会在没有违规证据时增加投机性的并发与 lifecycle 机制。
- 声称涵盖 Host-owned rendering 的端到端活性会越过 Package 边界，并错误描述 Pi Stuff 的认证行为。

## 后果

每个违规 Capability 保留自己的 subprocess、Worker、cancellation 与 error 语义，同时移除该边界上的
Host-thread wait。Live Thoughts 应通过有界拟合保留其显示契约；如果无法通过已认证的真实 PTY 验收，则应
移除该投影，而不是允许 Vibe Line Spinner 冻结。未支持的平台可以在共享 seam 下获得同一结构修复，但本
决策不对它们作出认证。
