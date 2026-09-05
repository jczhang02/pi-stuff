<!-- translation-source: .agents/skills/beads/SKILL.md; translation-source-sha256: 6f47d9864cc95a5f26d9f08e74fe7c489ef79329d0e85072fe8c0594ef4766ac -->

# Beads

本 skill 管理 Pi Stuff 已接受的工作，包括查找、获取、创建、认领、建立关系、接纳、发布、更新、关闭及报告交付。它也用于工作地图和 GitHub Issue 接收，不用于仅限当前轮次的清单。

[Issue tracker 契约](../../../docs/agents/issue-tracker.md)是权威。修改跟踪状态前必须全文阅读；通用 `bd` 指引与其冲突时以仓库契约为准。

新 Session、压缩上下文或缺少 Beads 上下文时运行 `bd prime`。仓库有意不安装 Beads hooks，不依赖自动注入。

## 选择状态所有者

- 已接受的共享工作、依赖、后续工作及交接使用 Beads。
- 本地 Agent 计划可跟踪当前轮次执行，但不能替代 Beads。
- 持久术语或架构决策同时写入 `CONTEXT.md` 或 ADR，以及对应 Bead。

## 操作跟踪器

1. 已知 Beads ID 时运行 `bd show <id>`；GitHub 接收 ID 使用下文接纳流程。选择工作用 `bd ready` 或 `bd ready --parent <epic-id>`。
2. 创建可能重复的工作前，用 `bd search "<terms>"` 搜索所有状态。以 `bd create` 建立已接受工作并确认 `ps` 前缀。每个新 Bead 必须记录来源 Host/Agent 界面、可用时的 Session 名及稳定 ID 或等效检索键，仅保留元数据并遵循公开数据政策。
3. 实现前用 `bd update <id> --claim` 认领。
4. 用非交互 `bd update` 参数更新，不使用 `bd edit`。
5. 工作地图使用 epic，ticket 是其子项，阻塞关系使用 `bd dep add <blocked-id> <blocker-id>`。

## 保持 Beads 本地化

- 本地 Dolt 数据库是权威。忽略的 `.beads/` 及清理后的 JSONL 导出是本地状态；导出不是备份。
- Beads 只管理 Issue 状态。不要直接运行 `bd init`、`bd setup`、`bd hooks`、`bd dolt push`、`bd dolt pull` 或通用 `bd github sync`，也不要安装 Beads Git 或 Codex hooks。
- `.beads/` 不进入 Git。Beads 不得暂存、提交、推送或操作仓库 Git。

## 使用 GitHub 边界

- GitHub Issues 是公开接收界面和单向镜像。已接受工作的更新始于 Beads。
- 外部接收分诊遵循 [label 契约](../../../docs/agents/triage-labels.md)。公开 label 不代表工作已可执行。
- 接纳前运行 `bd search --external-contains "gh-<number>"` 查重。无既有接纳时，维护者指示下可执行一次 `bd github pull gh-<number>`，之后使用返回的 `ps` ID。
- 接纳后回到 Beads 与仅推送发布，不执行其他拉取或双向同步。
- PR 是代码交付与审查界面，不是范围、依赖、状态或关闭的权威。

## 完成已接受工作

遵循[交付与关闭流程](../../../docs/agents/issue-tracker.md#delivery-and-closure)，包括由其他 skill 执行实现的情况。关闭前记录 `metadata.github_delivery`，签名并推送代码，让 PR 回链 Issue，并区分已接受实现与合并。仅分支交付需要用户范围和明确原因；无代码工作也需要自身证据与原因。

规范关闭后，已授权的发布必须返回已验证的受管理评论 URL。单独成功的 `bd close` 或原始 GitHub 同步不是公开交付。失败时保留 Beads 结果，报告公开状态未完成，并通过 `bun run beads:publish -- <id>` 重试。返回 Issue 和交付评论链接，以及 PR 或不创建 PR 的记录原因。之后执行已授权合并时重新发布，使观测状态保持最新。

所有 Bead 和 GitHub 镜像字段都应视为可能公开。不得包含凭据、私有路径或数据、未公开个人信息，以及敏感 Session 或运行细节。
