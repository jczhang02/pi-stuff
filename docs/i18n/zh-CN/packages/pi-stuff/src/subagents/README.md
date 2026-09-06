<!-- translation-source: packages/pi-stuff/src/subagents/README.md; translation-source-sha256: 579b03204b56fe5f0206444244990b10e7d870fde39b41a90a4940ca404ae733 -->

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

child Host 不加载根 Agents 管理实现，因为该实现在这些进程中不注册任何内容。parent 在 Suite 安装阶段加载它；
获准的嵌套委派仍由现有 child Extension 负责。

规划阶段校验 Skills、候选模型、Tool 预算与超时，以及 capability/MCP 约束，但不创建执行或恢复记录，也不计算
Agent 定义与任务正文的摘要。最终构建阶段解析启动输入，并一次性生成对应摘要、模型元数据和恢复记录。
规划投影不会跨启动缓存，也不会被当作最终 child contract 复用。

如果本次调用和 Agent 配置都未选择 Skill，启动准备不会加载文件系统 Skill 解析器。
选中 Skill 仍在预检和最终构建时分别解析，保留文件变化检查，并在创建 fork 之前报告缺失 Skill。
继承环境中的 Skill 时仍保留 Read。

发现 Skill 路径时不读取候选 Skill 的正文。选中文件只在元数据缓存未命中时读取一次；有界缓存仅保留名称、
路径、来源和描述，不保留未使用的正文。选中文件的修改检查、发现优先级、回退路径和提供给模型的 Skill
提示词保持不变。

新启动与已有目标的控制操作分开加载。启动时首次加载所选执行引擎；前台执行不加载 detached runner 的启动实现。
隔离 worktree 的操作仅在请求该功能时加载。Session 重试快照的操作仅在任务继承了 Session 文件且至少有两个候选
模型时加载。必要的恢复记录、writer 所有权与初始状态仍在 child 执行之前提交；重试快照仍在首次模型尝试之前冻结
Session。

当前 Session governor 事务使用异步的稳定 inode 内核锁。获取锁时不再重写诊断用 owner 记录，也不强制刷盘；
互斥与进程退出后的释放仍由内核保证。规范账本的提交方式与旧版本锁的处理保持不变。

只有当前进程具备已连接的 IPC 发送通道时，状态发布才创建队列、fiber 和定时唤醒。没有该通道的 Host
仍持久化状态并通知进程内观察者；已连接的后台 runner 保持原有进度发送频率和终态立即送达行为。

artifact 原子写入器只在写入或改名失败后删除临时文件。同目录改名成功后，临时路径已不存在；
同步与异步发布均保留原子可见性、私有权限、重试策略及原始错误优先规则。

提取最终输出时，普通 Assistant 内容只扫描一次，仅保留最后一段合格文本的引用。只有消息包含验收报告时，
才拼接该消息的完整文本；验收报告的优先级以及有界结果、错误证据保持不变。

## 文档

- [Agents 指南](../../../../docs/capabilities/subagents.md)
- [命令参考](../../../../docs/reference/commands.md#工作控制)
- [Background Work 指南](../../../../docs/capabilities/background-work.md)
- [Tool Display 指南](../../../../docs/capabilities/tool-display.md)
- [上游参考](UPSTREAM.md)
