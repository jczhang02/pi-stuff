<!-- translation-source: docs/agents/triage-labels.md; translation-source-sha256: ac35b351184db0c1f76ccbe57fe8dc589e1bc14c08b3b9778287f3030b7fc36f -->

# 分诊标签

| 规范角色 | 跟踪器标签 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 需要维护者评估此 Issue |
| `needs-info` | `needs-info` | 正在等待更多信息 |
| `ready-for-agent` | `ready-for-agent` | 规格完整，可交给 Agent |
| `ready-for-human` | `ready-for-human` | 需要人工实现 |
| `wontfix` | `wontfix` | 不会处理 |

Skill 指定规范角色时，使用对应跟踪器标签。

这些标签描述公开 GitHub 分诊镜像。它们不会使工作变得可执行：Beads 所有权、依赖和 `bd ready` 仍是权威。
