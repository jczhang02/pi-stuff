<!-- translation-source: docs/capabilities/tool-display.md; translation-source-sha256: f4d0cd10758711c3b99199437b7f8e433455c76d289e80449a67c25f41cba5f4 -->

# Tool Display

[English](../../../../../docs/capabilities/tool-display.md)

Tool Display 把 Tool 执行变成紧凑、可检查的 activity，同时不改变 Tool call、结果或权限流程。

## 快速开始

在 Pi 中连续运行几个 Read、Grep、Find 或 List 操作。连续检索 activity 会在 transcript 中折叠成一行。

按 `Ctrl+O` 展开符合条件的 transcript activity，或运行：

```text
/tools
```

选择 activity 并按 Enter 查看详情。使用 `/ui` 切换 running timer。

## Retrieval Group

连续的原生 Read、Grep、Find 和 List call 会组成一个 Retrieval Group。该行汇总有序的 Search、Read 和 List
工作，也会保留失败、被拒绝或取消的成员供检查。

超过单次显示预算的连续运行会变成一组有序、有界的 segment。`Continued` 与 `continues` 标记用于指出相邻
segment，而不扫描尚未加载的成员，也不声称完整运行的总数。

Conversation 遇到不同含义的工作时，Retrieval Group 会结束，包括：

- Bash、Web、MCP、media、mutation、Agent、Task、Background 或 Goal activity；
- 精确读取 `SKILL.md` 资源；
- 未知或第三方 Tool；
- 可见 prose、Thought 内容或其他可见 conversation 边界。

分组只影响呈现。Reload、resume、tree navigation 和 compaction 会从 Session 记录重建同一视图，不改变
model 可见 message。

## Operation Block

独立 operation block 覆盖 Bash、Write、Edit、Patch、Background 输出，以及尚未有可见 owner 的外层
Code Mode 失败。

每个 block 先显示 operation identity，再显示有界结果证据。例如 Bash 显示命令与退出状态，Write 显示行数和
最终内容，Edit 显示变更数与 diff 证据，Patch 显示逐文件统计。source cap 会先于拆行、diff projection、
换行或高亮生效。

Agent 委派使用 Agent Lifecycle Row，`/agents` 是检查和控制界面。Task bookkeeping 与透明 infrastructure
activity 不出现在紧凑 transcript 中，但仍可以通过 `Ctrl+O` 和 `/tools` 查看。通过共享 Tool seam 注册的
Agent 相关 Tool 使用同样的有界行；`/agents`、child transcript、continuation、cancellation 与 execution policy
仍由 Agents 负责。

## Activity 状态

活动行使用现在时标签，并可显示经过时间。结算行明确显示成功、失败、拒绝、取消或空结果证据。颜色只辅助 icon
与状态文字，不单独承担状态含义。
后续成功调用不会改写较早的失败；同时包含失败和成功的 Retrieval Group 仍显示为警告。

历史数据格式错误或 renderer 失败时，会退化为有界通用行，保证 Tool history 仍可检查。

## 有界显示工作

Compact、Expanded、Formatted 与 Raw 视图会在调用 presentation callback 或执行高分配开销格式化之前，限制
argument、result、object depth、item 数、nested operation、media、行数与字节数。MCP preview、Code Mode
envelope、Agent Tool row 与 Operation Block 都遵循同一规则。超大值会显示截断或省略标记；只有无需额外完整
扫描就已知时，才显示精确省略数量。

这些限制只改变显示 projection。完整 Tool argument、result、Provider context 与规范 Session record 均保持不变。

## `/tools`

`/tools` 不接受参数。它打开最新的有界 history page；如果还有记录，则显示 `Load older activities…`。选择该行
只加载一个更早的有界 page，普通导航不会触发隐藏加载。重复加载可以按 source order 到达最早的 Session Tool
记录。

| 按键 | 操作 |
| --- | --- |
| Up / Down | 在 activity 或 call 之间移动 |
| PageUp / PageDown | 按页移动 |
| Home / End | 跳到第一项或最后一项 |
| Enter | 打开选定 group 或 activity |
| `r` | 切换 Formatted 与 Raw detail |
| Escape | 返回或关闭 |

Formatted detail 使用适合日常阅读的语义 section。Raw detail 是有界协议视图。两种模式都限制为 240 行和
24 KiB。

## 响应性契约

在已认证 Linux x64 Host 上，Pi Stuff 所有的 Tool Display 必须在 150 ms 内显示首个 Tool UI、输入回显与选择
反馈；Tool 活跃时，同一个可见 Vibe Line Spinner frame 不得保持不变超过 200 ms。共享的 500 ms 活性检查仍是
严重失败兜底。Host 原生 renderer 与第三方 renderer 不在该保证内。

## Running timer

`/ui` 中的 `Tool running timer` 默认开启。它只为长时间运行的活动行和 group 加入经过时间；结算摘要不会
保留 timer。

## 原生行为

Tool Display 只改变渲染。Tool schema、执行、权限、生命周期和结果数据仍由 Pi 负责。没有自有 renderer 的 call
保留 Pi 原生呈现。

## 相关文档

- [Tool Display Module README](../../packages/pi-stuff/src/tool-display/README.md)
- [Conversation UI](conversation-ui.md)
- [命令参考](../reference/commands.md)
- [DESIGN.md](../../DESIGN.md)
- [在 projection 前限制 Tool Display](../adr/0028-bound-tool-display-before-projection.md)
