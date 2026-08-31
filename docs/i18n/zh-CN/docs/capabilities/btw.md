<!-- translation-source: docs/capabilities/btw.md; translation-source-sha256: 7e8c598ebd11032ca2bb9568ce41c5007f807e79f4820c5c1045dfe55bb2336e -->

# BTW

[English](../../../../../docs/capabilities/btw.md)

BTW 在主 Agent 继续工作时，通过聚焦 dialog 回答一个支线问题。问题与回答不会成为主 conversation 中的 message。

## 快速开始

在 Pi 编辑器中提问：

```text
/btw Why did the typecheck fail?
```

回答会在共享 Command Dialog 中流式显示。按 Escape 返回打开 dialog 前完全相同的编辑器草稿。

不带问题运行 `/btw` 会打开包含用法提示的 dialog。

## 控制

| 按键 | 操作 |
| --- | --- |
| Left / Right | 在保留的 BTW exchange 之间移动 |
| Up / Down | 滚动当前回答 |
| PageUp / PageDown 或 Space | 内容溢出时按页移动 |
| `c` | 复制选定回答 |
| `f` | 把选定问题与回答放入新的 Pi Session |
| `x` | 请求清除较早 BTW history |
| `y` | 确认待处理的 history 清除 |
| Escape | 取消确认或关闭 dialog |

布局在任何宽度都保持单栏。终端高度较小时，选中问题、当前错误和 Escape 路径优先于旧 history 显示。

## BTW 使用的 Context

BTW 接收 Pi 的有效完整 context，包括 compacted summary、文字、图像、Tool call 和 Tool result。未完成的
Assistant partial 会被排除。

请求使用活动 model 及其已配置认证，并设置 `tools: []`。它有独立 abort signal，因此关闭 dialog 只停止 BTW
请求，不会取消主 Agent。

回答不会回送到主 model context。需要让结果成为正式工作时，请使用提升功能。

## History

成功 exchange 保存为不可见的 Session custom entry。它们能跨进程重启和 Session resume 保留，但不会被
`/clear`、新 Session 或 fork 继承。

每个 Session 的 history 上限为 1,000 次 exchange 和 8 MiB。Dialog 同时显示最多五个近期问题，更大的有界
history 仍可导航。

如需移除较早 history，在同一个 dialog 中按 `x`，再按 `y`。Escape 取消确认。

## 提升回答

按 `f` 把选定 exchange 转成新的 Pi Session。提升会等待主 Agent 空闲，再把问题和回答作为普通 User 与
Assistant turn 写入新 Session。原 Session 只保留不可见 BTW history entry。

支线回答需要 Tool、后续推理或 conversation 中的持久位置时，使用提升。

## 适用场景

- 较长任务运行时澄清一个术语。
- 在不改变活动目标的情况下询问某项可见检查为何失败。
- 比较两个小选择，再决定是否提升回答。

当支线问题需要 Tool，或应当推动主工作时，请直接使用新 Session，不要用 BTW 替代。

## 相关文档

- [BTW Module README](../../packages/pi-stuff/src/btw/README.md)
- [Conversation UI](conversation-ui.md)
- [命令参考](../reference/commands.md)
- [DESIGN.md](../../DESIGN.md)
