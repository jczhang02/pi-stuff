# Subagent redevelopment decisions

[简体中文](i18n/zh-CN/subagents-redevelopment.md). English is authoritative.

Status: decision interview opened on 2026-09-20. Tracked in [#97](https://github.com/jczhang02/pi-stuff/issues/97), under [#64](https://github.com/jczhang02/pi-stuff/issues/64). This record supersedes the previous specification as the direction for the next implementation. It is not a completed specification or authorization to begin implementation before the interview is confirmed.

## Confirmed direction

1. Redevelop the subagent capability around arhen's `pi-core-subagent`, using upstream behavior as the baseline and recording each approved deviation. Rewrite the source to meet all repository engineering rules, including Effect. The previous independent implementation is not the new baseline.
2. Other packages and harnesses in the existing research may supply proposals for useful features or implementation techniques. A proposal is not accepted scope. Previous additions do not carry over automatically.
3. Use the current UI design as the starting point, then discuss the complete UI again against the selected runtime capabilities. Existing screens and shortcuts are not automatically final.

The previous code, tests, research, decisions and session records remain available as evidence. This decision does not authorize deleting them, migrating stored sessions, changing dependencies or waiving repository engineering rules. The previous F/B/U checklist and its passing tests do not establish acceptance for the redevelopment.

## Verified reference

The previous research reference is [`@arhen/pi-core-subagent` 1.3.54 at `de1c8783`](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent). The source comparison now also covers [1.3.55 at `676b11eb`](https://github.com/arhen/pi-extensions/tree/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent): that package increment records provider/thinking metadata and displays it beside the task name. It does not replace the execution or worktree model described below. These are inspected references; the exact import revision will be recorded before implementation.

Upstream starts read-only agents in their selected current directory. Tasks with write-capable tools receive a Git worktree when available. Worktrees start from HEAD or an upstream task branch and share `node_modules` through a symlink. Upstream exposes several model-facing tools. These are source facts, not new design choices. See [manager.ts](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/manager.ts) and [worktree.ts](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/worktree.ts).

Consequently, write-task worktrees do not automatically include uncommitted changes from the parent directory; read-only tasks using that directory can see those changes. The shared `node_modules` symlink also means dependency writes are not isolated by the worktree. These limits belong to the upstream baseline, not a new snapshot or sandbox guarantee. Its dependency scheduler waits for all tasks in the current ready wave to finish before scheduling the next wave. See the inspected [worktree implementation](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/worktree.ts#L70-L98) and [wave scheduler](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/graph.ts#L91-L115).

The previous implementation instead captures a baseline before default read-only work. Its full ignored-file status scan produced 1,749,620 bytes in the real development checkout, exceeding its 1 MiB Git output limit. Of that output, 1,748,388 bytes came from 28,085 `node_modules` entries. Calling the actual Git wrapper reproduced the reported error twice before model execution. This defect belongs to the previous implementation; upstream does not use that scan. Prior small-project acceptance did not cover this condition.

## Decision tree

The first round resolved the redevelopment boundary:

- How closely the source structure must remain tied to upstream, beyond matching behavior.
- Whether the earlier single-tool preference survives the return to upstream's multiple tools.
- How to distinguish a demonstrated defect repair from a deliberate change in upstream behavior.
- Whether the new implementation must continue sessions created by the previous implementation.

The accepted answers below govern engineering adaptation, selected repairs and optional additions. Internal modernization does not authorize new lifecycle states, capabilities or persistence guarantees. Once the runtime scope is settled, revisit the UI through concrete launch, progress, inspection, communication, cancellation and recovery scenarios. Acceptance must then cover the real project with installed dependencies as well as controlled fixtures.

Questions and recommendations remain proposals until answered. Record each accepted answer here as the interview proceeds. Add glossary entries only when domain terms are resolved, and ADRs only when a consequential trade-off needs a durable explanation. Do not put implementation notes in the glossary.

## Round 1 decisions, accepted on 2026-09-20

**RQ01. Rewrite under all repository engineering rules.** The maintainer rejected the proposed exception for retained upstream code. The entire implementation must satisfy strict TypeScript, code quality and [ADR 0002](adr/0002-effect-quality.md), including Effect for boundaries, typed errors and necessary I/O. Pure algorithms remain ordinary functions under that ADR. Refactor upstream source as needed while preserving its behavioral baseline, except for explicitly accepted changes. Do not weaken checks or add blanket exclusions. See [ADR 0005](adr/0005-subagent-redevelopment.md).

**RQ02. One model-facing `subagent` tool.** The maintainer chose a single tool instead of the recommendation to preserve the upstream parent tool set. Its operations must cover the selected upstream capabilities; consolidating the entry point does not add authority or resurrect previous implementation features. Exact parameters will follow the settled behavior, rather than inheriting the previous protocol wholesale.

**RQ03. Fail the launch when worktree initialization fails.** The maintainer accepted this behavior repair: stop with a clear error instead of automatically running the write-capable task in the source directory. Writing there requires an explicit decision. This does not authorize a new workspace-mode system. Reproduce the upstream failure path before implementing the patch.

**RQ04. No compatibility requirement for previous implementation records.** The new implementation need not migrate or resume sessions created by the previous implementation. Preserve old code and records, keep storage separate and do not reinterpret incompatible records as new work. The maintainer has not authorized deleting old data.

## Round 2 proposals, awaiting answers

**RQ05. Allow another prompt after a task has completed?** Upstream resumes failed or aborted tasks with a saved session, but explicitly rejects completed tasks. Example: a reviewer delivers a report, the main agent fixes the code, and the same reviewer checks the fix with its previous context. Recommendation: add this capability using the existing Pi session mechanism. This is a deliberate lifecycle extension, not a defect repair. If accepted, settle how results and workspaces behave before implementation; acceptance does not automatically reinstate the previous assignment framework or rerun dependencies. Source: [resumeTask](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L1333-L1365).

**RQ06. Enable extension tools inside child sessions in this redevelopment?** Example: a researcher uses an installed web-search extension directly. Upstream disables extension loading; gotgenes provides a reference for child-owned resource loading and tool filtering. Recommendation: defer this addition for the first redevelopment and retain the upstream tool boundary. The parent can supply research results. Supporting extensions requires deciding initialization, cleanup and tool access, not merely exposing another tool name. Source: [arhen child resource loading](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L853-L877) and [gotgenes child session creation](https://github.com/gotgenes/pi-packages/blob/bebfa283fc6a0b8867399b4fcc9dc5997817e9ca/packages/pi-subagents/src/lifecycle/create-subagent-session.ts).

## Current phase

The current work is source/research verification and the decision interview. Preserve the existing task owner, implementation branch and other worktrees. [PR #98](https://github.com/jczhang02/pi-stuff/pull/98) represents the previous implementation and is not a redevelopment acceptance candidate. No new runtime code, UI prototype, merge or release is authorized by this interview phase.
