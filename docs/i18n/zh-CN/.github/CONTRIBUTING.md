<!-- translation-source: .github/CONTRIBUTING.md; translation-source-sha256: fcc48f9464b380c1367fccfacaed32804f859a112351488a2a831740171dc5ff -->

# 贡献指南

## 开始之前

遵循 [AGENTS.md](../AGENTS.md) 中按任务读取的要求和工程边界。已接受的共享工作按 [Issue 跟踪契约](../docs/agents/issue-tracker.md)使用 Beads；外部请求先由维护者接纳。

## 开发

使用仓库固定的 Bun 版本，遵循[验证政策](../docs/code-quality.md#按风险验证)，包括纯文档变更路径和复用同一版本的必要 CI 证据。普通自动化测试保持离线且无需凭据；真实 Provider 或外部 Service 验收需要显式选择。

## Package 变更

Pi Stuff 只有一个私有本地 Package。Capability Module 不独立确定版本或发布。行为需要持久用户记录时更新 `docs/releases/`。Suite 组合变化时，修改 `packages/pi-stuff/suite.json` 并运行 `bun run suite:generate`。Package 契约变化需要按验证政策提供 `bun run pack:verify` 证据。

## 提交

使用带签名的 Conventional Commit：

```text
<type>(<scope>): <imperative subject>
```

维护者可以把已验证的提交 push 到 `main`。外部贡献以 pull request 交付和审查；接受的范围与状态按 [issue-tracker 契约](../docs/agents/issue-tracker.md)记录在 Beads。禁止 force-push 或删除 `main`。
