<!-- translation-source: .github/CONTRIBUTING.md; translation-source-sha256: 35d01b53282d3eeb0c85615fd1e2ae73ff91e525ed828d426c27f843c7c23aaf -->

# 贡献指南

## 开始之前

1. 阅读 `AGENTS.md`、`CONTEXT.md` 和相关 ADR。
2. 使用 Beads 管理已经接受的工作，并在实现前认领一个 ready issue。
3. 让变更始终处于 Pi 原生 Package 与 Extension 契约之内。

外部缺陷与功能请求可以先从 GitHub issue 表单进入。维护者会在实现前把接受的工作纳入 Beads。

## 开发

使用 Bun 1.4.0：

```bash
bun install --frozen-lockfile --ignore-scripts
bun run check
```

测试必须覆盖约定的公开接缝；验证期间必须离线，而且不得调用 LLM 或要求凭据。

连续检查原生 Spinner、输入和命令补全选择时，运行
`bun scripts/benchmark-responsiveness.ts --pi "$PI_BIN"`。脚本使用隔离的合成 Session，并在仓库外保留原始
观察记录。[观察器报告](../docs/reports/suite-responsiveness-observer-2026-09-05.md)说明了锁定门槛、故意卡顿
对照与 Execution Ledger 首次加载复现。这些针对性检查不能替代完整资源或 Capability 验收。

设置 `PI_STUFF_UI_PTY_ARTIFACT_DIR` 后，观察器还会在采集结束后把证据 JSON 复制到该目录。
CI 通过现有失败附件保留合成场景的画面、交互时序、Provider 事件日志、Session 记录和 Source 快照，
调度工作负载失败时也会保留；不会复制 Host 可执行文件或私有夹具配置。调度汇总在每项工作负载完成后保存，
后续负载失败也会上传。未完成的批次仅供诊断，不代表验收成功。

手动触发 CI 时可设置 `probe_kernel_events=true`，先在独立的 GitHub 托管虚拟机上执行调度事件正控，
再在普通验收之前运行七种诊断工作负载。它们复用响应性 observer，覆盖原生 Pi、Suite Tool、前台/后台
Agent、Context、Goal 和冷 Ledger。只有采集器使用宿主机 root 跟踪权限；工作负载以普通 runner 用户
运行，并使用独立的用户、网络和 PID 命名空间。独占 tracefs 实例使用全局时钟，拒绝事件丢失、任务
生命周期不完整、根进程身份不明确或不支持的非主线程 exec。唤醒按目标任务归属统计，覆盖线程/子进程
创建、退出清理及 PID 复用。计数和内核事件格式保留为汇总附件；不上传全系统原始跟踪。
将 `scheduler_baseline` 设为仓库完整 commit SHA，可在同一 runner 上按基线/候选/候选/基线顺序比较干净的
Package 源码树。每批都用当前 observer 执行全部七种工作负载，记录实际选择的 Package commit；进程和配置
均为新建，但不清空内核页缓存。observer 的 `--package` 参数也可用于本地对照，并分别保存 observer 与
Package 的 commit/diff 来源。
这些诊断运行不证明活性通过。普通验收仍在关闭跟踪后运行；请求额外测量的手动运行增加 25 分钟 job 时限，
供串行对照使用。

## Package 变更

Pi Stuff 只有一个私有本地 Package。Capability Module 不独立确定版本或发布。当行为变化需要持久的用户可见
记录时，更新 `docs/releases/` 中的发布说明。详细变更历史由 Git 保留。

不要只手工修改生成的组合输出。请修改 `packages/pi-stuff/suite.json`，运行 `bun run suite:generate`，再用
`bun run pack:verify` 验证提取后的本地 Package。本仓库没有 registry 发布或 Changesets 流程。

## 提交

使用带签名的 Conventional Commit：

```text
<type>(<scope>): <祈使句主题>
```

维护者可以把已经验证的提交直接 push 到 `main`。外部贡献应以 pull request 作为代码交付和审查界面；接受
的范围与状态仍按[问题跟踪契约](../docs/agents/issue-tracker.md)记录在 Beads 中。禁止 force-push 或删除 `main`。
