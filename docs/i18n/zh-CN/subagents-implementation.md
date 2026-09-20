# 子代理实现与验收

[English](../../subagents-implementation.md) · 以英文版为准.

本文随实现任务 [#97](https://github.com/jczhang02/pi-stuff/issues/97) 交付, 对应 [#64](https://github.com/jczhang02/pi-stuff/issues/64) 已接受的 F01-F33、Q1-Q60/R1-R8 和 UI01-UI15. 实现基线为 `cd0f174f65bdbacdca265646b4e191943063d0ac`. 最终提交、检查与独立审查处置记录在 PR 中. 操作和恢复方法见[使用指南](subagents.md).

`543babafa62c060ee4b728d0eb825a456bd34dfc` 之后重新打开验收: 之前的测试和短流程试跑不足以证明日常使用成熟. 本轮执行完整真实模型流程, 修复其中的问题, 并按要求的尺寸检查最终 UI. 剩余审查和发布环节记录在 PR 中.

## 真实流程与修复

试跑在可丢弃的缓存项目中使用 Pi 编译宿主和 `openai-codex/gpt-6-astra`, 设置和会话独立. 证据来自真实模型工具调用和键盘操作, 不通过脚本填充任务记录.

- **Pi 0.85.1:** 并行调查、隔离实现、依赖审查、两次保留续聊, 以及通过 UI 回答子代理问题. 最终缓存检查通过 4 项测试和 18 个断言.
- **Pi 0.86.0:** 新版宿主的有效会话记录起初无法通过保留上下文校验. 明确解码 system 变更、usage 和压缩后的 system 消息后修复保存. 重启父会话后, 两位原调查员在保留上下文中恢复. 实现代理随后交付固定代码产物, 审查员消费 UI steer, 检查读取一个过期 key 不会清理其他 key. 定向和完整缓存测试各通过 4 项, 20 个断言. 先前失败记录保持不变.
- **Pi 0.86.0 递归工作:** 负责人派出两个只读审查员, 下级分别询问父级策略, 父级再转达给 main. UI Stop 预览整个所属分支, 随后取消三个交办, 均保存为 cancelled. 通过 UI 显式恢复时复用负责人的上下文, 新交办报告 fulfilled 且已保存, 没有恢复或替换旧下级. 重启和 `/reload` 后四条记录仍保留.

试跑的主工作区保持不变, 父会话正常退出, 临时认证文件已删除. 回归修复还阻止恢复操作插入健康队列或早于取消结束启动, 拒绝更改保留代理的工作区模式, 收窄权限时保留生命周期控制工具, 并对工具、压缩及零 token 费用准确计数一次.

UI 优先显示简洁预览, 小窗口中保留详情导航和原生输入, 从历史 attention 通知打开原交办, 长描述旁仍能看到状态. 浏览器模块负责导航状态和边界, action controller 负责操作资格, 渲染几何模块负责视口预算. 完整报告和元数据仍可查看.

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

2026-09-20 本轮重新验收的本地验证:

- `bun run check` 和 `git diff --check`: 通过.
- 添加最后的导航回归前, 完整离线 `bun test tests`: 57 个文件, 271 项通过, 0 失败, 3,312 个断言.
- 编译版 Pi 0.86.0, `bun test tests/system/subagent-*.test.ts tests/system/pi-host.test.ts`: 26 个文件, 88 项通过, 0 失败, 2,113 个断言.
- 最终编译版 Pi 0.85.1 通过独立 UTF-8 tmux 宿主执行交互、导航、历史和默认快捷键套件: 13 项通过, 89 个断言. tmux 状态栏关闭, 保持请求的 Pi 视口尺寸.
- 最终导航修复后, 编译版 Pi 0.86.0 UI/hierarchy 子集在六个文件中通过 24 项测试, 157 个断言; 本地 history/interactions 通过六项, 58 个断言. 原生编辑器回归还覆盖 80x12、80x14、80x16 和 80x24, 包括补全列表和保留草稿.
- 编译版 Pi 0.85.1 重拍了 24 张明暗主题截图, 每个页面保持打开并经过三种规定尺寸. 下方区分受控提供商与真实模型证据.

最终失败均已修复, 未用跳过测试接受失败. 确定性回归复现了复制 Git index 丢失 racy-stat 保护, 以及替换 index 丢失 intent-to-add/skip-worktree 元信息. 最终方案保留 index, 将私有副本设置为保守时间戳. 原生编辑竞态、无匹配搜索和误导性图汇合也有回归覆盖. 两项终端测试直接断言匹配到的 snapshot, 不再额外要求第二次静止采样.

首次远端 CI 发现, Release 可能在公开结果已结束但内部清理未完成时到达, 而配置读取期间发生的保存故障会在派发拒绝信息中丢失原因. Release 现先保留代理, 在 journal/workspace 锁外等待清理, 释放证据前再检查存储状态. 解除保留后也恢复符合条件的排队任务. [可控释放回归](../../../tests/component/subagent-release.test.ts)覆盖这些时序窗口; 实际宿主的派发回归使用 64 项原子批次, 修复前连续三次复现错误原因丢失. 取消测试现明确等待下游任务, 与事件驱动 wait 的语义一致, 结果断言保持不变.

本轮回归覆盖[队列恢复](../../../tests/system/subagent-recovery-queue.test.ts)、[工作区和工具限制](../../../tests/system/subagent-dogfood-regressions.test.ts)、[用量来源](../../../tests/component/subagent-activity.test.ts)、[宿主历史](../../../tests/component/subagent-history.test.ts)、[attention 导航](../../../tests/system/subagent-ui-attention.test.ts)、[内容层级](../../../tests/component/subagent-ui-hierarchy.test.ts)和[原生编辑器视口](../../../tests/system/subagent-ui-viewport.test.ts). 首次全量重跑发现 observer 测试仍按旧菜单顺序选项; 改为选择屏幕上的操作标签后, 保留了权限拒绝和草稿保留断言.

最后的[历史导航回归](../../../tests/system/subagent-ui-history.test.ts)在 80x24 和 80x12 中操作八次保留交办, 描述中也包含形似选中标记的符号. 它验证展开、首尾选择、滚离后定位及打开正确的旧 prompt, 修复前已复现展开后选中历史行不可见. tmux 测试关闭自身状态栏, 使请求尺寸等于 Pi 实际尺寸; 保留该栏时, 12 行试验只给 Pi 11 行, 正确触发了最小尺寸提示.

## 实际终端截图

这些截图来自本轮重新验收. 下表使用受控提供商; 补充的真实模型截图来自前述递归流程.

发布的截图来自实际 Pi 单元格, 使用英文 UI、已配置的 Ghostty 字体栈 (`JetBrainsMono Nerd Font Mono`、`Symbols Nerd Font Mono`、`LXGW WenKai Mono`) 及对应 Catppuccin Latte/Mocha 终端前景与背景色. 受控提供商提供可重复的任务内容. 每个页面在保持打开的情况下, 分别以 Pi 深浅主题调整到 80x24、120x36 和 160x48.

这些是无桌面窗口的终端截图, 不是原生 Ghostty 窗口或合成器证据. 不使用生成的设计图作为执行证据.

| 页面             | 浅色                                                           | 深色                                                              |
| ---------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| 主对话 FleetView | [120x36](../../assets/subagents/light-fleet-120x36.png)        | [80x24](../../assets/subagents/dark-fleet-80x24.png)              |
| 依赖图           | [80x24](../../assets/subagents/light-graph-80x24.png)          | [160x48](../../assets/subagents/dark-graph-160x48.png)            |
| 详情和完整阅读   | [详情, 160x48](../../assets/subagents/light-detail-160x48.png) | [完整结果, 120x36](../../assets/subagents/dark-reader-120x36.png) |

真实模型截图均使用浅色主题: [80x24 已取消下级](../../assets/subagents/live-children-80x24.png)和 [120x36 恢复报告](../../assets/subagents/live-recovery-120x36.png).

![statusline 下方的 FleetView](../../assets/subagents/light-fleet-120x36.png)

![替换编辑区的任务详情](../../assets/subagents/light-detail-160x48.png)

## 审查与恢复边界

下述基线审查覆盖至 `543baba`. 本轮只读 Astra `/root/dogfood_standards_review` 的 Standards 和 Spec 审查覆盖随后完整增量, 包括运行时提交 `1afd16a` 和最终 UI 修复, 所有实质问题均已关闭. 最终独立重跑 hierarchy、history、navigation、interactions 四个文件, 通过 20 项测试和 148 个断言, 另通过 264 种渲染组合及实际 Pi 选中操作探针. 独立视觉审查者 `/root/dogfood_display_probe` 检查全部 26 张新截图, 无阻断发现. PR 固定最终被审查提交.

Standards 和 Spec 已由独立只读 Astra 上下文 `/root/standards_final` 和 `/root/spec_recheck` 完成, 父执行会话为 `codex:01a0a0de-06e7-7980-b872-39d57c4dd7c0`. 审查覆盖基线以来的完整实现差异、强制可维护性标准和修复后的定向复核. 两项结论均无未关闭的实质问题. 最后图形复核分别独立检查了 318 和 180 个布局. PR 记录对应提交范围. Agent 审查不等于 GitHub 审批或合并授权.

工具上限与工作区隔离不是操作系统沙箱. 受支持的子扩展使用明确工厂; 不假定任意第三方全局状态已经隔离. 回退代码不会迁移或删除任务记录. 变更实现版本前, 停止所属会话、保留记录目录, 并遵循[恢复指南](subagents.md#代码持久化和恢复).
