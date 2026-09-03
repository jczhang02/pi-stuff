<!-- translation-source: docs/adr/0026-bound-context-managed-provider-requests.md; translation-source-sha256: 3598583d23a347d5abb3fe4d86043020bed47c6daefdea03192e4e949dfb95da -->

---
status: proposed
---

# 约束由上下文管理的 Provider 请求

## 背景

Magic Context 通常发送派生投影，而不是 Pi 的完整 Session 历史。传输失败可能丢失 Provider continuation
状态，使 Pi 在状态栏与 Context scheduler 仍反映上一次成功请求时组装另一个请求。现有 fail-open 行为随后
可能在没有最终容量检查的情况下，用大得多的原生上下文替换较小的投影。

## 决策

Context 活跃期间发出的每个 Provider 请求都必须携带有界上下文投影。上下文管理依据所选模型已配置 Context
window 的 95% 验证最终序列化 Provider payload；由于 Provider 请求不预留该输出，因此不扣除模型的最大输出。
如果模型没有可靠的已配置 Context window，或 payload 无法测量，请求就在本地停止，因为无法建立其边界。

原始输入未变化的自动传输重试复用同一份已验证投影。如果投影发生变化、失败或超过边界，上下文管理请求一次
Magic 紧急投影并再次验证。如果仍无法收敛，只有在原生压缩已启用时，Pi 才可以执行一次由 Host 拥有的原生
压缩和 continuation。否则，请求在本地停止并给出明确说明；上下文管理绝不静默发送无界原生回退，也绝不覆盖
用户的压缩设置。

恢复预算固定为：一次传输重试、一次 Magic 紧急重试，以及至多一次已启用的原生压缩重试。恢复期间，状态栏
用恢复状态替换过期的上下文百分比；恢复之外，状态栏在权威 Provider usage 到达前显示最近一次已验证的发出
估计值。该估计只保存在当前进程中，不写入 Session；重载或切换分支后先恢复为未知，直到下一次请求通过验证。
Pi 继续拥有 Agent 和 Provider 请求生命周期。

## 被拒绝的替代方案

- 无限重试无法缩小确定性超限的 payload，还可能形成成本与限流循环。
- 只防护 WebSocket 关闭码 1006，会让其他传输或 Worker 失败仍能触发同一种不安全切换。
- 根据 Provider 历史接受情况动态提高上限，会让本地安全承诺依赖不稳定的远端行为。
- 只修改固定版本的 Magic Context 软件包，无法验证由 Pi 组装的最终 Provider payload。
- 向上游报告该策略不在所选交付范围内；Pi Stuff 对其本地适配器保证负责。

## 后果

即使 Provider 本可接受请求，Pi Stuff 也可能因为保守的本地边界而停止它。作为交换，传输恢复不能再静默地用
完整原始 Session 替换已验证投影。验收必须包含一个聚焦的单元回归，以及一个带长原始历史的真实 Pi Host PTY
场景：确定性地在流开始后触发传输失败，无需再次输入即可恢复，每次实际发送都低于边界，不超过固定重试预算，
并在恢复耗尽时明确终止失败。在实现与这些验收证据完成之前，本 ADR 保持拟议状态。
