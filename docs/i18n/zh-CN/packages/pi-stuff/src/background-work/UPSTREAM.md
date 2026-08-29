<!-- translation-source: packages/pi-stuff/src/background-work/UPSTREAM.md; translation-source-sha256: 6e1129a65261c6f65904382439ac2433fd2a064817796d6fb86fa07b24ba9446 -->

# 上游来源

本模块包含一个精简源码快照，派生自 [`pi-background-tasks`](https://github.com/ismailsaleekh/pi-background-tasks) 的已发布 `2.0.0` 版本和精确源码提交 `db632653682c00852a38c0972a761fb1e9f24dc3`。

- npm 归档：`pi-background-tasks-2.0.0.tgz`
- npm 完整性：`sha512-LyTFnuPbL2BhzNQaq7l7KN3neV2WyQbH1uEiSTM4cpyAw7489SATqQDoZ9SCqkRIBH/zktP7xvk/VNerpU3QPQ==`
- 归档 SHA-256：`7b0b1220bacc3fa2516cf9d7cdb1933d90b12b2b3dcd36c56c882ab41e6cfaf0`
- 许可证：ISC，精确上游声明保留在 `LICENSE`
- 保留的 `LICENSE` SHA-256：`5b9bdcc9d1c8ff25c560200695de042b12052573cb1224af4d735fba06d30b65`

每个已发布文件都已与所记录提交逐字节验证。比较审计和真实 Pi/进程证据记录在 `docs/research/work-background-package-reference.md`。

## 保留的血统

吸收的源码保留上游后台任务运行时约定和实现血统：会话负责的注册表、分离的进程组启动、受限输出与有界读取、竞态幂等终态、先对进程组发送 TERM 并只升级一次 KILL、等待停止/关闭、紧凑终态发布，以及聚焦进程安全测试。

## 已删除的上游产品区域

Fusion、委派、经过证明的 Pi Runner、Agent 遥测、更新检查、页脚/停靠栏/状态 UI、软件包特定设置及其运行时依赖不属于 Pi Stuff Work，因此不保留。`pi-stuff-agents` 仍是唯一 Agent 权威。

## Pi Stuff 差异

- 增加 Leader 启动身份、宿主突然退出后的陈旧运行协调，以及延迟创建的项目/会话运行时文件。
- 增加只针对活跃进程的前台 Bash 分离，以及一次性命令/日志/文件/HTTP Monitor 条件。
- 增加紧凑套件工具呈现和共享全宽 `/tasks` 命令对话框。
- 删除侧边栏、浮动窗口、能力状态栏、权限提示、守护进程和跨会话重附界面。

`pi-patty-bg-tasks@1.1.6` 只作为条件 Bash 分离与 Monitor 易用性的行为参考进行检查。其源码没有混入本模块。吸收的源码没有独立软件包或发布生命周期。
