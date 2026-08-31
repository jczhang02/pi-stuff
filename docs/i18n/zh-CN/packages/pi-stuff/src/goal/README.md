<!-- translation-source: packages/pi-stuff/src/goal/README.md; translation-source-sha256: ca38b3bc18f5acdd6eee2c73ef9679f23ae04ab8310f0768533de2eb7a713a12 -->

# Goal

[English](../../../../../../../packages/pi-stuff/src/goal/README.md)

围绕一个 Session 目标持续推进、并由证据约束完成的工作方式。

## 快速开始

```text
/goal implement and verify the requested change
/goal status
```

使用 `/goal pause` 与 `/goal resume` 控制自动 continuation。不再需要保持目标时，使用 `/goal clear`。

## 亮点

- 持续推进结算工作，直到完成、暂停、budget、provider 限制或经过验证的 blocker。
- `goal_complete` 成功前要求逐项提供证据。
- 跨三个连续 Goal turn 审核稳定 blocker。
- 在当前 Session 中保存目标、状态、budget 和可选队列。
- 跨 Pi 原生 compaction 生命周期保持 Goal identity。
- 在共享 Statusline 中显示当前状态、用量、budget 和经过时间。

## 文档

- [Goal 指南](../../../../docs/capabilities/goal.md)
- [命令参考](../../../../docs/reference/commands.md#工作控制)
- [设置参考](../../../../docs/reference/settings.md#goal)
- [架构](../../../../docs/architecture.md#生命周期所有权)

