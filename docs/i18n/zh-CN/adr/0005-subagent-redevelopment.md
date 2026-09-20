# 改写 subagent 内部实现, 以上游行为为基线

[English](../../../adr/0005-subagent-redevelopment.md). 以英文版为准.

旧独立实现增加了 arhen `pi-core-subagent` 之外的工作区和生命周期机制; 默认快照扫描随后使安装依赖的真实项目连只读任务也无法启动. 维护者决定从上游行为重新开始, 同时将源码改写至符合全部仓库规范, 包括 [Effect v4](0002-effect-quality.md), 不给上游代码工程规则豁免. 内部改写不能悄悄扩展产品范围: 当前已批准的差异包括单一 `subagent` 工具、worktree 初始化失败不自动退回原目录写入, 以及无需兼容旧实现记录; 后续新增内容须在[重新开发记录](../subagents-redevelopment.md)中明确决定.
