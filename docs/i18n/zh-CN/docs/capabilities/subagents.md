<!-- translation-source: docs/capabilities/subagents.md; translation-source-sha256: 748143efeb8194ddbd7f3b971c594959a2a0e46eaf0d6f7d5902c21f12a4de14 -->

# Agents

[English](../../../../../docs/capabilities/subagents.md)

Agents 把有界工作委派给命名 child Agent，并通过一个 Tool 和 `/agents` dialog 提供完整生命周期。

## 前置条件

Agent 定义从以下位置发现：

1. 当前项目的 `.pi/agents` 目录；
2. 用户的 Pi `agents` 目录；
3. 已安装的 Pi Package。

名称冲突时，项目定义优先于用户定义，用户定义优先于 Package 定义。每次主运行前，`subagent` Tool 描述会列出
有效 roster 和每个 Agent 的用途。
Agent frontmatter 可以声明 `tools` 与 `excludeTools`；exclusion 对该 child 始终优先。

## 快速开始

在后台启动一个 Agent：

```json
{
  "agent": "general-purpose",
  "description": "Inspect parser",
  "task": "Find the parser boundary and report exact source evidence."
}
```

后台是默认方式。启动后继续独立工作；完成结果会自动送达。只有当前 Tool call 必须等待结果时，才设置
`"foreground": true`。

## Tool 形态

每个 `subagent` call 只能使用以下一种形态。

### 单个 Agent

`agent` 和 `task` 必填。可选字段用于选择简短 `description`、工作目录、model、Skill、显式 Tool budget 或
逐 Tool timeout、context mode、isolation 和前台执行。

### 并行 Agent

```json
{
  "tasks": [
    {
      "agent": "general-purpose",
      "description": "Inspect API",
      "task": "Report the public API with source references."
    },
    {
      "agent": "reviewer",
      "description": "Check behavior",
      "task": "Independently verify the documented behavior."
    }
  ]
}
```

Grouped task 会在当前容量内并发运行。同一条 Assistant response 中独立的原生 `subagent` Tool call 也可以并发。

### 控制

```json
{ "action": "status" }
{ "action": "steer", "id": "agent-id", "message": "Check the fallback path too." }
{ "action": "stop", "id": "agent-id" }
{ "action": "resume", "id": "agent-id" }
```

`status` 可以省略 `id`，获取一次性概览。`steer`、`stop` 与 `resume` 要求 `id`；grouped run 还可以用
`index` 选择 child。日常检查和控制请使用 `/agents`。

## 后台与前台

后台 launch 在 admission 和启动后返回。最终结果会生成紧凑、持久的 TUI result，不会主动开启另一轮主 Agent。
完整报告保留在 `/agents` 中。

前台 launch 会等到结果就绪，再把它返回当前 Tool call。嵌套 fanout 始终归启动它的 child 所有，不能脱离该 owner。

## `/agents`

`/agents` 显示当前 Session 的 Agent 生命周期、保留结果、Result、Activity 与有界 child transcript。

| 按键 | 操作 |
| --- | --- |
| Up / Down | 选择 Agent |
| Enter | 打开详情 |
| `x` | 停止 live Agent 或移除 terminal entry |
| `t` | 在详情中展开符合条件的 Tool 输出 |
| Escape | 返回或关闭 |

Footer roster 是紧凑生命周期视图。打开 Agent 管理时会替换 latest-prompt 行，让同一时刻只有一个界面负责控制。

## Context、model 与 Tool

Launch 可以请求 fresh 或 forked context、显式 model、一个 Skill，以及显式 Tool budget。Child 执行前会检查
容量、认证和 model 可用性。普通委派工作没有固定 turn 截止线，因此不会仅因 Agent 持续工作而终止仍有进展的运行。

`toolTimeoutMs` 为每个非等待型 Tool call 设置硬超时。task 级值覆盖 launch 值，launch 值覆盖 Agent frontmatter
与 `PI_SUBAGENT_TOOL_TIMEOUT_MS`。已知快速的内置 Tool 默认 5 分钟；本就需要等待的 supervisor 与 intercom
Tool 不受此限制。

`excludeTools` 从 child 的 ambient、显式、MCP 与 Suite 注入 Tool 中减去指定名称。排除 `subagent` 会关闭该
Agent 的嵌套 fanout；如果 Agent 的 Skill lazy loading 需要 `read`，则排除 `read` 会在启动前被拒绝。

每个 child 使用同一个 Pi Host binary，显式加载所属 Package，并关闭 ambient discovery。非 fanout child
不会得到 `subagent` Tool。

## 限制

默认 governor 限制为：

- 同时运行 20 个 Agent；
- 每个 parent Session 总共 launch 200 次；
- 嵌套深度 3；
- 每次运行 30 分钟。

普通 launch 没有 turn 或 Tool-call budget。显式 `toolBudget` 可以限制 Tool call，`toolTimeoutMs` 可以限制单次
Tool call，`timeoutMs` 可以收紧默认运行期限。

## Artifact 与 isolation

Agent artifact 位于 Settings 管理的 Session root 中，与持久 Pi Session 相邻。普通委派不会创建项目
`.pi-subagents` 目录。

可选的逐 Agent worktree isolation 会保留已修改或状态不确定的 worktree，供后续检查。只有干净且归 runtime
所有的 worktree 可以自动移除。

更换或结束 parent Session 会安全取消进行中的 launch，并记录其最终状态。

## 相关文档

- [Agents Module README](../../packages/pi-stuff/src/subagents/README.md)
- [命令参考](../reference/commands.md#工作控制)
- [Background Work](background-work.md)
- [Tool Display](tool-display.md)
