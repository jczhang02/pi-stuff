<!-- translation-source: packages/pi-stuff/src/subagents/UPSTREAM.md; translation-source-sha256: d295df0cf66608f201954332ec61a25c49e2fd32a21ec6686008e24c977dcfac -->

# 上游来源

本模块包含派生自 Nico Bailon 固定 `pi-subagents` `0.38.0` 快照的源码。

- 上游仓库：<https://github.com/nicobailon/pi-subagents>
- 源码标签：`v0.38.0`
- 源码提交：`89de10e4bc8895e7948704c38620a5b35ddcd17e`
- npm 软件包：`pi-subagents@0.38.0`
- npm SHA-1：`d7c3ce31cf71c0b96d02f2d48c1a715c07868dd1`
- npm SHA-256：`b44d87afc519f96c627fe56320c7c405e7b48cd22791c7526759b6c10a061b4f`
- npm 完整性：`sha512-8wGQiX6rkR5J4V+AnWtQg3+LmC+cHnZIM1f/VWTjCTkVmcoKdeLsTAYG6BS2yKAugyEUjNUGj3vE5d9nj9m61A==`
- 许可证：MIT；保留的 `LICENSE` 文件 SHA-256 为 `2d20dfacd9742706e564470dc77438608a1e54b0ed46959f080709389209093c`。

已发布归档在隔离基线提交中原样导入。Pi Stuff 保留子 Pi 进程、会话、生命周期、引导、恢复、能力上限、故障恢复和工作树基础，然后替换公开产品行为与 UI。无关上游产品界面未吸收到源码中。

## Pi Stuff 差异

Pi Stuff 还让后台完成结果离开模型上下文：一条持久自定义会话条目提供紧凑 TUI 结果，`/agents` 负责报告检查。套件负责的产物默认使用 Pi 设置负责的会话根目录，而不是项目局部 `.pi-subagents` 目录。

主要删除的上游区域包括：

- Chain 与 Workflow 编排、计划运行、等待/自动排空流程和 Fleet 控制界面；
- Fleet 面板、Agent token 状态栏和上游设置 UI；
- Watchdog/审查自动化和 LSP 诊断；
- Memory、Share 和 Teams 集成；
- 上游提示词库、全部捆绑 Agent 定义与 Skill、管理/Doctor 命令和 Profile 管理界面。

只为理解用户可见行为而观察 `tanbiralam/claude-code`、已发布 Claude Code 二进制文件和 `tintinweb/pi-subagents`。没有把这些来源的代码复制进本模块。维护者此前的 `jczhang02/pi-agent` 配置也只作为能力参考；没有复制其代码。

源码只在 Pi Stuff 内维护，没有独立软件包或发布生命周期。
