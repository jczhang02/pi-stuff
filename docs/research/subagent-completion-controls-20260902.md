# Subagent Completion-Control Reference for ps-qer

[Simplified Chinese](../i18n/zh-CN/docs/research/subagent-completion-controls-20260902.md)

**Date:** 2026-09-02  
**Question:** Should ordinary delegated Agent work end at fixed Assistant-turn or Tool-call counts?  
**Local snapshot:** Pi Stuff `124dcbf92de847e4c5d845509b9b839a283aeb31`, certified Pi `0.84.4`

## Conclusion

No. A fixed turn or Tool count is a safety signal at most; it is not evidence that a delegated objective is complete.
Ordinary Agents should run until they produce a final answer or encounter a real terminal condition. Any abnormal stop must
remain visibly incomplete, preserve the best available evidence, and support continuation from the retained child Session.

For ps-qer, the upstream-aligned correction is to remove the mandatory `64 + 2` turn budget rather than tune it, and to
remove the mandatory `96 / 128` Tool budget while retaining Tool budgets as an explicit expert control. Elapsed deadlines,
per-Tool timeouts, explicit stop, launch and nesting limits, Provider failures, and Context capacity remain independent
safety boundaries. None of them may be projected as successful completion.

## Compared systems

### Pi 0.84.4

Pi's native Agent loop has no fixed turn counter. It continues while the Assistant requests Tools or while steering or
follow-up messages remain, and ends naturally when none remain. The optional `shouldStopAfterTurn` hook exits only after
the current Assistant response and Tool executions finish; it is an opt-in graceful-stop seam, not a default completion
policy. See [`agent-loop.ts:153-272`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts#L153-L272)
and [`types.ts:212-258`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/types.ts#L212-L258).

### Current Claude Code and Agent SDK

Claude Code's current subagent `maxTurns` is optional. When configured and reached, the result is marked partial and a
resumable Agent ID is returned for eligible Agent types. Resumption retains the child conversation and continues from the
stopping point. See [Create custom subagents](https://code.claude.com/docs/en/subagents#supported-frontmatter-fields)
and [Resume subagents](https://code.claude.com/docs/en/subagents#resume-subagents).

The Agent SDK likewise defaults both `maxTurns` and `maxBudgetUsd` to no limit. Hitting either produces an error subtype,
not success; the result retains Session identity and usage/cost telemetry so the caller can decide whether to resume. See
[How the agent loop works](https://code.claude.com/docs/en/agent-sdk/agent-loop#turns-and-budget).

This is a useful contract distinction: an explicit guard may stop work, but it must report partial/error and preserve a
continuation path. It is not an ordinary completion mechanism.

### Public Claude Code source snapshot

The previously inspected `tanbiralam/claude-code` snapshot is unlicensed, incomplete, and of uncertain product version.
It is behavior evidence only and must not be copied or mechanically translated. Its `maxTurns` field is optional, child
messages are persisted in a sidechain under an Agent ID, and finalization falls back to the latest Assistant text when the
last message contains only Tool use. However, its max-turn path could still fall through to a `completed` result, which is
exactly the ambiguity that current official documentation now resolves with explicit partial marking. See
[`runAgent.ts:750-787`](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/runAgent.ts#L750-L787),
[`agentToolUtils.ts:276-347`](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/agentToolUtils.ts#L276-L347),
and [`AgentTool.tsx:1218-1259`](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/AgentTool.tsx#L1218-L1259).

### pi-subagents 0.63.0

The current upstream Package removed turn-budget launch controls, prompt injection, and hard termination in
[`#1579`](https://github.com/nicobailon/pi-subagents/pull/1579). The owning issue records the reason: turn counts had
repeatedly killed productive implementation work and did not measure safety or delivery quality. See
[`#1577`](https://github.com/nicobailon/pi-subagents/issues/1577).

Current source retains turn-budget types only to decode historical artifacts; new runs do not enforce them. Tool and usage
budgets remain optional with no default. A Tool hard limit blocks only configured Tools and never blocks final Assistant
text. A usage hard limit prevents later child launches after reported usage is reconciled; it does not terminate children
already running. See
[`types.ts:271-289`](https://github.com/nicobailon/pi-subagents/blob/4f7eb2b56dc5306416920db8c6e222c7aaad3c81/src/shared/types.ts#L271-L289)
and [`tool-reference.md:111-114`](https://github.com/nicobailon/pi-subagents/blob/4f7eb2b56dc5306416920db8c6e222c7aaad3c81/docs/tool-reference.md#L111-L114).

## Current Pi Stuff divergence

Pi Stuff currently supplies a turn budget and an all-Tool budget even when the caller omits both:

- `DEFAULT_AGENT_TURN_BUDGET` is `64` ordinary turns plus `2` grace turns in
  [`turn-budget.ts`](../../packages/pi-stuff/src/subagents/src/runs/shared/turn-budget.ts).
- `DEFAULT_AGENT_TOOL_BUDGET` is soft `96`, hard `128`, with `block: "*"` in
  [`tool-budget.ts`](../../packages/pi-stuff/src/subagents/src/runs/shared/tool-budget.ts).
- [`resolved-task.ts`](../../packages/pi-stuff/src/subagents/src/runs/background/resolved-task.ts) installs both defaults
  for every ordinary task.
- [`child-protocol-runtime.ts`](../../packages/pi-stuff/src/subagents/src/runs/background/child-protocol-runtime.ts)
  forces turn-budget termination even when the Assistant is starting Tool work.

The credential-backed ps-qer baseline is consistent with that divergence: all six representative reviewer attempts ended
at the exact `64 + 2` boundary without a final deliverable. Raising the number would move the failure; it would not make
turn count a completion signal.

## Direction for ps-qer

1. Remove turn-budget enforcement and its ordinary launch/configuration surface; retain only legacy decoding where old
   persisted evidence requires it.
2. Make Tool budgets opt-in again. Do not silently install an all-Tool hard limit on ordinary delegated work.
3. Let Pi's native Agent loop own normal completion: a final text response with no more Tool work ends the child.
4. Treat timeout, explicit stop, Provider failure, Context exhaustion, and any explicit budget as abnormal terminal
   outcomes. Return bounded partial evidence, usage, a truthful reason, and a resumable child identity.
5. Keep cost observable across attempts and resumes. A default orchestration cost guard should prevent additional launches
   or request attention rather than kill productive work solely because it used many turns or Tools.
6. Keep legacy flat-artifact reconciliation separate; it does not justify changing live completion semantics.

This direction reuses Pi and the upstream Package's existing ownership model. It does not require a convergence heuristic,
a second Agent loop, or a Context Management lifecycle.

## Implementation follow-up

The “Current Pi Stuff divergence” section records the pre-fix snapshot named at the top of this study; it is not the
current behavior. Runtime candidate `c4ab125c750f5d005277c384d15dd506c1609746` removes both ordinary default budgets,
adds durable cumulative work accounting and abnormal-outcome projection, and quarantines unowned versionless legacy
records. The upstream disposition is recorded in the
[v0.63.0 synchronization ledger](pi-subagents-v0.63-synchronization-20260902.md); scrubbed credential-backed metrics and
final certification are recorded in the [ps-qer acceptance report](../reports/ps-qer-agent-completion-acceptance-20260902.md).
