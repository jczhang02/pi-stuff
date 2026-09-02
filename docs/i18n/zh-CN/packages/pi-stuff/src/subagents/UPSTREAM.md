<!-- translation-source: packages/pi-stuff/src/subagents/UPSTREAM.md; translation-source-sha256: 6381b035fab9523cd29e7dbb4a3760a2b3a82ea7582a7db9e51e93e3985bea10 -->

# 上游来源

本模块最初来自 Nico Bailon 的固定 `pi-subagents` `0.38.0` 快照。已发布归档在隔离的基线提交中原样导入。

- 上游仓库：<https://github.com/nicobailon/pi-subagents>
- 初始源码标签：`v0.38.0`
- 初始源码提交：`89de10e4bc8895e7948704c38620a5b35ddcd17e`
- 初始 npm 软件包：`pi-subagents@0.38.0`
- 初始 npm SHA-1：`d7c3ce31cf71c0b96d02f2d48c1a715c07868dd1`
- 初始 npm SHA-256：`b44d87afc519f96c627fe56320c7c405e7b48cd22791c7526759b6c10a061b4f`
- 初始 npm 完整性：
  `sha512-8wGQiX6rkR5J4V+AnWtQg3+LmC+cHnZIM1f/VWTjCTkVmcoKdeLsTAYG6BS2yKAugyEUjNUGj3vE5d9nj9m61A==`

## 已审查同步点

对于保留的 Agents 能力，Pi Stuff 已在语义上同步到上游 `v0.63.0`。这不是逐字节重新导入：Pi Stuff 仍以
Pi 为 Host，并在采用每项后续上游变更前，按照自身的所有者边界进行分类。

- 已审查源码标签：`v0.63.0`
- 已审查源码提交：`4f7eb2b56dc5306416920db8c6e222c7aaad3c81`
- 已审查 npm 软件包：`pi-subagents@0.63.0`
- 已审查 npm 归档字节数：`1,209,401`
- 已审查 npm SHA-1：`85098af67e96b8b31f3ea456daef5637c1c3de5b`
- 已审查 npm SHA-256：`de6aff4af2ca27ffcb396578559b515f252b1050a0c7c5ffe388be1599bf485f`
- 已审查 npm 完整性：
  `sha512-tS2zpzPnJh/tLODZGMN+XnpElOfN+l+KwDe+PnFcPfqwSd8zbirEjXR3W8uAcNlsaD8BxlDUSLHC//+v4+Ptcg==`
- 许可证：MIT；保留的 `LICENSE` 文件 SHA-256 为
  `2d20dfacd9742706e564470dc77438608a1e54b0ed46959f080709389209093c`。

完整的 30 个版本、820 个提交审查和全部处置类别记录在
[v0.63.0 同步台账](../../../../docs/research/pi-subagents-v0.63-synchronization-20260902.md)中。

Pi Stuff 保留子 Pi 进程、Session、生命周期、引导、恢复、能力上限、故障恢复和工作树基础，然后替换公开
产品行为与 UI。无关的上游产品界面仍然排除在外。

## Pi Stuff 差异

Pi Stuff 还让后台完成结果离开模型上下文：一条持久自定义 Session 条目提供紧凑 TUI 结果，`/agents` 负责
报告检查。Suite 负责的产物默认使用 Pi Settings 负责的 Session 根目录，而不是项目局部 `.pi-subagents` 目录。

主要删除的上游区域包括：

- Chain 与 Workflow 编排、计划运行、等待/自动排空流程和 Fleet 控制界面；
- Fleet 面板、Agent token 状态栏和上游设置 UI；
- Watchdog/审查自动化和 LSP 诊断；
- Memory、Share 和 Teams 集成；
- 上游提示词库、全部捆绑 Agent 定义与 Skill、管理/Doctor 命令和 Profile 管理界面。

只为理解用户可见行为而观察 `tanbiralam/claude-code`、已发布 Claude Code 二进制文件和
`tintinweb/pi-subagents`。没有把这些来源的代码复制进本模块。维护者此前的 `jczhang02/pi-agent` 配置也只
作为能力参考；没有复制其代码。

源码只在 Pi Stuff 内维护，没有独立 Package 或发布生命周期。
