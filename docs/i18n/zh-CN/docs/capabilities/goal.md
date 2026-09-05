<!-- translation-source: docs/capabilities/goal.md; translation-source-sha256: 4f2a32862ae4f0fe2e44fc64d8b0860103adb2ae9803b3377d7eceeb476874de -->

# Goal

[English](../../../../../docs/capabilities/goal.md)

Goal 让一个重要目标跨 Agent turn 保持活动，直到工作完成、暂停、清除或被证明阻塞。

## 快速开始

```text
/goal implement and verify the requested change
/goal status
```

Goal 会把目标和完成契约加入后续 Agent turn。需要停止自动 continuation 时使用 `/goal pause`，可以继续工作时
使用 `/goal resume`。

## 生命周期

活动 Goal 会在 Pi 结算后继续，直到发生以下结果之一：

- Agent 调用 `goal_complete`，并为每项要求提供证据；
- 用户暂停或清除 Goal；
- 显式 token budget 用尽；
- provider 报告认证或用量限制；
- 同一个外部 blocker 通过三 turn 审核。

普通不确定性、未完成工作、计划或建议的下一步都不是终止结果。

完成或最终 blocker 被接受后，系统会先记录 Goal 终止状态和最终用量。如果显式 token budget 已耗尽，
包括包含终止 Tool call 的那次回复刚好耗尽预算，run 会直接停止，不再请求 Provider。已有的预算收尾和其他
强制停止路径也保持立即终止。否则 Pi 执行普通的 Tool follow-up，让模型发送 **Goal Final Response**：
Conversation Transcript 中的一条正常 Assistant 消息。排队 Goal 会等到当前 run settled 后再启动。
如果 Provider 请求失败，已记录的终止状态仍是权威状态；失败的 run settled 后，排队工作仍可继续。

## 命令

| 命令 | 操作 |
| --- | --- |
| `/goal [--tokens 100k] <objective>` | 启动或替换当前 Goal |
| `/goal` | 打开 Goal 设置 |
| `/goal status` | 显示当前目标、状态、budget 与队列 |
| `/goal edit [--tokens 100k] <objective>` | 修改活动目标或 budget |
| `/goal pause` | 暂停自动 continuation |
| `/goal resume` | 恢复暂停、受限或中断的 Goal |
| `/goal clear` 或 `/goal stop` | 清除当前 Goal 状态 |

Token budget 接受普通整数以及 `k` 或 `m` 后缀。目标最多 4,000 个字符。

## 完成与阻塞

Goal 工作活动时，Agent 可以使用 `goal_complete`。它要求准确的当前 `goal_id`、有实质内容的摘要，以及每项要求
对应的一条具体证明。

`goal_blocked` 用于记录真正无法推进的情况。只有同一个 blocker 连续三个 Goal turn 被报告，且每次都有不同的
尝试与观察到的失败，runtime 才会停止 Goal。前两次报告只记录进度，continuation 仍会继续。

完成时的 Goal Final Response 会总结结果、验证情况和遗留风险。Tool result 会提供终止转换时的正数 token
用量（即使没有预算）、存在显式预算时的用量与预算对照，以及正数 elapsed time，并要求在回复中自然报告
这些事实。Goal accounting 在该转换处
关闭，因此报告回复本身不会计入已完成 Goal 的 token budget。检查已完成或受阻 Goal 时会保留该用量快照；
恢复或编辑 Goal 后，后续 Goal 用量也不会补计期间的报告 token。阻塞回复则说明已经证实的 blocker，以及所需的
用户或外部操作。紧凑终止 Tool row 只记录机器结果；Goal 不会再发出重复的终止通知。该回复步骤中仍可使用
普通 Tool。

这套终止协议避免短回答、重复声明或过期 Tool call 结束错误的 Goal。

## Continuation 与限制

自动 continuation 和无进展限制默认都是 `null`：continuation 不限，选配的无进展保护关闭。不可配置的
10,000-response 紧急 backstop 始终存在。

可以在 Goal 设置 dialog 中设置正整数限制：

- **Automatic turns** 在达到配置的自动 model response 数量后暂停；
- **No-progress turns** 在连续若干 turn 没有被接受的进展后暂停。

暂停和受限 Goal 可以恢复。Provider 用量或认证停止会保留 Goal，访问恢复后使用 `/goal resume`。

## Statusline 与 Tool

只有当前 Goal 状态需要持续指示时，共享 Statusline 才显示 Goal。它包含状态、token 用量和可选 budget，以及活动
经过时间。

`toolVisibility` 控制 `goal_complete` 与 `goal_blocked` 何时出现：

- `always` 从 Session 启动时就显示；
- `after-first-goal` 在当前 Session 第一次激活 Goal 工作后显示。

## 持久化与 compaction

Goal 状态保存在当前 Session 中，并在 reload、resume 与 branch navigation 后恢复。新 Session 不继承 Goal 状态。

Pi 负责原生 compaction。Goal 会跨一次匹配的 compaction 保留目标、完成 guard 与 continuation identity。
如果该 compaction 失败，失败结算后会重试一次过期 continuation。

## 实验队列

把 `goal.experimental.goals` 设为 `true`，可启用最多 64 个额外 Goal 的队列：

- `add` 或 `push` 追加目标；
- `prioritize` 或 `unshift` 激活新目标，并把当前 Goal 放到队列最前；
- `drop-last` 或 `pop` 移除队尾；
- `skip` 或 `shift` 清除当前 Goal，并激活队首。

队列仍属于当前 Session，并使用同一套生命周期与证据规则。
队首只会在终止 run settled 后激活，包括预算允许时的正常 Goal Final Response。最终 Provider 回复失败
不会重新打开已终止 Goal，也不会让队列搁浅。

## 相关文档

- [Goal Module README](../../packages/pi-stuff/src/goal/README.md)
- [命令参考](../reference/commands.md#工作控制)
- [设置参考](../reference/settings.md#goal)
- [架构](../architecture.md#生命周期所有权)
