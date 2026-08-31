<!-- translation-source: packages/pi-stuff/src/subagents/README.md; translation-source-sha256: 5467d5359e8bf569c618912ae89d62b3fad61d54f2f5bed87ee9b7e66c002cc3 -->

# Agents

[English](../../../../../../../packages/pi-stuff/src/subagents/README.md)

把有界工作委派给命名 child Agent，默认在后台执行，并通过一个界面管理生命周期。

## 快速开始

使用 `subagent` Tool：

```json
{
  "agent": "general-purpose",
  "description": "Inspect parser",
  "task": "Find the parser boundary and report exact source evidence."
}
```

启动后继续独立工作。打开 `/agents` 检查、steer、stop、resume 或查看保留结果。

## 亮点

- 按明确优先级发现项目、用户与 Package Agent 定义。
- 支持单个 Agent、并行 grouped task，以及 status 或生命周期 control call。
- 默认后台运行；前台模式会等待结果。
- 送达紧凑 completion，不主动启动另一轮主 Agent。
- 应用并发、总 launch、嵌套、turn、Tool 和时间限制。
- 保存 Session-owned artifact，并保留已修改的隔离 worktree 供检查。

## 文档

- [Agents 指南](../../../../docs/capabilities/subagents.md)
- [命令参考](../../../../docs/reference/commands.md#工作控制)
- [Background Work 指南](../../../../docs/capabilities/background-work.md)
- [Tool Display 指南](../../../../docs/capabilities/tool-display.md)
- [上游参考](UPSTREAM.md)

