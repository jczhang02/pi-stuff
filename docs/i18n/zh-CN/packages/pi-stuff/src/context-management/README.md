<!-- translation-source: packages/pi-stuff/src/context-management/README.md; translation-source-sha256: 2b8817ab659d1dfe327dc366b02f6d3521e0356e1abe920093408317d520857a -->

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
token、当前错误，以及 Pi 是否会调用自动 Magic 超限恢复。

## 主要能力

- 已配置会话在编辑器就绪前激活，首次配置和迁移仍需直接交互授权。
- 通过 `/ctx` 和持久化 Context Activity 提供状态与维护。
- 引擎在 Worker 中运行，Pi 保留输入、轮次和会话生命周期。
- 等待原生 Worker 的 `close` 事件后才完成资源释放；请求终止不代表终止已经完成。
- Worker 只接收固定引擎需要的工具事件字段，Pi Session JSONL 保留原始记录。
- 启用 Magic 后，投影和压缩始终由 Magic 负责，失败恢复也不使用原生兜底。
- 本地估算仅供显示；偏高或未知估算不阻断有效投影。
- 每次前台 Context 事件均调用 Magic，包括输入未变的重试。
- 通过 Pi 公开压缩钩子返回真实 Magic 摘要，由 Pi 负责重试和队列交付。
- 实际恢复共享十分钟期限、最多重启一次 Worker，核验持久化完成状态，保留输入和已完成工具结果。
  完整 `/ctx recomp` 仍需显式发起。

## 文档

- [Context Management 指南](../../../../docs/capabilities/context-management.md)
- [命令参考](../../../../docs/reference/commands.md#context)
- [故障排查](../../../../docs/troubleshooting.md#context)
- [架构](../../../../docs/architecture.md#生命周期所有权)
