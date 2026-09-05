<!-- translation-source: docs/reports/ps-eck-recovery-host-boundary-2026-09-05.md; translation-source-sha256: 979f66b2abb65ca20215999c5a9d2c427325ed535458585c2f337f4b49fa0009 -->

# ps-eck：Magic 恢复与 Host 取消边界

日期：2026-09-05。状态：实现及验收进行中，不代表发布完成。

分支为 `fix/ps-eck-magic-recovery`，基线 `2610bd42`。身份修复已提交为 `e87a1e33`，恢复实现已提交为 `673e6a8b`，最终生命周期修订正在审查。
接受的契约见 [ADR 0031](../adr/0031-preserve-magic-context-behavior-through-suite-integration.md)。

## 根因和实现

固定版本的上游 Pi 适配器错误地把消息数量相同当作位置身份相同的证据。保留的旧压缩摘要与已持久化的失败 Assistant
回复会抵消数量差异，却使身份错位。补丁删除该捷径，每次使用 Magic 现有的引用和唯一指纹解析器。

之前的 Suite 策略又引入独立问题：原生兜底改变压缩责任方，95% 本地估算门槛则在没有实际 Provider 超限证据时拒绝
请求。新适配器坚持 Magic 独占，删除额外 Provider 投影复用缓存，估算仅供显示。小范围固定依赖补丁把既有 Historian
接到 Pi 自定义压缩钩子，返回真实摘要和持久化边界。

真实 Worker 终止测试还暴露了致命错误与压缩路径竞争清理的问题：一次清理会使替代 Worker 的 generation 失效。
现在致命通知只标记引擎不可用，有界关键恢复路径负责自动清理和替换。显式输入与新会话激活也必须先清理旧的已提交
注册，再替换失败的 Worker。回归测试从这两个入口复现旧 Worker 处理器残留，并验证修复后只有替代 Worker 收到
后续会话事件。不包含 Pi 或传输策略补丁。

## Host 证据

最终 Host 检查使用认证的 Pi 0.85.0 Linux x64 发布产物，源码提交
`107d79f11072bbc8a3a757ed7fd69596bee7d68c`，二进制 SHA-256 为
`0cfd1bf3e9468f1052d172502fa388e8e8e53dcdeb9fa97f1ef828fdd7757072`。早期探索使用不同哈希的本地二进制，
不作为认证证据。新增恢复测试在执行前检查来源。

将 `PI_BIN` 指向核验后的可执行文件，运行：

```sh
bun test test/context/magic-recovery-host.test.ts test/context/magic-worker.test.ts test/context-pty.test.ts
```

最终取消清理修订前，认证产物上 21 项测试通过。它们使用隔离的一次性会话与确定性 Provider，执行真实 Magic 压缩
和真实 Worker 终止。注入的超限消息证明控制流程，不证明远端容量上限。

| 场景 | 观察结果 |
| --- | --- |
| 直接运行带补丁 Magic 与完整 Suite | 一次真实钩子压缩，Pi 重试成功，接受输入只持久化一次。 |
| 已完成 Bash 工具 | 仅执行一次、产生一次副作用；重试上下文保留持久化结果。 |
| Historian 瞬时失败 | 现有 Magic 重试成功，无额外前台调度器。 |
| 压缩前 Worker 终止 | 一个替代 Worker，一次 Historian 结果。 |
| 持久化发布后 Worker 回执丢失 | 一个替代 Worker 复用完成状态，不重跑 Historian。 |
| 完成状态不确定或无进展 | 一次说明，不发送重试请求，保留输入。 |
| 第二次 Provider 超限 | 两次请求、一次压缩，不无限重试，保留输入。 |
| 有排队输入时显式取消 | Magic 停止；后续队列交付与仅 Host 对照一致。 |
| 真实 TUI 中 Context 不可用 | 当前输入持久化，显示原因，不发送原始 Provider 请求。 |

仅 Host 的取消对照加载支持信号的压缩夹具，不加载 Magic 或 Pi Stuff。Pi 先等待 `agent.prompt()`，再等待
`_checkCompaction()`，随后决定是否执行 `agent.continue()`。取消后的队列交付是维护者已接受的 Host 原生行为，
不属于本次修复。生产代码不清空、不重交队列。同一串行前台流程不会让投影与自身超限压缩并发；BTW/Agents 投影
不会清除前台恢复额度。

## Provider 证据和审查状态

现有真实 Provider 门槛已在认证可执行文件上通过，覆盖普通 Magic 压力/压缩及会话生命周期。专门的真实超限验收也已
通过：前台使用窗口 128,000 token 的 `openai-codex/gpt-5.3-codex-spark`，真实 Historian 使用
`openai-codex/gpt-5.6-terra`。自动构造 40 对已完成 artifact 消息，每条用户消息含 160 个确定性 SHA-256 校验串，
不发送私人会话内容。

| 真实执行 | 第一次请求 | 重试请求 | 结果 |
| --- | --- | --- | --- |
| 完整 Suite | 480,302 字节，远端超限 | 63,070 字节 | 成功继续，当前输入一次，无工具执行。 |
| 直接运行带补丁 Magic | 463,661 字节，远端超限 | 46,423 字节 | 同样成功继续，保留边界相同。 |

两次运行均持久化一次真实 Pi 钩子压缩，结束于 ordinal 78。载荷大小差异来自 Suite 提示和工具贡献。
同一恢复阶段产生八个持久化 compartment，之后 Pi 仅重试一次。初始 Host 估算为 105,351 token，但远端仍实际拒绝，
证明估算本身不能决定准入。真实 Historian 输出使摘要字节数有所变化。

验收发现并修复两项草稿缺陷：单个 Historian 分块不足以恢复；Historian 内外嵌套持久消息读取器时，内层清理使剩余
历史不可见。恢复现在连续处理可运行分块并核验进展，每次边界读取独立绑定读取器，实际超限使用 Magic 紧急尾部策略。
确定性 Host 的 `multi-step` 回归保护此行为。夹具本身不证明真实容量。

两次早期 Astra 草稿审查和两次后续 Astra 审查已检查实现。取消清理及等待会话初始化时取消均增加了聚焦回归。
正常初始化仍属于 Session；取消等待者不会终止健康 Worker。第一轮后续质量审查未发现结构性缺陷，但最终检查与
连续两轮无发现的完成审查仍待执行。

相关变更保留所属边界：runtime 从 791 行到 796 行，projection 从 346 到 282，Worker client 从 421 到 425，
Statusline rendering 从 507 到 508。原生预检是提取出的仅原生策略，绝不作为启用 Magic 后的兜底。
代码不再变化后必须记录最终行数和审查结果。
