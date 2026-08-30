<!-- translation-source: packages/pi-stuff/src/goal/README.md; translation-source-sha256: eee67cc76b7811f5bb0551e352e79d98af4453bb80b6aaeb8f0761b820cd8c21 -->

# Goal 模块

Goal 能力在当前 Pi 会话中保持一个目标活跃，直到模型用 `goal_complete` 证明完成、用户暂停或清除、显式 Provider 认证/用量限制或可选 token 预算停止工作，或者真实外部阻塞通过严格的三轮 `goal_blocked` 审计。

## 日常使用

```text
/goal implement and verify the requested change
/goal --tokens 100k complete the migration
/goal status
/goal pause
/goal resume
/goal edit finish the smaller compatible migration
/goal clear
```

不带参数的 `/goal` 打开套件全宽命令对话框。它使用 Pi 原生 SettingsList 交互，绝不创建浮动窗口或软件包自有状态栏。当前 Goal 向共享对话 UI 状态栏贡献一个条件片段；没有 Goal 时不显示。活跃状态渲染 ` goal used/budget elapsed`，并在可见时刷新活跃经过时间。暂停、阻塞或因限制停止、完成状态分别保留 Nerd Font ``、`` 和 `` 语义。启动、替换、恢复和更新 TUI 提示使用普通对话记录 `•` 标记并突出操作标签；RPC 和无头提示保持纯文本。Goal 工作只从 Pi 完全稳定的空闲边界继续，因此重试、压缩、引导和排队用户工作会先稳定，再进入下一自动轮次。

每次交互调用都在当前 Pi 会话拥有的 Effect 操作 Scope 中运行。中断只关闭原生 UI 等待；Goal 的代际防护会拒绝过期菜单结果，而继续与终态仍只由 Goal 决定。

实验性多 Goal 模式最多保留 64 个等待目标，使每份持久会话状态有界。

普通使用默认无限自动继续。不可禁用的紧急后备限制只在 10,000 次自动模型响应后暂停，即使面向用户的限制为 Unlimited，也能避免灾难性失控。无进展启发式默认关闭：阶段边界、普通工具失败、压缩和短响应都不能结束 Goal。用户可以在 Goal 设置中选择较低限制。Provider 报告用量和可选 token 预算仍是权威。

Goal 状态追加到 Pi 会话 JSONL，并在重载、恢复和压缩时还原。重载会从新的受保护继续中自动恢复活跃且空闲的 Goal；新会话不继承其他会话的 Goal。显式清除还会在共享设置锁和原子替换下，删除该项目过时的会话前状态。无效旧版 JSON 保持不变并报告，而不是丢弃。Pi 0.84.4 可在 Tool result 之后、下一次 Assistant 请求之前执行原生阈值压缩；Goal 保留该 Host 生命周期，并只在完整 Agent 运行稳定后安排一次 continuation。Magic Context 或其他扩展取消 Pi 原生压缩时，Pi 0.84.4 会发送 `session_compact_failed`。Goal 只针对它在 `session_before_compact` 观察到的匹配压缩接受该原生失败，再恰好一次替换过期继续。成功的 `session_compact` 仍是唯一成功边界。完整目标、完成防护和继续协议通过不渲染的 Pi 自定义消息传递：模型会收到且会话会保留，而 TUI 与 HTML 对话导出仍聚焦用户命令、工具结果和最终响应。

内部的 `goal.ts` 是唯一 Pi 生命周期组合根：每个工厂一个所有者，连接有序会话、输入、消息、工具和 Agent 阶段。带代际防护的状态机位于 `runtime.ts`，纯状态和格式政策位于 `policy.ts`，命令注册与转换位于 `commands.ts`，排队提示词关联位于 `prompt-ownership.ts`，压缩重试协调位于 `compaction.ts`，自动运行协调位于 `run-protocol.ts`，终态工具执行位于 `terminal-tools.ts`，宿主工具可见性所有权位于 `tool-policy.ts`，无状态工具 Schema 与呈现位于 `tool-contract.ts`。把这些阶段拆到多个模块，会复制继续、过期轮次、持久化和安全不变量。

## 终态工具

- `goal_complete({ goal_id, summary, evidence })` 只接受当前受保护 Goal ID、实质性完成摘要和按需求逐项列出的具体证明。
- `goal_blocked({ goal_id, reason, attempt, evidence, repeated_turns })` 只接受真实僵局：同一阻塞条件在连续三个 Goal 轮次中重复，且具有三项不同的具体失败操作。标点或尝试编号不能让同一操作变成不同操作。恢复会开始新的审计。

该模块不提供 Skill。

## 来源

本实现派生自成熟的 `@narumitw/pi-goal` 项目。精确源码提交、吸收快照、许可证和 npm 完整性记录见 [UPSTREAM.md](./UPSTREAM.md)。Pi Stuff 保留状态机，并为共享套件 UI 重写呈现接缝。
