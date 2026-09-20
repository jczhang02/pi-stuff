# Subagent 重新开发决策

[English](../../subagents-redevelopment.md). 以英文版为准.

状态: 2026-09-20 开始决策访谈. 沿用 [#97](https://github.com/jczhang02/pi-stuff/issues/97), 属于 [#64](https://github.com/jczhang02/pi-stuff/issues/64). 本记录取代旧规格, 作为下一版实现的方向. 它尚不是完整规格, 也不授权在访谈共同理解确认前开始实现.

## 已确认方向

1. 围绕 arhen 的 `pi-core-subagent` 重新开发 subagent, 保留上游行为并修复其问题. 先前独立重写的实现不作为新版基线.
2. 既有 research 中的其他 package 和 harness 可以提供功能或实现方式提案. 提案不等于已接受范围, 先前新增能力不会自动继承.
3. 以当前 UI 设计为起点, 根据选定的运行能力完整重谈 UI. 已有页面和快捷键不自动成为最终决定.

保留旧代码、测试、研究、决策和会话记录作为证据. 本决定不授权删除这些内容、迁移存储的会话、变更依赖或豁免仓库工程规则. 旧 F/B/U 清单及通过的测试不能作为新版验收结论.

## 已核实的参考

已检查的上游为 [`@arhen/pi-core-subagent` 1.3.54, commit `de1c8783`](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent). 核对上游变化后, 再记录实际导入的准确版本.

上游只读 agent 直接使用选定的当前目录. 具有写入工具的任务在条件具备时获得 Git worktree. Worktree 从 HEAD 或上游任务分支创建, 通过软链接共享 `node_modules`. 上游对模型暴露多个工具. 这些是源码事实, 不是新增设计决定. 见 [manager.ts](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/manager.ts) 和 [worktree.ts](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/worktree.ts).

旧实现则在默认只读工作前捕获基线. 它在真实开发目录中展开全部 ignored 文件的状态, 输出 1,749,620 bytes, 超过自身 1 MiB 的 Git 输出上限. 其中 1,748,388 bytes 来自 28,085 条 `node_modules` 记录. 通过实际 Git 封装连续两次复现报错, 失败发生在模型执行前. 这个缺陷来自旧实现, 上游没有该扫描. 此前小项目验收未覆盖这个条件.

## 决策树

第一轮确定重新开发的边界:

- 除了行为一致, 源码结构应多大程度保留上游.
- 回到上游多个工具后, 是否仍保留先前的单工具偏好.
- 如何区分可证实的缺陷修复与有意改变上游行为.
- 新实现是否需要继续运行旧实现创建的会话.

这些答案决定后续工程适配、具体修复和可选新增能力. 运行范围确定后, 按派发、进度、查看、通信、取消和恢复的真实场景重谈 UI. 验收随后必须覆盖已安装依赖的真实项目和受控夹具.

问题和推荐在回答前均为提案. 访谈中逐项记录已接受答案. 术语明确后才添加词汇表条目; 只有重要取舍需要长期解释时才写 ADR. 不把实现笔记写入词汇表.

## 当前阶段

本轮仅核对源码、research 并访谈决策. 保留既有负责人、实现分支及其他工作树. [PR #98](https://github.com/jczhang02/pi-stuff/pull/98) 代表旧实现, 不作为新版验收候选. 本轮访谈不授权新增运行代码、UI 原型、合并或发布.
