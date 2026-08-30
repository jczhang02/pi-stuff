<!-- translation-source: docs/adr/0023-use-a-closed-operation-block-family.md; translation-source-sha256: 9c020ac80c8ef8347e465e69facd4764875dcd14353003adcead872f616e4c9d -->

---
status: accepted
---

# 使用封闭的 Operation Block family

## 背景

Tool UI 有两个独立 surface。Transcript 包含 Compact 与 Expanded；`/tools` 包含 List 与 Detail，Detail 内又有 Formatted 与 Raw。此前通用 standalone Tool row 无法为文件修改保留足够证据，但若让所有 Tool 都采用 Bash-like shape，又会抹掉有用的 domain distinction。

ADR 0022 已经把 grouping 限制为 native retrieval。本决策只处理 independent Tool Activity，不改变 Retrieval Group membership。

## 决策

Pi Stuff 只对 Bash、Write、Edit、Patch、`action=output` 的 `background`，以及没有 nested Tool 或 media projection 表示的外层 Code Mode error、rejection 或 cancellation 使用 **Operation Block**。Transcript grammar 必须是 `Tool(operation identity)` parent，下一行是缩进的 `⎿ outcome evidence`。括号是 grammar 的一部分。任何 presentation metadata 都不能把其他 Tool 加入这个封闭 family。

Write 使用 `Write(path)`，报告 `N lines written`，并显示语法高亮的最终内容而不是 diff。Compact 显示十行和精确 omitted-line expansion hint；Expanded 上限为 240 行和 24 KiB。Edit 使用 `Edit(path)`，显示精确 `+A/-D` 统计和语法高亮的 old/new-line diff。Patch 对单文件使用 `Patch(path)`，多文件使用 `Patch(N files)`，随后显示总计和逐文件 `M/A/D/R` 统计及有界 changed-line evidence。Compact diff evidence 上限为 2 KiB 和十条 changed line，每个 Patch file 最多四条 changed line，另带相邻 context；Expanded diff evidence 上限为 240 行和 24 KiB。每次触顶都报告精确 omitted amount。纯 rename 报告 `+0/-0` 与 `renamed without content changes`。存在 content evidence 时省略 generic mutation-success prose。Error、rejection、cancellation、partial-write 和 unavailable-evidence state 保留显式 state，且绝不从未经验证的 argument 推断成功 evidence。

direct Bash cancellation 只有在之后出现的明确 empty Host abort record 将紧邻且仍 in-flight 的 Bash Tool Activity settle 时，才拥有一个可见 authority。partial output 保留在该 cancelled Operation Block 上，Compact 与 Expanded 都不再增加第二个 Envelope Fallback error。缺少该 Host abort evidence 时，exit code 128 仍是 error。

成功的 pure JavaScript Code Mode 不显示 outer row：nested Tool 与 media 是其可见 authority。只有这些 projection 无法表示的 outer issue 才获得 fallback Operation Block。

`subagent` Tool 改用 **Agent Lifecycle Row**。Foreground work 标识 Agent、Task、state 和有意义的 duration；Expanded 列出每个 member 和有界 foreground result evidence。Background launch 与随后模型不可见的 completion row 保持为分开的 chronological event。`/agents` 继续作为唯一 live control 与完整 evidence authority。

Operation Block grammar 只属于 Transcript。`/tools` List row 显示 identity、operation、outcome 与显式 state。Formatted Detail 使用 Tool-specific semantic section；Raw 继续作为完整有界 protocol inspection authority。Formatted 与 Raw 是同一个 selected call 的两种 representation，不是两个独立 Dialog mode。

## 结果

Native Grep/Find、List，以及 exact resolved `SKILL.md` 例外之外的 Read，仍是仅有的 Retrieval Group member。exact `SKILL.md` Read 使用独立 Skill Tool Activity。MCP、Web、media、Agent、Task、Goal、Context 与 infrastructure Tool 保留 domain-specific row。文件修改可以直接在 Compact 与 Expanded Transcript UI 中检查；`/tools` 在不复制 Transcript `⎿` shape 的前提下，同时保留可读 semantic detail 与精确 protocol evidence。
