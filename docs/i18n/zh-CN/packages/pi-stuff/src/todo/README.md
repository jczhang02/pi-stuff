<!-- translation-source: packages/pi-stuff/src/todo/README.md; translation-source-sha256: 9f0506846cb77d71493605d2e4dba6d8e9cd533003d9f157a3745efbccc5f672 -->

# Todo

[English](../../../../../../../packages/pi-stuff/src/todo/README.md)

带 dependency 的 Session 级 Agent checklist，以紧凑视图显示在编辑器上方。

## 快速开始

Agent 使用 `TaskCreate`、`TaskGet`、`TaskList` 与 `TaskUpdate` 创建和更新 task。按 `Ctrl+Shift+T`
折叠或展开可见 checklist。

## 亮点

- 在当前 Session branch 中分配稳定、单调递增的 task ID。
- 支持 pending、in-progress、completed、reopened 与终止 deleted 状态。
- 原子拒绝缺失、自引用或循环 dependency。
- 在编辑器上方显示最多五行有序 task 和 overflow。
- 随每项 task 保存 active form、owner、blocker 与 metadata。
- 在 Session start、compaction 和 tree navigation 后重建状态。

## 文档

- [Todo 指南](../../../../docs/capabilities/todo.md)
- [Tool Display 指南](../../../../docs/capabilities/tool-display.md)
- [Agents 指南](../../../../docs/capabilities/subagents.md)
- [共享 UI 契约](../../../../DESIGN.md)
- [上游参考](UPSTREAM.md)

