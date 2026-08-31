<!-- translation-source: packages/pi-stuff/src/background-work/README.md; translation-source-sha256: 8264fe90e64b7da8fe2bf31961a76bb64a04817465ae17754b2074b4f78390c3 -->

# Background Work

[English](../../../../../../../packages/pi-stuff/src/background-work/README.md)

在主 Agent 继续工作时运行 Background Shell 与一次性 Monitor，并自动报告完成。

## 快速开始

让 Agent 使用 `run_in_background: true` 启动 Bash，或为 command、file、log、HTTP 证据创建 `monitor`。
然后打开：

```text
/tasks
```

Dialog 列出当前工作、跟随有界输出，并停止当前 Session 拥有的 activity。

## 亮点

- 在启动时、通过 `Ctrl+B` 或前台运行两分钟后分离 Bash。
- 跨四种 source 监控精确 success 或 failure text。
- 自动送达最终结果，无需在 conversation 中轮询。
- 保留最新 64 个有界 completion receipt，供近期检查。
- 每个 Session 最多同时运行 16 个 Shell 与 Monitor。
- Shutdown 时停止所属进程树并记录经过认证的恢复 metadata。

## 文档

- [Background Work 指南](../../../../docs/capabilities/background-work.md)
- [命令参考](../../../../docs/reference/commands.md#工作控制)
- [Tool Display 指南](../../../../docs/capabilities/tool-display.md)
- [Agents 指南](../../../../docs/capabilities/subagents.md)
- [上游参考](UPSTREAM.md)

