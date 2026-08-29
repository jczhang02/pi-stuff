<!-- translation-source: docs/agents/issue-tracker.md; translation-source-sha256: 29aad6e2fa94fb9f19460b23c2db2442f05ce0621836449eecd5a1c30bdce362 -->

# Issue 跟踪器：Beads，配合 GitHub 接收与镜像

Beads 是本仓库的规范 Issue 跟踪器。GitHub Issues 是已接受工作的公开单向推送镜像，也是外部报告的接收界面。

所有已接受工作的创建、更新、依赖、认领和关闭都从 Beads 开始。不要把镜像 GitHub Issue 当作权威副本来编辑。

## 本地操作

- 创建：`bd create`
- 读取：`bd show <id>`
- 列表：`bd list`
- 查找就绪工作：`bd ready`
- 认领：`bd update <id> --claim`
- 更新：`bd update <id> ...`
- 关闭：`bd close <id> --reason "..."`
- 添加阻塞项：`bd dep add <blocked-id> <blocker-id>`
- 检查依赖：`bd dep tree <id>` 或 `bd graph`

Issue ID 使用 `ps` 前缀。

## 本地存储

本地 Dolt 数据库是 Beads 命令的权威。整个 `.beads/` 工作区仅限本地，并排除在 Git 之外。

发布命令可以在把已接受工作同步到 GitHub Issues 后，刷新经过清理的本地 `.beads/issues.jsonl`。该导出不受版本控制，也不是完整 Dolt 备份。Beads 不得暂存、提交、推送或以其他方式操作 Git，仓库也不安装 Beads Git Hook。

## GitHub 镜像

使用以下命令显式发布 Beads Issue：

```bash
bun run beads:publish -- <epic-or-bead-id>
```

命令先预览，再执行仅推送的 GitHub 同步。它在运行时取得认证，绝不持久化 token。

不要运行通用双向同步，也不要把 GitHub 变更拉入 Beads。父子和阻塞关系以 Beads 为准，不保证显示在 GitHub Issue UI 中。

## 外部接收

Bug 和功能表单会创建 GitHub 接收 Issue。在 GitHub 上分诊。Issue 被接受后，维护者可进行一次定向接纳：

```bash
bd github pull gh-<number>
```

接纳后，在 Beads 中更新，并使用仅推送同步。这次性接收操作是“不拉取”规则唯一的常规例外。

## Skill 操作

Skill 要求“发布到 Issue 跟踪器”时：

1. 创建或更新 Beads Issue。
2. 在 Beads 中添加其父级和阻塞关系。
3. 显式发布相关 Issue 或 Epic 子树。
4. 可用时同时返回 Beads ID 和 GitHub URL。

Skill 要求“获取相关 Ticket”时，使用 `bd show <id>`。把对应 GitHub Issue 视为公开镜像。

## 工作地图

- 一张地图是一个 Beads Epic。
- 子 Ticket 使用该 Epic 作为父级。
- 阻塞关系使用 Beads 依赖边。
- `bd ready --parent <epic-id>` 标识可执行前沿。
- 实现前先认领 Ticket。
- 只有验证验收标准后才关闭。
- 发布 Epic 子树以刷新 GitHub 状态。

## 把拉取请求作为分诊界面

PR 用于交付和审查代码，不用于请求工作或定义其权威范围。外部贡献者可以提交 PR，但维护者必须先把接受的范围接纳到 Beads，之后实现才算仓库工作。审查意见可以完善补丁；工作项状态、依赖和关闭仍由 Beads 负责。

## 公开数据政策

仓库、JSONL 导出和 GitHub Issues 都是公开的。绝不要在 Beads 字段或 GitHub Issue 中放置凭据、私有路径、私有数据、未公开个人信息或敏感运行细节。
