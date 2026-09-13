# Subagent rewrite design

[简体中文](i18n/zh-CN/subagents-design.md) · English is normative.

Status: design discussion in [#64](https://github.com/jczhang02/pi-stuff/issues/64). This document records accepted decisions and the upstream capability inventory separately. Capability selection identifies the required features; inventory descriptions do not establish the rewrite's detailed runtime rules or implementation status.

## Accepted decisions

- Use @arhen/pi-core-subagent as the source for a fork and rewrite. Design the UI independently, without adopting upstream's UI design.
- Work in this order: establish core behavior, explore UI scenarios and prototypes, then settle implementation interfaces and structure. UI exploration may expose core behavior that needs revisiting.
- Decide capabilities individually. Tool names, parameters and configuration may be redesigned; upstream compatibility is not a requirement imposed on this design.
- Every supported capability needs acceptance in a real usage scenario. Parallel, serial and other supported execution modes each need their own acceptance coverage; one primary scenario cannot stand in for the full feature set.

The maintainer requested a plain feature inventory before capability selection. Q14 subsequently established the distinction between a subagent and a subagent task, recorded in [the glossary](../CONTEXT.md). The rules below record explicit answers; the inventory alone does not settle runtime semantics.

## Capability selection

Q3-Q9 confirmed all upstream capabilities F01-F29 as required. This includes execution modes and result delivery, task control, communication, role and resource configuration, limits and accounting, worktree management, persistence and lifecycle events. Every capability needs real-scenario acceptance coverage.

Retaining a capability does not accept upstream parameter names, default values or known defects. The accepted rules below specify selected behavior; other scheduling details and the form of result delivery remain open.

## Accepted additions

Q10-Q13 added the following capabilities to the rewrite. They extend the inspected upstream package and require their own real-scenario acceptance coverage.

| ID  | Capability                   | Accepted behavior and example                                                                                                                                                                                                        |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F30 | Completed-subagent follow-up | Ask a reviewer to check the revised code using its earlier context after its first report is complete. Q25 also requires restoring that context and allowing follow-up after a parent-session restart.                               |
| F31 | Optional parent-history copy | Start with a fresh context by default, but let the caller explicitly copy the parent's history at dispatch. For example, give a child the earlier design discussion when assigning implementation. Q19 specifies the snapshot below. |
| F32 | Recursive delegation         | Let a backend lead create database and API subagents. Impose depth and quantity limits, with shared tree limits and descendant lifetime rules specified in Q15-Q17 below.                                                            |
| F33 | Extension tools in children  | Let a researcher use an existing parent extension's web-search tool, subject to the role's tool allowlist and Q18's inherited tool ceiling. Tool loading remains to be decided.                                                      |

The accepted scope is F01-F33. These are design requirements, not implementation or acceptance-test results.

## Accepted task and context rules

- **Q14, identity and task history:** Retain the subagent's identity and context across assignments, with a separate execution record and result for each task. A review and its later re-review remain individually inspectable. Follow-up does not replace the earlier result or automatically rerun tasks that consumed it.
- **Q15, recursive limits:** The entire root task tree shares a concurrency limit and a cumulative creation limit, with an additional maximum depth. Three leads that each delegate four children do not receive independent allowances at every level. Q24 defines the boundary across dispatches; Q26 sets initial values and counting units.
- **Q16, completion:** A task cannot be marked complete until all its descendants have ended, even if its own subagent has returned a report. A backend lead is still pending while its database child is editing. Q23 defines how the parent handles descendant failure.
- **Q17, cancellation:** Cancelling a task cancels its entire descendant branch and prevents new descendants from starting. Retain existing records and code artifacts for inspection. Cancelling the backend lead also stops its database and API children.
- **Q18, tool ceiling:** A descendant's available tools cannot exceed its parent's tool scope. Role definitions and per-call choices can only narrow that scope. A read-only researcher cannot give a child write tools; it must ask an ancestor with the needed tools to arrange the work.
- **Q19, history snapshot:** Optional history copying takes the parent's complete visible conversation at dispatch, including tool calls and results. Already compacted history uses the existing summary. Later parent messages require explicit communication rather than automatic synchronization. A reviewer therefore receives the code and test logs visible at dispatch, not subsequent parent activity.

## Accepted scheduling, failure and recovery rules

- **Q20, busy-agent follow-up:** A new assignment to a busy subagent enters its queue. The subagent executes one task at a time. A reviewer finishes its login review before starting a queued payment review; a correction to its current review uses steering instead.
- **Q21, waiting and concurrency:** Explicitly waiting for descendants or an answer releases an execution slot. Resuming work requires rejoining the execution queue. Four leads waiting for children must not occupy all four slots and prevent those children from running.
- **Q22, dependency failure:** A failed dependency prevents its dependent tasks from starting, while unrelated branches continue. Report the blocking reason. If database investigation fails, work requiring its result remains blocked while an independent API investigation continues.
- **Q23, descendant failure:** Report a child's failure to its direct parent, allowing the parent to delegate again or complete the work itself. Keep the child's failure record. One child failure does not immediately cancel the whole tree or automatically make the parent fail; the parent can recover and still complete its assignment.
- **Q24, limits across dispatches:** All dispatches within the same main session share its total concurrency limit. Each top-level dispatch and all its descendants have their own cumulative creation allowance. Dispatching five researchers and then five reviewers cannot bypass the main session's concurrency limit.
- **Q25, restart recovery:** Restore subagent contexts and task records when reopening the parent session. Completed subagents can receive follow-up tasks. Unfinished tasks are marked interrupted and require explicit continuation by the main agent or user. Already executed write operations are not automatically replayed.

## Accepted limits, dependency scheduling and code handoff

- **Q26, configurable defaults:** Start with eight concurrent subagent tasks per main session, sixty-four cumulative tasks per top-level dispatch including descendants, and a maximum delegation depth of three with the main agent at depth zero. Initial tasks, recursive assignments and follow-ups count toward the task allowance; Pi's internal provider-request retries do not create another task. All three limits are configurable.
- **Q27, execution clock:** Count time spent in model and tool execution stages toward the task's execution limit. Exclude queueing and explicit waits for descendants or answers. Answer waiting has a separate timeout. A researcher waiting half an hour for an answer does not consume half an hour of execution time.
- **Q28, ready-task scheduling:** A task can start as soon as its own dependencies are satisfied and an execution slot is available. It does not wait for unrelated tasks in the same batch. API implementation can start after its thirty-second investigation while a five-minute database investigation continues.
- **Q29, dependency recovery:** Keep the original graph and its failure records after repairing a failed task. The main agent explicitly dispatches subsequent work referring to the new result. Do not automatically release the blocked tasks in the old graph when a replacement investigation succeeds.
- **Q30, write isolation:** Give each writable subagent task in a Git repository an independent worktree by default. If worktree creation fails, report startup failure rather than writing in the original directory. Two implementation agents retain separate code artifacts when editing concurrently.
- **Q31, combining code:** When several write tasks produce branches, explicitly assign an integration task to combine them and handle conflicts. Later tasks inherit the integration branch. A task with one upstream code branch inherits that branch directly.

These rules define required behavior for later scenario acceptance. The final state of dependency-blocked tasks, workspace baselines and retention, communication, timeout values and outcomes, and recovery when records or artifacts are incomplete still need decisions.

## Upstream capability inventory

Source: @arhen/pi-core-subagent 1.3.54 at [de1c878](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent). These descriptions come from static source inspection. They describe available behavior, not evidence that upstream passed scenario acceptance. Identifiers F01-F29 let subsequent decisions refer to a stable entry.

| ID  | Feature                                     | Existing behavior or usage example                                                                                                                                  |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | Single-task delegation and separate context | Give a child an investigation task. Its intermediate messages stay in its own Pi session; the parent receives its result.                                           |
| F02 | Parallel tasks                              | Run API and database investigations concurrently in one batch.                                                                                                      |
| F03 | Serial chain                                | Run investigation, implementation and review in order.                                                                                                              |
| F04 | Dependency graph                            | Declare task IDs in `needs`. Run ready tasks in waves, reject invalid graphs and skip dependents whose upstream tasks failed or were aborted.                       |
| F05 | Automatic upstream result delivery          | Prepend dependency outputs to the next task's prompt; substitute `{previous}` for the first upstream output.                                                        |
| F06 | Background execution and foreground waiting | Return a run ID immediately, or use `autoAwait` to wait for results. A child's question can end the wait so the parent can answer.                                  |
| F07 | Status and result queries                   | Retrieve a batch snapshot, child session paths, or the result of one task.                                                                                          |
| F08 | Bounded waiting                             | Stop waiting after a timeout while child execution continues. Child messages can also wake a wait.                                                                  |
| F09 | Completion and failure notifications        | Inform the parent when tasks or the batch finish, with failure notifications delivered promptly.                                                                    |
| F10 | Cancellation                                | Cancel a batch through a public tool. Single-task cancellation also exists in the manager, currently invoked by the upstream UI.                                    |
| F11 | Continue a failed or aborted task           | Reopen a saved child session and reattach its branch where available. Requires a settled batch and a task that created a session.                                   |
| F12 | Steering                                    | Send an additional instruction to one running child or the running children in a batch.                                                                             |
| F13 | Child-to-parent questions                   | A child blocks in `ask_parent`; the parent answers through `reply_subagent`. An unanswered question has a ten-minute cap.                                           |
| F14 | Child-to-parent updates                     | A child reports a finding and continues without waiting for an answer.                                                                                              |
| F15 | Sibling mailbox                             | Children in the same batch send short messages to each other and poll their mailboxes.                                                                              |
| F16 | Inline role definition                      | Supply a task-specific agent name and system prompt without creating a role file first.                                                                             |
| F17 | Role files                                  | Discover Markdown agent files in project/user directories. Upstream selects a matching file by description overlap with the task goal.                              |
| F18 | Model and thinking selection                | Configure the child's model and thinking level; role-file defaults can affect resolution.                                                                           |
| F19 | Tool selection                              | Choose the read-only/write toolset or an explicit built-in tool allowlist. Child communication tools are also installed.                                            |
| F20 | Working-directory selection                 | Run a task in a specified repository or subdirectory.                                                                                                               |
| F21 | Project rules and skills                    | Load AGENTS.md and configured skills through Pi's resource loader for the child's working directory. This is not an arbitrary extension-tool loader.                |
| F22 | Concurrency and batch-size limits           | Limit concurrent tasks within a batch; upstream accepts at most sixteen tasks in one batch.                                                                         |
| F23 | Execution-time limit                        | Configure `maxRuntimeMs`; the prompt execution stage enters timeout handling when its time limit expires.                                                           |
| F24 | Provider retry through Pi                   | Use Pi's configured retry behavior for retryable provider/network failures. This does not rerun arbitrary failed tasks or failed tests.                             |
| F25 | Usage accounting                            | Record input/output/cache tokens, cost and turns, with batch totals. No hard token or monetary budget is enforced.                                                  |
| F26 | Worktree and change management              | Create worktrees for write tasks, commit changes, report branches and diffs, preserve partial work and clean up eligible worktrees.                                 |
| F27 | Upstream branch inheritance                 | Start a dependent write task from one completed upstream branch, so it sees that task's code changes.                                                               |
| F28 | Task records and transcripts                | Persist batch/task snapshots and session/branch references in a sidecar, and keep child session transcripts. Saved records can be restored on parent session start. |
| F29 | Lifecycle events                            | Publish lifecycle events through Pi's event bus for other extensions to observe.                                                                                    |

The source groups behind this inventory are [public tools and lifecycle wiring](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/index.ts), [task schemas](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/schemas.ts), [graph scheduling](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/graph.ts), [child communication](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/child.ts), [role resolution](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/agentfile.ts), [execution manager](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/manager.ts), and [worktree operations](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/worktree.ts).

## Upstream boundaries and rewrite decisions

- F10 has a known initialization-time cancellation gap: a later state update can overwrite cancellation and allow execution to continue. A dedicated pause operation is absent; cancellation followed by F11 is only a partial substitute.
- F11 accepts failed/aborted tasks, not completed-task follow-ups. An explicit replacement model can also be overridden again by a matching role file.
- F21 disables extensions in the child loader. Loading project rules/skills does not establish extension-tool inheritance.
- F26 can fall back to editing the original directory when worktree creation fails; Q30 replaces this with startup failure. Dependencies in node_modules are shared through a symlink rather than isolated. Commits are saved for parent review; automatic merge is not an upstream runtime feature.
- F27 selects one completed upstream branch, not a merge of all upstream branches. Q31 requires an explicit integration task when several branches must be combined.
- F28 writes the sidecar at whole-run settlement. It is not continuous crash-safe checkpointing, and restoring records does not automatically replay the workflow.

The upstream gaps in completed-session follow-ups, parent-history copying, child-created subagents and extension-tool loading are addressed by accepted additions F30-F33; their detailed semantics remain open.

Other capabilities absent from upstream include runtime graph mutation, saved workflow templates, conditional loops, automatic acceptance gates, human approval nodes, model-output schemas, hard usage budgets, cross-run role memory, external-agent backends and periodic scheduling. These have not been accepted into the rewrite scope.
