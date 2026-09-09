# Issue 跟踪: GitHub + Beads

[English](../../../agents/issue-tracker.md) · 以英文为执行依据, 本文仅供人阅读.

仓库: `jczhang02/pi-stuff`.

GitHub Issues 保存需求、验收条件、公开进展、决策和 PR 链接. Beads 保存代理执行上下文, 包括调查记录、依赖、阻塞和交接. 保留足够上下文, 让另一代理能够接续.

## 关联任务

行为变更和多步骤工作需要跟踪任务. 错字和格式修复可以直接开 PR, 无需单独的 Issue 或 Beads 记录. 明确授权的仓库初始化工作, 在 Beads 尚未初始化时也可先进行, 但须在 PR 中说明.

创建前搜索两个跟踪器是否已有记录. 同一任务只使用一组关联的 GitHub Issue 和 Beads 记录, 不分别调用 `gh issue create` 与 `bd create` 制造重复任务.

已有 GitHub Issue 时将其拉入 Beads. 从 Beads 创建的新任务准备发布时, 推送至 GitHub 并核验外部引用. 在 Beads 中记录关联, 首条 GitHub 进展评论中尽可能包含 Beads ID.

技能要求发布到 Issue 跟踪器时, 发布 GitHub Issue 并建立 Beads 关联. 技能要求读取相关任务时, 阅读 GitHub 正文、标签、评论及对应 Beads 上下文.

## 会话归属

由代理执行的任务只有一个当前主责 session, 整个任务可以涉及多个会话. 用平台和稳定 session ID 标识会话, 如 `pi:<session-id>`, 并附可用的会话链接或定位信息. 仅有模型名或展示昵称不能定位执行上下文.

Beads assignee 字段保存当前负责人身份. 在任务元数据或笔记中保留平台、session ID 和定位信息；其他会话按实际角色关联, 如调查、实现或独立审查. 子代理保留父 session 和工具提供的子代理标识. 无法取得稳定 session ID 时, 记录这一限制及可用定位信息, 不编造 ID. 会话引用用于定位对话；Beads 中仍需保留可用于继续工作的发现和剩余事项.

执行更新的会话使用 `bd --actor <platform:session-id>`. actor 是该次操作的记录者, assignee 是交付负责人. 审查者记录自己的身份, 不替换执行负责人. 在 GitHub Issue 正文或进展评论中体现当前负责人和相关交接；GitHub 账号 assignee 不代表 agent session. 发布有用的会话引用, 不暴露私有完整对话或个人文件系统路径.

其他会话接手时, 检查既有认领、更新当前 assignee, 并保留前后 session 身份、交接原因、已完成工作和下一步. 工具支持时使用带前置条件的重新分配, 先处理仍有效的认领, 不覆盖他人归属. 恢复同一个 session 时沿用原身份. 例如, 一个任务可以由 session B 当前负责、session A 为前任负责人、session C 负责独立审查.

## 同步前

阅读 [Beads 设置](beads.md), 了解本地工作区、共享工作树和临时 GitHub 认证. 开始或恢复上下文时加载官方 beads 技能并运行 `bd prime`.

检查 `bd version`、`bd github --help` 和 `bd github status`. Beads 未初始化或无认证时报告阻塞, 不声称同步成功, 不暗中初始化基础设施.

仓库预期设置:

```bash
bd config set github.repository jczhang02/pi-stuff
```

通过 `GITHUB_TOKEN` 提供凭据, 不提交凭据. 首次同步或同步范围改变后, 先运行:

```bash
bd github sync --dry-run
```

继续前检查预期修改. 完整双向同步可能发布本地任务. 某些记录必须保持未发布时, 使用当前 CLI 支持的选择性操作, 不做全量同步. Beads 并非天然私密, 写入非公开信息前检查数据库远端访问权限.

`bd sync` 同步 Beads 数据, `bd github sync` 与 GitHub 同步, 两者不能混用.

## 工作周期

