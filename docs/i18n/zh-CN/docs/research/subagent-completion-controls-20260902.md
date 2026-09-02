<!-- translation-source: docs/research/subagent-completion-controls-20260902.md; translation-source-sha256: 9456bb143c241dde73443be741b0572d544a019d829107aaf978db2a1d1d9516 -->

# ps-qer 的 Subagent 完成控制参考

[English](../../../../../docs/research/subagent-completion-controls-20260902.md)

**日期：** 2026-09-02  
**问题：** 普通委派的 Agent 工作是否应在固定 Assistant turn 或 Tool 调用次数处结束？  
**本地快照：** Pi Stuff `124dcbf92de847e4c5d845509b9b839a283aeb31`，认证 Pi `0.84.4`

## 结论

不应该。固定 turn 或 Tool 次数至多是一种安全信号，并不能证明委派目标已经完成。普通 Agent 应持续运行，
直到给出最终答案或遇到真实终止条件。任何异常停止都必须明确保持为未完成状态，保存当前最佳证据，并支持
从保留的子 Session 继续。

对于 ps-qer，与上游一致的修正方向是移除强制的 `64 + 2` turn budget，而不是调整其数值；同时移除强制的
`96 / 128` Tool budget，但保留 Tool budget 作为显式专家控制。运行时限、单 Tool 超时、显式停止、启动与嵌套
限制、Provider 故障和 Context 容量仍是相互独立的安全边界。它们都不能被投影成成功完成。

## 对比系统

### Pi 0.84.4

