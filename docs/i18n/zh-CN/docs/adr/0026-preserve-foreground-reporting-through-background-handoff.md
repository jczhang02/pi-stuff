<!-- translation-source: docs/adr/0026-preserve-foreground-reporting-through-background-handoff.md; translation-source-sha256: 0c72f3b893d43a766246d01eb2f31a4d97257e664572e2824a6fac99ba51cb6c -->

---
status: accepted
---

# 在 Background Work 移交后保留前台报告义务

## 背景

前台 Bash invocation 可能在 `Ctrl+B` 或 runtime 自动阈值触发后继续运行，超过当前 Agent turn。若把这种
Foreground Handoff 当作显式独立 background launch，原始 terminal notification 就可能成为 Session 的最后
输出，而没有 Agent turn 能生成 Completion Report。

## 决策

Foreground Handoff 改变执行位置，但不改变当前用户工作的 ownership。它的成功、失败或 timed-out terminal
outcome 必须重新激活 main Agent，并由 Completion Report 处理。工作仍 active 时，Agent 可以给出明确的非终态
handoff update，但该消息不能解除报告义务。

显式 `run_in_background: true` launch 默认仍是独立且非唤醒的。这一区分由 Background Work 所有；它不会创建
Suite-wide task coordinator，也不会转移 Goal 或 Agents 的 lifecycle authority。

主动请求的 stop 会同步向发起者确认，不会引发第二次唤醒。时间接近的必需 outcome 可以共享一个 Agent
turn；main Agent 处于 active 状态时到达的 outcome 会加入该 turn，而不是启动竞争 turn。Monitor outcome
绝不会解除 Background Shell 的报告义务，但两者可以一起交付。

continuation 启动后，Agent 会检查有界 terminal evidence，并恢复原来已获授权的工作，而不只是复述 command
status。只有没有更多 scope 内工作时，它才生成 Completion Report。已移交 Shell 自己就是 terminal wake
source；Agent 不会仅为看守该 Shell 而创建 Monitor。

Session shutdown 会同时终止所属 process 及其报告义务；Suite 不会在另一个 Session 中复活它。Background
Work 保证一次带有明确报告指令、可用的 Agent continuation；它不会为后续 Host 或 model failure 添加自主重试
循环或 semantic response validator。

实现复用 Shell 是否在 launch 时已经 backgrounded，区分显式独立 launch 与稍后发生的 Foreground Handoff。
它不会新增公开 wake option、改变两分钟自动 handoff，也不会新增 Conversation UI message state。

## 已拒绝的替代方案

- 为每个 Background Shell 都唤醒，会把有意独立的工作变成未经请求的 Agent turn。
- 用 prompt 提醒 Agent 记得报告，无法解决后续 Agent turn 根本没有启动的问题。
- 跨 Capability work coordinator 会在没有证据表明 Goal 或 Agents 导致本次失败时扩大 lifecycle authority。
- 特殊 provisional-message UI、另一个 wake 参数或移除自动 handoff，都会扩大公开 surface，却不修复 owning
  seam 中缺失的 continuation。
- 用 Monitor 看守每个已移交 Shell 会复制 terminal authority，并保留暴露本次故障的 timeout race。

## 后果

完成修复前必须具备以下证据：手动与自动 handoff 在 success、failure、timeout 下的聚焦覆盖；显式 background
launch、stop、shutdown 保持非唤醒；Monitor ordering 与 notification batching 正确；复现本次 Monitor 先超时、
Shell 后完成的顺序；以及代表性的真实 Host 证据，证明 terminal handoff 会恢复 Agent，并在无需用户再次发消息
的情况下以非空 Completion Report 结束。
