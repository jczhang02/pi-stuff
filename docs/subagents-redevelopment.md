# Subagent redevelopment decisions

[简体中文](i18n/zh-CN/subagents-redevelopment.md). English is authoritative.

Status: runtime scope settled on 2026-09-20 through RQ01-RQ10; UI discussion comes next. Tracked in [#97](https://github.com/jczhang02/pi-stuff/issues/97), under [#64](https://github.com/jczhang02/pi-stuff/issues/64). This record supersedes the previous specification as the direction for the next implementation. It is not yet a complete specification or authorization to start implementation before the UI discussion is confirmed.

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

## Discussion scope

The first round resolved the redevelopment boundary:

- How closely the source structure must remain tied to upstream, beyond matching behavior.
- Whether the earlier single-tool preference survives the return to upstream's multiple tools.
- How to distinguish a demonstrated defect repair from a deliberate change in upstream behavior.
- Whether the new implementation must continue sessions created by the previous implementation.

RQ01-RQ10 now settle the runtime scope. Follow upstream behavior for matters not changed by these decisions, and use the simplest repository-compliant implementation that satisfies them. The maintainer asked to stop introducing unnecessary boundary questions. Do not grow the interview with hypothetical cases or add mechanisms for them; raise a further runtime decision only when concrete source or verification evidence exposes a conflict that prevents the agreed behavior.

Next, revisit the current UI through concrete launch, progress, inspection, communication, cancellation and follow-up scenarios. Acceptance must cover the real project with installed dependencies as well as controlled fixtures. Existing research remains supporting evidence, not a source of automatically added requirements.

## Round 1 decisions, accepted on 2026-09-20

**RQ01. Rewrite under all repository engineering rules.** The maintainer rejected the proposed exception for retained upstream code. The entire implementation must satisfy strict TypeScript, code quality and [ADR 0002](adr/0002-effect-quality.md), including Effect for boundaries, typed errors and necessary I/O. Pure algorithms remain ordinary functions under that ADR. Refactor upstream source as needed while preserving its behavioral baseline, except for explicitly accepted changes. Do not weaken checks or add blanket exclusions. See [ADR 0005](adr/0005-subagent-redevelopment.md).

**RQ02. One model-facing `subagent` tool.** The maintainer chose a single tool instead of the recommendation to preserve the upstream parent tool set. Its operations must cover the selected upstream capabilities; consolidating the entry point does not add authority or resurrect previous implementation features. Exact parameters will follow the settled behavior, rather than inheriting the previous protocol wholesale.

**RQ03. Fail the launch when worktree initialization fails.** The maintainer accepted this behavior repair: stop with a clear error instead of automatically running the write-capable task in the source directory. Writing there requires an explicit decision. This does not authorize a new workspace-mode system. Reproduce the upstream failure path before implementing the patch.

**RQ04. No compatibility requirement for previous implementation records.** The new implementation need not migrate or resume sessions created by the previous implementation. Preserve old code and records, keep storage separate and do not reinterpret incompatible records as new work. The maintainer has not authorized deleting old data.

## Round 2 decisions, accepted on 2026-09-20

**RQ05. Allow follow-up after completion.** The maintainer accepted another request to the same subagent with its previous conversation context. For example, a reviewer can check a fix after delivering its first report. Upstream resumes failed or aborted tasks with a saved session but explicitly rejects completed tasks, so this is an approved lifecycle addition. RQ07-RQ08 define result retention and workspace continuation. Source: [resumeTask](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L1333-L1365).

**RQ06. Include child extension tools in this redevelopment.** The maintainer chose to include this capability now rather than defer it. A researcher may use an extension tool such as web search directly. Upstream disables extension loading; gotgenes provides a reference for child-owned resource loading and tool filtering. RQ09-RQ10 define tool selection and compatibility behavior. Source: [arhen child resource loading](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L853-L877) and [gotgenes child session creation](https://github.com/gotgenes/pi-packages/blob/bebfa283fc6a0b8867399b4fcc9dc5997817e9ca/packages/pi-subagents/src/lifecycle/create-subagent-session.ts).

## Round 3 decisions, accepted on 2026-09-20

**RQ07. Keep a report and usage record for each request.** Retain each request's report, status, elapsed time and usage while continuing the same conversation context; also provide cumulative usage for the subagent. A reviewer's first report remains available after a follow-up review. Continuing a task does not automatically rerun its dependencies or downstream tasks. Upstream overwrites the task's final report and start time while accumulating usage, so per-request records are an approved addition. Sources: [resume resets](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L1333-L1411) and [task snapshot](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/types.ts#L18-L65).

**RQ08. Continue a write-capable subagent from its own code branch.** Continue from its previous workspace/branch, preserving its code; reattach the branch if only the worktree directory was cleaned up. For example, an implementer adds tests on top of its earlier patch. Do not automatically import parent-directory changes. If the required code state cannot be recovered, report that failure under RQ03 rather than substituting a different baseline. Read-only reviewers continue to read the current contents of their selected directory. Sources: [worktree attachment](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L768-L813) and [completion handling](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L950-L1003).

**RQ09. Limit inherited extension tools to the parent's active tools, narrowed by role.** Select from extensions already loaded by the parent, cap their callable tools at the parent's active tool set, and let the role narrow that set. For example, a researcher receives search while an implementer may receive editing. Preserve the upstream child communication tools; extension loading does not make the parent delegation tool available to children. Each child loads and binds its selected extension sources in its own session. Tool filtering is not a sandbox and does not suppress extension initialization side effects. Reference: [gotgenes session creation](https://github.com/gotgenes/pi-packages/blob/bebfa283fc6a0b8867399b4fcc9dc5997817e9ca/packages/pi-subagents/src/lifecycle/create-subagent-session.ts#L219-L287).

**RQ10. Support child extensions that work without interactive UI.** Fail the child launch if a selected extension or required tool cannot load or bind. If a tool later requests unsupported UI, return an explicit unsupported-operation error for the parent to handle. Do not silently omit required tools or automatically forward UI to the parent. Verify supported extensions against this requirement: Pi's default headless UI returns empty selections and does not itself establish compatibility.

## Current phase

The runtime interview is closed with RQ01-RQ10 accepted. The next phase is to revisit the UI using the current design and agreed capabilities. Preserve the existing task owner, implementation branch and other worktrees. [PR #98](https://github.com/jczhang02/pi-stuff/pull/98) represents the previous implementation and is not a redevelopment acceptance candidate. Implementation and runtime acceptance remain pending; this documentation update does not authorize a merge or release.
