<!-- translation-source: .github/CONTRIBUTING.md; translation-source-sha256: de7794c373ca73d46d15937633202fb0f06af12f321db5156b76e020e9890e0d -->

# 贡献指南

## 开始之前

阅读 `AGENTS.md`、`CONTEXT.md`、`docs/compatibility.md` 及相关 ADR 或 Module README。已接受的共享工作使用 Beads，并在实现前认领 ready issue；外部请求先由维护者接纳。变更须处于 Pi 原生 Package 与 Extension 契约之内。

## 开发

使用仓库固定的 Bun 版本。开发时运行聚焦检查和 `bun run check:fast`；PR 准备前在最终 revision 运行必要 CI 检查。测试应覆盖约定的公开 seam，保持离线，不调用 LLM 或要求凭据。影响未知的变更需要完整检查。

## Package 变更

Pi Stuff 只有一个私有本地 Package。Capability Module 不独立确定版本或发布。行为需要持久用户记录时更新 `docs/releases/`。修改 `packages/pi-stuff/suite.json`，运行 `bun run suite:generate`，并用 `bun run pack:verify` 验证；不得只编辑生成输出。

## 提交

使用带签名的 Conventional Commit：

```text
<type>(<scope>): <imperative subject>
```

维护者可以把已验证的提交 push 到 `main`。外部贡献以 pull request 交付和审查；接受的范围与状态按 [issue-tracker 契约](../docs/agents/issue-tracker.md)记录在 Beads。禁止 force-push 或删除 `main`。
