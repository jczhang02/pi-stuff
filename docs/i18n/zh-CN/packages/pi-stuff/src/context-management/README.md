<!-- translation-source: packages/pi-stuff/src/context-management/README.md; translation-source-sha256: c8fbd7f2883bca3ff7bc3088af0b3a6ffe968321ee7672bf3dae0d82b237dcbf -->

# Context Management

[English](../../../../../../../packages/pi-stuff/src/context-management/README.md)

面向 Pi Session 的 Context 投影、检索、memory、note、compaction 与压力处理。

<p align="center">
  <a href="../../../../../../assets/readme/capabilities/context-management.png">
    <img src="../../../../../../assets/readme/capabilities/context-management.png" alt="Pi 中的 Context 状态与维护操作" width="100%">
  </a>
  <br>
  <em>Context 状态和维护操作集中在一个对话框中。</em>
</p>

## 快速开始

```text
/ctx
```

Dialog 显示 Context 用量、compartment、memory、note、pending maintenance、Historian 状态、cache、history
token 和当前错误。

## 亮点

- 在编辑器就绪前激活已识别配置。
- 只有直接交互有权执行首次配置与迁移。
- 通过 `/ctx` 和持久 Context Activity 提供状态与维护。
- 在 Worker 中运行 Context engine，但不接管 Pi 的输入、Agent turn 或 Session 生命周期。
- 投影派生 context，同时保留 Pi Session JSONL 作为原始记录。
- 仅在启动期间或 Engine 不可用导致降级运行时，使用 Pi 原生 context 与 compaction。
- 激活后，Host 管理的 `before_provider_request` 适配器采用故障关闭策略，并要求最终载荷通过 95% 验证。
- 仅当每条有序原始消息的身份、provider/model 和 context window 全部匹配时，才复用已验证的投影。
- Pi 负责重试、继续执行和 compaction；绕过 Host hook 的直接 provider 调用不在支持范围内。

## 文档

- [Context Management 指南](../../../../docs/capabilities/context-management.md)
- [命令参考](../../../../docs/reference/commands.md#context)
- [故障排查](../../../../docs/troubleshooting.md#context)
- [架构](../../../../docs/architecture.md#生命周期所有权)
