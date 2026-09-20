# 子代理实现与验收

[English](../../subagents-implementation.md) · 以英文版为准.

本文随实现任务 [#97](https://github.com/jczhang02/pi-stuff/issues/97) 交付, 对应 [#64](https://github.com/jczhang02/pi-stuff/issues/64) 已接受的 F01-F33、Q1-Q60/R1-R8 和 UI01-UI15. 实现基线为 `cd0f174f65bdbacdca265646b4e191943063d0ac`. 最终提交、检查与独立审查处置记录在 PR 中. 操作和恢复方法见[使用指南](subagents.md).

## 审查导读

| 边界         | 负责模块及职责                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 宿主接入     | [register.ts](../../../src/subagent/register.ts) 暴露一个工具、人工检查入口、通知和离开会话前的停止保存屏障.                                                                               |
| 接收与权限   | [admission.ts](../../../src/subagent/admission.ts)、[configuration.ts](../../../src/subagent/configuration.ts) 和 [authority.ts](../../../src/subagent/authority.ts) 在启动前验证整次派发. |
| 任务生命周期 | [coordinator.ts](../../../src/subagent/coordinator.ts) 协调调度; runtime、journal、mailbox、controls、recovery 和 view 模块分别维护对应规则.                                               |
| 子执行       | [session.ts](../../../src/subagent/session.ts) 创建真实 Pi 会话; [processes.ts](../../../src/subagent/processes.ts) 跟踪 shell 执行并确认停止.                                             |
| 代码与记录   | [workspace.ts](../../../src/subagent/workspace.ts) 管理隔离工作区和固定产物; [store.ts](../../../src/subagent/store.ts) 管理本地执行者证据与持久记录.                                      |
| 检查界面     | [ui/controller.ts](../../../src/subagent/ui/controller.ts) 将宿主输入接到导航、操作和阅读. 预览与完整阅读共用内容投影; 图几何模块负责依赖布局.                                             |

执行结束、履约声明、证据保存和主代理验收保留为独立字段. 取消沿任务归属传播, 依赖箭头表示结果流. 保留代理的下一次交办创建新记录, 不改写旧消费者.

## 行为证据索引

这些回归在真实边界执行. System 测试在实际 Pi 中加载未改写的入口, 本地模型服务仅控制时间和失败. Component 用例针对文件、Git、进程或编辑边界, 以便精确验证相应行为.

| 要求                                                             | 回归来源                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01-F04, F06-F09: 单次、并行、串行、DAG、后台执行与有界观察      | [host](../../../tests/system/subagent-host.test.ts), [scheduling](../../../tests/system/subagent-scheduling.test.ts), [navigation](../../../tests/system/subagent-ui-navigation.test.ts)                                                                                                                                    |
| F05: 固定上游结果与完整保留输出                                  | [artifacts](../../../tests/system/subagent-artifacts.test.ts), [UI reader](../../../tests/system/subagent-ui.test.ts)                                                                                                                                                                                                       |
| F10-F12: 取消、异常续聊与 steer                                  | [control](../../../tests/system/subagent-control.test.ts), [recovery](../../../tests/system/subagent-recovery.test.ts), [authority](../../../tests/system/subagent-authority.test.ts), [processes](../../../tests/component/subagent-processes.test.ts)                                                                     |
| F13-F15: 提问、报告和信箱投递                                    | [communication](../../../tests/system/subagent-communication.test.ts), [control](../../../tests/system/subagent-control.test.ts), [host](../../../tests/system/subagent-host.test.ts), [UI communication](../../../tests/system/subagent-ui-interactions.test.ts)                                                           |
| F16-F21: 内联/文件角色、模型/思考强度、工具上限、cwd、规则和技能 | [configuration](../../../tests/system/subagent-configuration.test.ts), [context](../../../tests/system/subagent-context.test.ts), [authority](../../../tests/system/subagent-authority.test.ts), [artifacts](../../../tests/system/subagent-artifacts.test.ts)                                                              |
| F22-F25: 共享限额、执行时间、重试与用量                          | [scheduling](../../../tests/system/subagent-scheduling.test.ts), [control](../../../tests/system/subagent-control.test.ts), [usage](../../../tests/system/subagent-usage.test.ts), [host](../../../tests/system/subagent-host.test.ts)                                                                                      |
| F26-F27: 工作树、基线与产物交接                                  | [workspace](../../../tests/component/subagent-workspace.test.ts), [artifacts](../../../tests/system/subagent-artifacts.test.ts)                                                                                                                                                                                             |
| F28-F29: 持久化、恢复与生命周期观察者                            | [store](../../../tests/component/subagent-store.test.ts), [persistence](../../../tests/system/subagent-persistence.test.ts), [observer](../../../tests/system/subagent-observer.test.ts), [recovery](../../../tests/system/subagent-recovery.test.ts)                                                                       |
| F30-F33: 完成后续聊、历史复制、递归等待与子扩展工具              | [context](../../../tests/system/subagent-context.test.ts), [history](../../../tests/component/subagent-history.test.ts), [join](../../../tests/system/subagent-join.test.ts), [extensions](../../../tests/system/subagent-extensions.test.ts), [host](../../../tests/system/subagent-host.test.ts)                          |
| B01-B03: 原子接收、等待槽位与暂停队列                            | [host](../../../tests/system/subagent-host.test.ts), [scheduling](../../../tests/system/subagent-scheduling.test.ts), [control](../../../tests/system/subagent-control.test.ts), [persistence](../../../tests/system/subagent-persistence.test.ts)                                                                          |
| B04-B06: 停止时序、不同超时与消息顺序                            | [processes](../../../tests/component/subagent-processes.test.ts), [authority](../../../tests/system/subagent-authority.test.ts), [control](../../../tests/system/subagent-control.test.ts), [communication](../../../tests/system/subagent-communication.test.ts)                                                           |
| B07-B09: 固定基线、保存和异常恢复                                | [workspace](../../../tests/component/subagent-workspace.test.ts), [artifacts](../../../tests/system/subagent-artifacts.test.ts), [context](../../../tests/system/subagent-context.test.ts), [recovery](../../../tests/system/subagent-recovery.test.ts), [observer](../../../tests/system/subagent-observer.test.ts)        |
| B10-B12: 权限、子结果消费与持久结算                              | [authority](../../../tests/system/subagent-authority.test.ts), [join](../../../tests/system/subagent-join.test.ts), [persistence](../../../tests/system/subagent-persistence.test.ts), [usage](../../../tests/system/subagent-usage.test.ts)                                                                                |
| U01-U03: 键盘操作、原生编辑与二十代理对齐                        | [UI](../../../tests/system/subagent-ui.test.ts), [interactions](../../../tests/system/subagent-ui-interactions.test.ts), [geometry](../../../tests/system/subagent-ui-geometry.test.ts)                                                                                                                                     |
| U04-U07: 真实图、保留内容阅读、通信与动态 Stop 范围              | [graph](../../../tests/system/subagent-graph.test.ts), [navigation](../../../tests/system/subagent-ui-navigation.test.ts), [UI](../../../tests/system/subagent-ui.test.ts), [interactions](../../../tests/system/subagent-ui-interactions.test.ts), [delayed actions](../../../tests/component/subagent-ui-actions.test.ts) |
| U08-U10: 用量、失败、实际宿主返回和外观                          | [usage](../../../tests/system/subagent-usage.test.ts), [persistence](../../../tests/system/subagent-persistence.test.ts), [context](../../../tests/system/subagent-context.test.ts), [host exit](../../../tests/system/subagent-ui-acceptance.test.ts), 下方截图                                                            |

## 环境与执行

固定版本为 Bun 1.4.0、Pi 0.85.1、Effect 4.0.0-rc.112 和 Terminal Control 1.2.1. 编译宿主环境通过 `PI_TEST_HOST` 执行同一实际 Pi 入口; 缺少宿主会失败. 测试隔离设置、会话和项目数据. 终端交互由 Terminal Control 驱动; tmux 试验使用独立 UTF-8 服务中的 tmux 3.6a.

```sh
bun run check
bun test tests
PI_TEST_HOST=/absolute/path/to/pi-0.85.1 bun test tests/system/subagent-*.test.ts
```

2026-09-20 最终本地验证:

- `bun run check` 和 `git diff --check`: 通过.
- `bun test tests`: 49 个文件, 240 项通过, 0 失败, 3,115 个断言.
- 编译版 Pi 0.85.1, `bun test tests/system/subagent-*.test.ts tests/system/pi-host.test.ts`: 21 个文件, 73 项通过, 0 失败, 1,999 个断言. 修正定向等待测试后, 编译宿主的控制套件再次通过 4 项测试和 26 个断言.
- 独立 UTF-8 tmux 宿主中的交互和导航套件: 7 项通过, 35 个断言. 此前的几何布局和返回宿主试验也已通过.
- 24 张明暗主题、各页面和窗口缩放截图检查均通过, 下方保留六张代表截图.

最终失败均已修复, 未用跳过测试接受失败. 确定性回归复现了复制 Git index 丢失 racy-stat 保护, 以及替换 index 丢失 intent-to-add/skip-worktree 元信息. 最终方案保留 index, 将私有副本设置为保守时间戳. 原生编辑竞态、无匹配搜索和误导性图汇合也有回归覆盖. 两项终端测试直接断言匹配到的 snapshot, 不再额外要求第二次静止采样.

首次远端 CI 发现, Release 可能在公开结果已结束但内部清理未完成时到达, 而配置读取期间发生的保存故障会在派发拒绝信息中丢失原因. Release 现先保留代理, 在 journal/workspace 锁外等待清理, 释放证据前再检查存储状态. 解除保留后也恢复符合条件的排队任务. [可控释放回归](../../../tests/component/subagent-release.test.ts)覆盖这些时序窗口; 实际宿主的派发回归使用 64 项原子批次, 修复前连续三次复现错误原因丢失. 取消测试现明确等待下游任务, 与事件驱动 wait 的语义一致, 结果断言保持不变.

另一次真实 `openai-codex/gpt-6-astra` 试跑使用可丢弃的大小写敏感路径缓存项目. 两个调查并行执行, 审查员消费两份固定结果, 原实现代理再完成一次续聊. 四次记录均为 fulfilled 且已保存, 输出用量分别为 198、217、217、363 tokens. 检查页返回 main 后, 父会话正常退出. 这验证了该提供商和工作流, 不代表所有可用模型或扩展.

## 实际终端截图

发布的截图来自实际 Pi 单元格, 使用英文 UI、已配置的 Ghostty 字体栈 (`JetBrainsMono Nerd Font Mono`、`Symbols Nerd Font Mono`、`LXGW WenKai Mono`) 及对应 Catppuccin Latte/Mocha 终端前景与背景色. 受控提供商提供可重复的任务内容. 每个页面在保持打开的情况下, 分别以 Pi 深浅主题调整到 80x24、120x36 和 160x48.

这些是无桌面窗口的终端截图, 不是原生 Ghostty 窗口或合成器证据. 不使用生成的设计图作为执行证据.

| 页面             | 浅色                                                           | 深色                                                              |
| ---------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| 主对话 FleetView | [120x36](../../assets/subagents/light-fleet-120x36.png)        | [80x24](../../assets/subagents/dark-fleet-80x24.png)              |
| 依赖图           | [80x24](../../assets/subagents/light-graph-80x24.png)          | [160x48](../../assets/subagents/dark-graph-160x48.png)            |
| 详情和完整阅读   | [详情, 160x48](../../assets/subagents/light-detail-160x48.png) | [完整结果, 120x36](../../assets/subagents/dark-reader-120x36.png) |

![statusline 下方的 FleetView](../../assets/subagents/light-fleet-120x36.png)

![替换编辑区的任务详情](../../assets/subagents/light-detail-160x48.png)

## 审查与恢复边界

Standards 和 Spec 已由独立只读 Astra 上下文 `/root/standards_final` 和 `/root/spec_recheck` 完成, 父执行会话为 `codex:01a0a0de-06e7-7980-b872-39d57c4dd7c0`. 审查覆盖基线以来的完整实现差异、强制可维护性标准和修复后的定向复核. 两项结论均无未关闭的实质问题. 最后图形复核分别独立检查了 318 和 180 个布局. PR 记录对应提交范围. Agent 审查不等于 GitHub 审批或合并授权.

工具上限与工作区隔离不是操作系统沙箱. 受支持的子扩展使用明确工厂; 不假定任意第三方全局状态已经隔离. 回退代码不会迁移或删除任务记录. 变更实现版本前, 停止所属会话、保留记录目录, 并遵循[恢复指南](subagents.md#代码持久化和恢复).
