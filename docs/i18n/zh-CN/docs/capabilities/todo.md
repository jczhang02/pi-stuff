<!-- translation-source: docs/capabilities/todo.md; translation-source-sha256: fe2be921ab95c8a06bb8e56d8749e8f0306f8f9ab1ba41111f587c57fc3b844d -->

# Todo

[English](../../../../../docs/capabilities/todo.md)

Todo 为 Agent 提供 Session 尺度的 checklist，支持 dependency、状态转换和编辑器上方的紧凑视图。

## 快速开始

Agent 使用四个 Tool：

1. `TaskCreate` 定义具体工作；
2. `TaskUpdate` 把当前项标成 `in_progress` 并添加 dependency；
3. `TaskList` 或 `TaskGet` 检查当前状态；
4. 验证完成后，用 `TaskUpdate` 完成项目。

Checklist 可见时，按 `Ctrl+Shift+T` 折叠或展开。

## Tool 参考

| Tool | 必需字段 | 可选字段 |
| --- | --- | --- |
| `TaskCreate` | `subject`、`description` | `activeForm`、`metadata` |
| `TaskGet` | `taskId` | — |
| `TaskList` | — | — |
| `TaskUpdate` | `taskId` | `subject`、`description`、`activeForm`、`status`、`addBlockedBy`、`addBlocks`、`owner`、`metadata` |

`TaskCreate` 拒绝空白 subject 或 description，分配单调递增的字符串 ID，并让任务从 `pending` 开始。
`TaskUpdate` 只修改提供的字段；metadata key 设为 `null` 时会删除。

`TaskGet` 返回完整的当前记录。`TaskList` 返回所有未删除任务及其 status、subject、owner 与未解决 blocker。

## 状态转换

支持 `pending`、`in_progress`、`completed` 和 `deleted`。

- Pending 与 in-progress task 可以互相转换、完成或删除；
- completed task 可以重新打开；
- deleted task 是终止状态，不再出现在 Get 或 List 结果中。

没有产生变化的 update 会作为幂等 no-op 成功。

## Dependency

`addBlockedBy` 和 `addBlocks` 添加 dependency edge。遇到未知、已删除、自引用或循环 dependency 时，update
会原子拒绝，并保持现有 checklist 不变。

Task List 会标出未解决 blocker。完成 blocker 后，其 dependent 会变为可运行，无需重写记录。

## Checklist

只有存在工作时，checklist 才显示在编辑器上方。它最多显示五行 task 和一条 overflow summary，顺序为：

1. 近期完成项；
2. in-progress task；
3. 可运行 pending task；
4. blocked pending task；
5. 较早完成项。

存在 `activeForm` 时，in-progress 行使用经过清理的单行 activeForm，否则使用 subject。Pending 使用 `□`，
active 使用 `■`，completed 使用 `✓`；状态文字与布局在不同主题下仍保持可读。

所有 task 完成后，checklist 保留五秒再清除。折叠只改变可见 overlay，不改变 task state。

## Session 状态

Todo 状态属于当前 Session branch。Session start、compaction 与 tree navigation 时，会从带版本的 Tool snapshot
重建；replay 后 ID 仍保持单调递增。

Session shutdown 会清除进程内副本。Pi Session transcript 是 replay 来源，不需要独立 task database。

紧凑的成功 Tool call 依靠 checklist 提供即时反馈。展开 Tool Activity 和错误仍可通过 `Ctrl+O` 与 `/tools`
查看。

## 相关文档

- [Todo Module README](../../packages/pi-stuff/src/todo/README.md)
- [Tool Display](tool-display.md)
- [Agents](subagents.md)
- [共享 UI 契约](../../DESIGN.md)