1. 开始或恢复任务时同步已批准范围. 工作区全部内容均获准发布时, 运行 `bd github sync`.
2. 用 `gh issue view <number> --repo jczhang02/pi-stuff --comments` 单独阅读 GitHub 讨论, 同时检查当前标签.
3. 将新需求、反馈和决策概括进 Beads, 保留来源链接, 不在每次会话重复抄写相同反馈.
4. 认领前检查阻塞和归属. 使用实际 session 身份认领, 在 Beads 记录执行状态、发现和下一步. 分流标签不替代执行状态.
5. 修改任务字段后运行 `bd github push <bead-id>` 并核验结果. 里程碑评论按下方规则另行发布.
6. 结束会话前再次同步已批准范围, 记录剩余工作和待发布事项的 Beads 交接.

CLI 默认在冲突时偏向较新的版本, 这不能替代检查并发编辑. 两端都发生变化时先比较再同步. 需求或验收条件有歧义时请用户决定, 不盲目使用 `--prefer-local` 或 `--prefer-github`.

## 评论与公开更新

编写或实质更新 GitHub 标题、描述、评论或摘要前, 遵循[贡献指南的语言与呈现](../CONTRIBUTING.md#语言与呈现)：Issue/PR 标题仅英文, 正文先英文后中文, Markdown 与内容规模相称. 同步时保留标识符和规范字段, 不批量翻译机器元数据或历史讨论.

已检查的 `bd 1.2.1` 集成中, `bd github sync` 不同步评论. 显式阅读 GitHub 评论, 使用以下命令发布公开摘要:

```bash
gh issue comment <number> --repo jczhang02/pi-stuff --body-file <summary-file>
```

在以下节点发布简短评论:

| 事件           | 内容                               |
| -------------- | ---------------------------------- |
| 开始工作       | 范围和下一步                       |
| 阻塞或等待决定 | 原因、影响及具体所需行动           |
| 重要里程碑     | 已完成工作、实际验证结果和剩余工作 |
| 任务完成       | 结果、实际验证、PR 链接及已知局限  |

详细调查和执行记录留在 Beads. 公开发布有用摘要, 不镜像每条内部笔记. 没有实质变化时不重复更新.

发布后, 在 Beads 记录 GitHub 评论 URL 和简短发布标记. 重试前检查 GitHub 上是否已有同一更新, 包括命令报错但服务器可能已经接受的情况.

发布失败时, 将待发布文字和失败原因存入 Beads, 标记待处理并告知用户, 恢复工作后重试. Beads 也不可用时, 在用户交接中保留待发布文字. 任务完成与发布完成是两个状态, 必须报告未完成发布.

公开摘要移除凭据、个人信息和非公开细节. 按 `AGENTS.md` 要求, Beads 和 GitHub 文字均使用 Sepia.

## Issue 操作

GitHub 读取、评论和直接编辑使用 gh, 工作目录有歧义时显式指定本仓库.

CLI 创建的 Issue 须具备对应模板信息和明确分流标签, 网页模板不会约束 CLI. 直接修改 GitHub 字段后, 先将该任务拉入 Beads, 再继续本地编辑.

只有满足验收条件时才关闭任务, 并在两个跟踪器记录结果. 开 PR 不等于完成. 合并能满足验收时使用 `Closes #<number>`, 否则使用 `Refs #<number>`. 合并触发 Issue 关闭后, 下次同步时协调 Beads 状态.

## 父任务与依赖

父任务链接子任务, 每个子任务也链接父任务. Beads 保存执行依赖图, GitHub 展示协作所需的阻塞和链接. 不假定原生同步会保留全部依赖和讨论细节.

wayfinder 使用一个标为 `wayfinder:map` 的地图 Issue, 子任务标为 `wayfinder:<type>`, type 为 `research`、`prototype`、`grilling` 或 `task`. 可用时使用 GitHub sub-issues, 否则在地图中列任务清单, 子任务写 `Part of #<map>`. 阻塞优先使用 GitHub 原生依赖, 否则写 `Blocked by: #<number>`. 同步不映射时显式维护这些链接.

寻找当前可推进决策时, 按地图顺序查看开放子任务及其 Beads 记录中的未解决阻塞. 执行前认领合适任务并在 GitHub 体现归属. 解决后发布答案、关闭已验收任务, 在地图的决策部分添加摘要和来源链接.

## PR 是否作为需求入口

**PR 作为需求入口: 否.**

## 自动化边界

这些是代理工作规则, 不是已部署的调度器或评论同步桥梁. 此配置没有安装后台同步. 报告实际同步和发布结果, 不承诺无人值守更新.
