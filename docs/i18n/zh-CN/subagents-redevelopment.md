# Subagent 重新开发决策

[English](../../subagents-redevelopment.md). 以英文版为准.

状态: 2026-09-20 开始决策访谈. 沿用 [#97](https://github.com/jczhang02/pi-stuff/issues/97), 属于 [#64](https://github.com/jczhang02/pi-stuff/issues/64). 本记录取代旧规格, 作为下一版实现的方向. 它尚不是完整规格, 也不授权在访谈共同理解确认前开始实现.

## 已确认方向

1. 围绕 arhen 的 `pi-core-subagent` 重新开发 subagent, 以上游行为为基线, 逐项记录已批准的差异. 源码必须改写至完全符合仓库工程规范, 包括 Effect. 先前独立重写的实现不作为新版基线.
2. 既有 research 中的其他 package 和 harness 可以提供功能或实现方式提案. 提案不等于已接受范围, 先前新增能力不会自动继承.
3. 以当前 UI 设计为起点, 根据选定的运行能力完整重谈 UI. 已有页面和快捷键不自动成为最终决定.

保留旧代码、测试、研究、决策和会话记录作为证据. 本决定不授权删除这些内容、迁移存储的会话、变更依赖或豁免仓库工程规则. 旧 F/B/U 清单及通过的测试不能作为新版验收结论.

## 已核实的参考

先前研究的参考为 [`@arhen/pi-core-subagent` 1.3.54, commit `de1c8783`](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent). 本次还核对了 [1.3.55, commit `676b11eb`](https://github.com/arhen/pi-extensions/tree/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent): 该包的增量记录 provider/thinking 信息并在任务名旁显示, 没有替换下述执行或工作区模型. 这些是已检查的参考, 实施前再记录实际导入的准确版本.

上游只读 agent 直接使用选定的当前目录. 具有写入工具的任务在条件具备时获得 Git worktree. Worktree 从 HEAD 或上游任务分支创建, 通过软链接共享 `node_modules`. 上游对模型暴露多个工具. 这些是源码事实, 不是新增设计决定. 见 [manager.ts](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/manager.ts) 和 [worktree.ts](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/worktree.ts).

因此, 写任务的 worktree 不会自动包含父目录未提交的修改; 直接使用该目录的只读任务可以看到这些修改. 共享 `node_modules` 软链接也意味着依赖写入不受 worktree 隔离. 这些限制属于上游基线, 不能据此宣称具备快照或沙箱保证. 其依赖调度器会等待当前可执行批次的全部任务结束, 才调度下一批. 见已核对的 [worktree 实现](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/worktree.ts#L70-L98)和[分批调度器](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/graph.ts#L91-L115).

旧实现则在默认只读工作前捕获基线. 它在真实开发目录中展开全部 ignored 文件的状态, 输出 1,749,620 bytes, 超过自身 1 MiB 的 Git 输出上限. 其中 1,748,388 bytes 来自 28,085 条 `node_modules` 记录. 通过实际 Git 封装连续两次复现报错, 失败发生在模型执行前. 这个缺陷来自旧实现, 上游没有该扫描. 此前小项目验收未覆盖这个条件.

## 决策树

第一轮已确定重新开发的边界:

- 除了行为一致, 源码结构应多大程度保留上游.
- 回到上游多个工具后, 是否仍保留先前的单工具偏好.
- 如何区分可证实的缺陷修复与有意改变上游行为.
- 新实现是否需要继续运行旧实现创建的会话.

下方已接受答案约束工程适配、具体修复和可选新增能力. 内部改写不授权增加生命周期状态、能力或持久化保证. 运行范围确定后, 按派发、进度、查看、通信、取消和恢复的真实场景重谈 UI. 验收随后必须覆盖已安装依赖的真实项目和受控夹具.

问题和推荐在回答前均为提案. 访谈中逐项记录已接受答案. 术语明确后才添加词汇表条目; 只有重要取舍需要长期解释时才写 ADR. 不把实现笔记写入词汇表.

## 第一轮决定, 2026-09-20 已确认

**RQ01. 按全部仓库工程规则改写.** 维护者拒绝保留上游代码的规则例外. 整套实现须满足严格 TypeScript、代码质量规则和 [ADR 0002](adr/0002-effect-quality.md), 包括边界、类型化错误和必要 I/O 使用 Effect; 纯算法仍按该 ADR 使用普通函数. 可按需重构上游源码, 行为以上游为基线, 仅纳入明确接受的差异. 不削弱检查或添加整块排除. 见 [ADR 0005](adr/0005-subagent-redevelopment.md).

**RQ02. 对模型提供单一 `subagent` 工具.** 维护者选择单工具, 没有采纳保留上游父代理工具集合的推荐. 工具操作须覆盖选定的上游能力; 合并入口不扩大权限, 也不恢复旧实现的额外能力. 准确参数根据确定的行为设计, 不整套继承旧协议.

**RQ03. Worktree 初始化失败则停止启动.** 维护者接受此行为修复: 明确报错, 不自动让可写任务退回原目录运行. 写原目录前须有明确决定. 这不授权新增工作区模式体系. 实施修复前先复现上游失败路径.

**RQ04. 无需兼容旧实现记录.** 新版不需要迁移或续跑旧实现创建的会话. 保留旧代码和记录, 存储分开, 不将不兼容记录解释为新任务. 维护者未授权删除旧数据.

## 第二轮提案, 等待回答

**RQ05. 是否允许已完成任务再次接收交办?** 上游可恢复有会话记录的失败或中止任务, 但明确拒绝已完成任务. 例如 reviewer 交付审查报告后, 主代理修复代码, 再让同一个 reviewer 带着先前上下文复查. 推荐增加此能力, 复用已有 Pi 会话机制. 这是有意增加生命周期能力, 不是缺陷修复. 如接受, 实施前再确定结果记录和工作区行为; 接受此能力不会自动恢复旧 assignment 体系或重跑依赖任务. 来源: [resumeTask](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L1333-L1365).

**RQ06. 本次重开发是否允许子代理使用扩展工具?** 例如 researcher 直接调用已安装的网页搜索扩展. 上游关闭扩展加载; gotgenes 提供了子代理自行加载资源、过滤工具的参考. 推荐首版暂缓, 保留上游工具边界, 由父代理提供研究结果. 支持扩展需要确定初始化、清理和工具权限, 并非只增加一个工具名. 来源: [arhen 子代理资源加载](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L853-L877)和 [gotgenes 子会话创建](https://github.com/gotgenes/pi-packages/blob/bebfa283fc6a0b8867399b4fcc9dc5997817e9ca/packages/pi-subagents/src/lifecycle/create-subagent-session.ts).

## 当前阶段

本轮仅核对源码、research 并访谈决策. 保留既有负责人、实现分支及其他工作树. [PR #98](https://github.com/jczhang02/pi-stuff/pull/98) 代表旧实现, 不作为新版验收候选. 本轮访谈不授权新增运行代码、UI 原型、合并或发布.
