<!-- translation-source: docs/adr/0031-preserve-magic-context-behavior-through-suite-integration.md; translation-source-sha256: c0fd51729d2c75b98a60f0003b9220a28d07355c16cfc717fd55f75b10a40281 -->

---
status: proposed
---

# 在 Suite 集成中保持 Magic Context 行为一致

本提案记录 Context 重试调查之后重新开始的设计讨论。下列原则已经确认；恢复设计仍未完成，也尚未授权据此实施。
不继承更早讨论中的固定期限、重试次数或自定义压缩实现选择。

## 已确认原则

启用 Magic 时，全部上下文压缩由它负责。Magic 失败时，Pi Stuff 不得改用原始 Session 历史或 Pi 原生摘要。
Pi 仍是 Host，负责前台执行和 Session 持久化。可恢复故障应自动继续，不重复用户输入，不重跑已完成的工具；
无法恢复时必须保留 Session 和当前输入，说明原因并停止，不无限重试。

Suite 集成必须在 Worker 通信中保持消息身份、压缩语义、取消和 Session 归属一致。直接运行 Magic 是比较基线，
不意味着必须复现已知 Magic 缺陷。必要的 Suite 特有差异必须明确记录并验证。本提案不合并适配层，也不改变
WebSocket/SSE 选择。

## 已确认取舍

- 内部优化影响正确性时可以删除。已有用户功能默认保留，除非另行确认具体删除项及其影响。简化不是删除 BTW、
  Agents 或其他 Suite 行为的概括授权。
- 自动恢复限于 Magic 普通压缩、紧急压缩和可以安全重试的暂时故障。等同于 `/ctx recomp` 的完整历史重建
  保持显式操作，因为其成本和范围超过普通恢复。恢复机制和重试限制仍需可行性验证与设计。
- 可能影响消息、压缩结果、取消或工作现场保留的未解释差异，阻止整项修复完成。独立验证的局部修复可以单独
  提交，但不能证明整个集成已可靠。差分验收必须区分有意保留的 Suite 行为与非预期差异。

## 待决事项

讨论仍需确定可恢复的 Worker 故障、完成状态不明确的压缩中断、进展和耗尽规则、取消与排队输入行为，以及恢复
过程的显示。接受实现之前，必须根据 Pi 和 Magic 的实际能力核验这些决策。

本提案拟替换 [ADR 0026](0026-bound-context-managed-provider-requests.md) 中不兼容的兜底和仅凭估计拦截策略。
在设计被接受并实现之前，当前行为仍单独记录；本草案不表示 Magic 独占恢复已经交付。
