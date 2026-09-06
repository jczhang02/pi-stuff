<!-- translation-source: docs/research/pi-stuff-reliability-fork-audit-20260906.md; translation-source-sha256: 3a3f9e6cd631b48f9c4bb011c52ad152606c798ed50bf8ab38350afb9eb150f7 -->

# Pi Stuff 可靠性 fork 适配审计

日期：2026-09-06。范围：ps-8ew.1；Context/Goal 压缩与继续、Code Mode 嵌套 Tool Display、Conversation UI Host 适配器。

本报告是有界的源代码与历史审计，不认证实时 Provider 或合并修复候选。复用 ps-qbn 记录的完整 Agents 诊断及其后续项 ps-81j、ps-sfx、ps-q2k、ps-gaz、ps-tgj。当前候选已完全移除 Agents continuation-context.ts 及估算门禁/投影器，将子任务压力处理归还 Context Management/Magic。认证 Pi 0.85.1 的生产 child pressure 测试命令通过 14 个测试、116 个 assertions，耗时 73.21 秒，覆盖两次真实超限恢复、signed reasoning、findings、completed-check ID、steering 和最终报告；它是确定性 Provider 控制流证据，不是实时远端容量认证。另一次 live manual Magic compaction/recovery 在 public RPC 后恢复了先前 finding/check markers（tokensBefore=79939、estimatedAfter=22002、lastCompactedOrdinal=19）；这是 synthetic/manual evidence，不是 remote live overflow、realistic code-check identity 或组合验收。后台 teardown 已由独立 live run 覆盖。

## 结论

| 边界与所有者 | 行为、差异与证据 | 处置 |
| --- | --- | --- |
| Context Management；Context 拥有投影，Magic 拥有压缩，Pi 拥有持久化/重试 | Magic Context 0.41.1 在 Worker 中运行；本地补丁提供 tokenizer、图像哈希、摘要身份和溢出完成。core-provider-boundary、core-compaction、magic-recovery-host 测试覆盖估算、取消、重启、陈旧结果、无 fallback 和 Worker 故障。 | 保留 Magic-only 边界及已审计补丁；ps-qbn 修复 Agents 证据连续性。 |
| Goal；Goal 拥有继续和终止策略 | 上游 pi-extensions v0.48.0 提供状态机、队列/RPC、持久化和测试；本地提交适配共享 Dialog、终止证据、压缩后恢复，并关闭普通自动限制而保留紧急后备。Goal terminal tests 和 UI attribution tests 覆盖身份、证据、阻塞审计、陈旧替换和继续等待。 | 保留本地策略；未发现新的有界缺陷，组合竞态交由 ps-8ew.2/ps-8ew.3。 |
| Code Mode/Tool Display；Code Mode 拥有嵌套执行，Tool Display 拥有展示 | Code Mode 复用上游源并重新进入 Pi 公共 Tool 生命周期；Tool Display 使用原生 Pi 0.85.1 Tool 定义、结果优先摘要和有界展示。ledger 测试覆盖回放、审批、精确大结果、持久化失败、陈旧结算、回滚和无执行配额。使用现有缓存的认证 `rust-v0.145.0` Host，设置 `PI_STUFF_CODE_MODE_REAL=1` 后 V8 测试通过 11 个测试、0 失败、41 个 assertions（855ms；binary SHA-256 `60bf16414be5333f09ff082540082304c7352931ef64bdeb170d4c35a82e6ef8`）。未设置该标志时默认门禁仍跳过。 | 保留边界；网络服务行为不在该证据范围；Tool 计划问题链接 ps-tgj。 |
| Conversation UI；UI 拥有投影，私有 Host 方法只经过版本检查适配器 | 吸收 unicode/chart 算法，复用原生消息插入/回放、状态和 Thinking；移除竞争 transformer/UI 注册，shutdown 时恢复原生方法并隔离投影错误。user-message、conversation-markdown、statusline 测试覆盖这些行为。 | 保留版本绑定适配器；未发现新的有界回归，真实 TUI 仍是发布门槛。 |

## 被移除的保护

513f74b6 删除了 work-continuity.ts 及 completed-verification retention assertion，却保留 continuation-context.ts 的紧急历史删除。这是真实的保护缺失，由 ps-qbn 负责；静态检查和小 payload 不能证明其正确。ps-qbn 回放显示 41/100/801 条消息会压缩为四条；去除签名字段的反事实不能授权删除 Provider 必需签名。发布的 pi-subagents 0.65.1 提交 [83be9c3](https://github.com/nicobailon/pi-subagents/tree/83be9c3de2cde1553c0269f383efc1eb1194dc8b) 没有本地 emergencyProjection 策略，因此不能作为历史删除的依据。

## 验证限制

列出的 Context、Goal、ledger、fork/context 和 UI 定向测试通过；最新有界命令为 78 通过、375 个 expectations；认证 V8 Code Mode 另有 11 个测试、41 个 assertions 通过。未执行实时 Provider overflow、完整 Host 验收、资源测量或合并候选认证。最终验收留给 ps-8ew.2，并等待确定集成候选和认证 Host。
