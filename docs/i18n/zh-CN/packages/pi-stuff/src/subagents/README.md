<!-- translation-source: packages/pi-stuff/src/subagents/README.md; translation-source-sha256: f5c343b90bfb6e27b00162c9e465ba7ba979bad374680a7eca73decd91ad037b -->

# Agents

[English](../../../../../../../packages/pi-stuff/src/subagents/README.md)

把有界工作委派给命名 child Agent，默认在后台执行，并通过一个界面管理生命周期。

<p align="center">
  <a href="../../../../../../assets/readme/capabilities/subagents.png">
    <img src="../../../../../../assets/readme/capabilities/subagents.png" alt="Pi 中的委派 Agent 对话框" width="100%">
  </a>
  <br>
  <em>Agents 对话框让委派工作保持在当前 Session 范围内。</em>
</p>

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

- 按明确优先级发现固定目录、settings 扫描目录、symlink 目录与 Package 中的 Agent 定义。
- 支持逐 Agent Tool allowlist 与 exclusion，不改变 parent Host。
- 支持单个 Agent、并行 grouped task，以及 status 或生命周期 control call；`agent` 选择 launch definition，
  `id` 标识已有 Agent Target。
- 默认后台运行；前台模式会等待结果。
- 送达紧凑 completion，不主动启动另一轮主 Agent。
- 保留并发与嵌套边界，同时不为生产性工作设置累计 launch、默认运行时间或隐式 Tool timeout。
- 把 attempts 与 resumes 聚合成一个持久 usage 总量；后续自动扩展会在文档规定的成本 guard 处暂停，但不会停止
  正在运行的 child。
- 返回稳定的异常 outcome class、有界 partial 证据，以及支持 continuation 时可恢复的 Agent Target。
- 隔离无 owner 的无版本 legacy run，不让它们永远显示为 active，也不 reclaim 未知进程。
- 保存 Session-owned artifact，并保留已修改的隔离 worktree 供检查。

保留结果遵循验收报告优先规则，不会被后续普通 assistant 文本替换。

## 启动准备

规划阶段校验 Skills、候选模型、Tool 预算与超时，以及 capability/MCP 约束，但不创建执行或恢复记录，也不计算
Agent 定义与任务正文的摘要。最终构建阶段解析启动输入，并一次性生成对应摘要、模型元数据和恢复记录。
规划投影不会跨启动缓存，也不会被当作最终 child contract 复用。

## 文档

- [Agents 指南](../../../../docs/capabilities/subagents.md)
- [命令参考](../../../../docs/reference/commands.md#工作控制)
- [Background Work 指南](../../../../docs/capabilities/background-work.md)
- [Tool Display 指南](../../../../docs/capabilities/tool-display.md)
- [上游参考](UPSTREAM.md)
