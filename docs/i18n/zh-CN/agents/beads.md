# Beads 设置

[English](../../../agents/beads.md) · 以英文为执行依据, 本文仅供人阅读.

## 本地工作区

本克隆使用 Beads v1.2.1 和嵌入式 Dolt. 工作区位于主 checkout 的 `.beads/`, `bd where` 显示实际数据库路径, 不需要外部 SQL 服务器.

工作树通过 Git 公共目录发现同一工作区. 在每个工作树写任务前运行 `bd where` 确认. 不要为每个工作树单独初始化数据库, 也不要在工作树之间复制正在使用的数据库文件.

认领和更新任务时, 按[会话归属](issue-tracker.md#会话归属)使用真实会话身份作为 `bd --actor`. assignee 记录当前执行负责会话, actor 记录实际执行操作的会话. 认领失败时处理冲突, 不覆盖其他会话的分配. 在 `bd 1.2.1` 中, `bd update --session` 是 Claude Code 的关闭会话字段, 不是通用的负责会话字段.

数据库文件和本地配置不进入 Git. 当前设置如下:

| 设置                | 值                   | 原因                        |
| ------------------- | -------------------- | --------------------------- |
| Issue 前缀          | `pi-stuff`           | 稳定任务标识符              |
| `github.repository` | `jczhang02/pi-stuff` | 公开协作目标                |
| `dolt.local-only`   | `true`               | 不向远端发布完整数据库      |
| `backup.enabled`    | `false`              | 维护者决定不设置备份        |
| `export.auto`       | `false`              | 不自动导出 JSONL            |
| `no-git-ops`        | `true`               | Beads 不负责源码 Git 工作流 |

未配置 Dolt remote 或备份. GitHub Issue 同步不保留内部评论、依赖图或完整数据库历史. 维护者决定不设置备份; 备份不是仓库工作的前置条件.

`no-git-ops` 影响 Beads 生成的指引, 不取消 `AGENTS.md` 的提交和推送要求. 不要通过宽泛的 `bd doctor --fix`、破坏性重新初始化或自动编辑器设置, 抹掉本仓库有意保留的上游默认值差异.

## 技能与会话上下文

官方最小技能安装在开发主机的 `~/.agents/skills/beads/SKILL.md`, 附有 MIT 许可证和来源记录. 文件从 [Beads v1.2.1](https://github.com/gastownhall/beads/blob/634cbbc4bc580fa5124f63fdf65d137a46d5b4ff/internal/templates/skills/beads/SKILL.md) 原样复制.

这是主机安装, 不是仓库内置依赖. 在其他主机使用前, 安装同一份已审查技能. Pi 会发现 `~/.agents/skills/`, 安装后使用 `/reload` 或重启会话. 其他 harness 可能使用不同发现路径.

任务开始、恢复或上下文压缩后, 加载技能并运行 `bd prime`. 未安装 Beads Git hooks 或编辑器会话 hooks. 在 Pi 中显式运行 prime, 不假定它会自动注入. 仓库专属发布和写作规则保留在 `AGENTS.md` 与 `issue-tracker.md`, 不写进上游技能.

## 新克隆初始化

先运行 `bd where`, 检查是否已有工作区. 仅在不存在工作区且用户已授权时初始化. `.beads/` 已有数据或配置时先检查, 不覆盖.

对于新的空工作区, 创建 `.beads/config.yaml`:

```yaml
dolt.local-only: true
backup.enabled: false
export.auto: false
no-git-ops: true
```

然后从主 checkout 运行:

```bash
bd init --prefix pi-stuff --role maintainer --non-interactive --stealth --skip-hooks --skip-agents
bd config set github.repository jczhang02/pi-stuff
bd where
bd info --json
```

`--stealth` 通过 `.git/info/exclude` 让数据库保留在本地, 并避免 init 自动生成源码提交. skip 参数保留仓库代理指令和既有 hooks. 该模式不妨碍显式发布 GitHub Issue.

## GitHub 认证与预览

集成使用 `GITHUB_TOKEN`. 本主机已有认证的 gh 会话, 可以向单条命令提供凭据而不再保存令牌:

```bash
GITHUB_TOKEN="$(gh auth token)" bd github sync --dry-run
```

不要打印或持久化令牌. 认证失败时报告并请求设置, 不把凭据存入仓库文件. 先运行 dry-run, 仅对已批准发布的范围进行真实同步. 任务字段同步与单独发布评论遵循[跟踪规则](issue-tracker.md).

## 验证

设置后比较主 checkout 和工作树中的 `bd where` 与 `bd info --json`. 检查 `bd ready --json`、`bd doctor --check=conventions` 和 `bd doctor --check=artifacts`. 这些检查支持嵌入式模式, v1.2.1 的完整 doctor 套件需要服务器模式.

合成测试 Issue 使用一次性工作区. 不要仅为确认命令可用, 就用测试任务污染项目数据库或 GitHub.
