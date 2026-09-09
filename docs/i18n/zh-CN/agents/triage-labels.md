# 分流标签

[English](../../../agents/triage-labels.md) · 以英文为执行依据, 本文仅供人阅读.

| 技能中的角色      | 仓库标签          | 含义                             |
| ----------------- | ----------------- | -------------------------------- |
| `needs-triage`    | `needs-triage`    | 等待维护者评估                   |
| `needs-info`      | `needs-info`      | 等待推进所需的信息               |
| `ready-for-agent` | `ready-for-agent` | 范围和验收条件明确, 可由代理执行 |
| `ready-for-human` | `ready-for-human` | 下一步需要人来实施或作出决定     |
| `wontfix`         | `wontfix`         | 不会处理                         |

技能指定分流角色时使用此映射. 改变分流结果时移除过时的分流标签, 保留当前适用的一项. `bug` 等类型标签可以同时存在.

使用 `needs-info` 时准确说明缺少什么. 使用 `ready-for-human` 时指出人需要采取的行动. 使用 `wontfix` 时解释原因, 通常同时关闭 Issue.

分流标签表示流转方向, 不表示执行进度. 进行中和完成状态由任务状态记录.

完整标签定义, 包括颜色和类型标签, 位于 `.github/labels.json`. 该文件只是清单, 不会自动配置 GitHub.