Pi 原生 Agent loop 没有固定 turn 计数器。只要 Assistant 仍在请求 Tool，或仍有 steering/follow-up 消息，
它就会继续；都不存在时才自然结束。可选的 `shouldStopAfterTurn` hook 只会在当前 Assistant 响应和 Tool 执行
全部完成后退出；它是选择性启用的优雅停止接缝，不是默认完成策略。参见
[`agent-loop.ts:153-272`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts#L153-L272)
和 [`types.ts:212-258`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/types.ts#L212-L258)。

### 当前 Claude Code 与 Agent SDK

Claude Code 当前的 subagent `maxTurns` 是可选项。配置后若达到上限，结果会标记为 partial；对于符合条件的
Agent 类型，还会返回可恢复的 Agent ID。恢复会保留子会话并从停止位置继续。参见
[创建自定义 subagent](https://code.claude.com/docs/en/subagents#supported-frontmatter-fields)和
[恢复 subagent](https://code.claude.com/docs/en/subagents#resume-subagents)。

Agent SDK 的 `maxTurns` 与 `maxBudgetUsd` 默认同样都不设上限。达到任一上限会产生 error subtype，而不是
success；结果会保留 Session 身份及 usage/cost 遥测，由调用方决定是否恢复。参见
[Agent loop 的工作方式](https://code.claude.com/docs/en/agent-sdk/agent-loop#turns-and-budget)。

这里有一条重要的契约分界：显式 guard 可以停止工作，但必须报告 partial/error 并保留继续路径；它不是普通
完成机制。

### 公开的 Claude Code 源码快照

先前检查的 `tanbiralam/claude-code` 快照没有许可证、并不完整，而且无法确定对应产品版本。它只能作为行为
证据，不能复制或机械翻译。其中的 `maxTurns` 是可选项；子消息以 Agent ID 持久化在 sidechain 中；若最后一条
消息只有 Tool use，收尾逻辑会回退到最近的 Assistant 文本。不过，它的 max-turn 路径仍可能落入
`completed` 结果，这正是当前官方文档用明确 partial 标记消除的歧义。参见
[`runAgent.ts:750-787`](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/runAgent.ts#L750-L787)、
[`agentToolUtils.ts:276-347`](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/agentToolUtils.ts#L276-L347)
和 [`AgentTool.tsx:1218-1259`](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/AgentTool.tsx#L1218-L1259)。

### pi-subagents 0.63.0

当前上游 Package 在 [`#1579`](https://github.com/nicobailon/pi-subagents/pull/1579) 中删除了 turn-budget
启动控制、prompt 注入与硬终止。对应 issue 记录了原因：turn 次数曾反复杀死仍有产出的实现工作，而且不能
衡量安全性或交付质量。参见 [`#1577`](https://github.com/nicobailon/pi-subagents/issues/1577)。

当前源码只保留 turn-budget 类型来解码历史 artifacts，新运行不再执行它。Tool budget 与 usage budget 均为
无默认值的可选配置。Tool 硬上限只阻止配置指定的 Tools，永远不会阻止最终 Assistant 文本。usage 硬上限在
已报告用量完成对账后阻止后续子 Agent 启动，但不会终止已经运行的子 Agent。参见
[`types.ts:271-289`](https://github.com/nicobailon/pi-subagents/blob/4f7eb2b56dc5306416920db8c6e222c7aaad3c81/src/shared/types.ts#L271-L289)
和 [`tool-reference.md:111-114`](https://github.com/nicobailon/pi-subagents/blob/4f7eb2b56dc5306416920db8c6e222c7aaad3c81/docs/tool-reference.md#L111-L114)。

## 当前 Pi Stuff 的偏离

即使调用方没有提供预算，Pi Stuff 当前也会强制提供 turn budget 与阻止所有 Tools 的预算：

- `DEFAULT_AGENT_TURN_BUDGET` 是 `64` 个普通 turns 加 `2` 个 grace turns，位于
  [`turn-budget.ts`](../../../../../packages/pi-stuff/src/subagents/src/runs/shared/turn-budget.ts)。
- `DEFAULT_AGENT_TOOL_BUDGET` 是 soft `96`、hard `128`、`block: "*"`，位于
  [`tool-budget.ts`](../../../../../packages/pi-stuff/src/subagents/src/runs/shared/tool-budget.ts)。
- [`resolved-task.ts`](../../../../../packages/pi-stuff/src/subagents/src/runs/background/resolved-task.ts) 为每个普通
  task 安装这两个默认值。
- [`child-protocol-runtime.ts`](../../../../../packages/pi-stuff/src/subagents/src/runs/background/child-protocol-runtime.ts)
  即使 Assistant 正准备开始 Tool 工作，也会强制执行 turn-budget 终止。

带凭据的 ps-qer 基线与这一偏离完全一致：六个代表性 reviewer 的第一次尝试都精确停在 `64 + 2` 边界，
且没有最终交付物。提高数值只会移动失败位置；它不会让 turn 次数变成完成信号。

## ps-qer 的方向

1. 删除 turn-budget 执行及其普通启动/配置界面；仅在旧持久化证据需要时保留历史解码。
2. 让 Tool budget 恢复为 opt-in，不再为普通委派工作静默安装阻止全部 Tools 的硬上限。
3. 让 Pi 原生 Agent loop 拥有普通完成：没有更多 Tool 工作的最终文本响应结束子 Agent。
4. 将 timeout、显式停止、Provider 故障、Context 耗尽和任何显式预算视为异常终止。返回有界 partial 证据、
   usage、真实原因和可恢复的子 Agent 身份。
5. 跨 attempts 与 resumes 保持成本可观察。默认编排成本 guard 应阻止后续启动或请求关注，而不是仅因使用了
   很多 turns 或 Tools 就杀死仍有产出的工作。
6. 将旧 flat-artifact 的协调保持为独立问题；它不能成为改变实时完成语义的理由。

这一方向复用 Pi 与上游 Package 的现有所有权模型，不需要收敛启发式、第二套 Agent loop 或 Context
Management 生命周期。

## 实现后续

“当前 Pi Stuff 的偏离”一节记录的是本文开头注明的修复前快照，并非当前行为。Runtime candidate
`c4ab125c750f5d005277c384d15dd506c1609746` 已移除两个普通默认 budget，加入持久累计 work accounting 与
异常 outcome 投影，并隔离没有 owner 的无版本 legacy record。上游处置见
[v0.63.0 同步台账](pi-subagents-v0.63-synchronization-20260902.md)；经过清理的带凭据 metrics 与最终认证见
[ps-qer 验收报告](../reports/ps-qer-agent-completion-acceptance-20260902.md)。
