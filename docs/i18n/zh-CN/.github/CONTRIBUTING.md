<!-- translation-source: .github/CONTRIBUTING.md; translation-source-sha256: 413f9e932bd7a6705a120172737461ffbbe51656ee36bc3398e370ff05781ca6 -->

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
