# Four selected Pi subagent implementations

[Chinese reading reference](../i18n/zh-CN/research/pi-selected-subagent-comparison.md). English is authoritative.

Research date: **2026-09-11**. This supplements the [earlier download-filtered comparison](pi-subagent-fork-comparison.md). The maintainer selected these four implementations explicitly; download volume is descriptive here, not an eligibility gate. The question is which source makes the best fork foundation for developing Pi Stuff with Pi Stuff.

**Recommendation: start with ogul's task-control design if the first feature is ordinary Pi delegation: spawn, wait, inspect, send another instruction, interrupt, and continue the same child conversation.** Its 2,703 production code lines cover that loop without owning the repository's Git workflow. Arhen is the stronger alternative when child-to-parent questions, sibling messages and dependency scheduling are first-release requirements. Henry fits prescribed role workflows; Davis fits a deliberate choice to support several agent runtimes. This is a source-based recommendation, not a completed integration or compatibility result.

Loading the extension from stable `main` and selecting an agent's working directory are separate decisions. A parent Pi already running in a development worktree can pass that cwd implicitly. Only dispatching from one parent session to several different existing worktrees requires an exposed per-child directory parameter. No extra extension reload mechanism is implied by this research.

## Snapshots, adoption and code size

The three npm packages were checked at their latest published version's `gitHead`, rather than whichever commit happened to be on GitHub's default branch. Davis was checked at the source repository's current default-branch commit; its local package is private and has no version.

| Implementation                   | Version / pinned commit                                            | npm downloads in fixed 30-day window | Production code | Physical source lines | Production files | Test code / files |
| -------------------------------- | ------------------------------------------------------------------ | -----------------------------------: | --------------: | --------------------: | ---------------: | ----------------: |
| [ogul: pi-codex-subagents][O]    | `0.3.5` / `9f2cae165dabf66a62f1579c3422bce21133bb9d`               |                            [612][OD] |       **2,703** |                 2,908 |                3 |         1,031 / 2 |
| [Henry: pi-subagent][H]          | `15.1.4` / `d7977aa2788fab09f15da5bd29be7d9e48f4e005`              |                         [13,383][HD] |       **4,049** |                 4,424 |               13 |        7,018 / 10 |
| [Arhen: pi-core-subagent][A]     | `1.3.54` / `de1c8783c2a39b1cbb0f86b412307193de9774c1`              |                         [15,782][AD] |       **3,167** |                 3,495 |               11 |         1,596 / 8 |
| [Davis: extensions/subagents][D] | No standalone release / `5a0863f442402aa35cb0830805d67639957c7172` |                       Not applicable |       **4,390** |                 5,273 |               15 |           599 / 7 |

Downloads cover **2026-08-12 through 2026-09-10, inclusive, UTC**, via npm's dated API. They count package downloads, including automation and repeated installation, not users or subagent invocations. Davis's unavailable standalone number is not zero. Registry identities: [ogul][OR], [Henry][HR], [Arhen][AR]. Their latest versions were published on September 5, 8 and 10 respectively.

Counts use `cloc 2.00` on tracked TS/JS source at the pinned commits. Production code excludes blank and comment-only lines; physical lines include them. Tests are separate. Generated builds, documentation, Markdown roles/skills, lockfiles, dependencies, benchmarks and fixtures are excluded. Test size is not a coverage percentage or evidence of passing tests.

| Implementation | Exact source boundary                                                                                        | Exclusions and concentration                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ogul           | `packages/pi-codex-subagents/{core,index,peek}.ts`                                                           | `core.test.ts` and `peek.test.ts` counted as tests; `test/fake-rpc-child.js` excluded as a fixture. `core.ts` contains 1,736 code lines, about 64% of production code.                        |
| Henry          | `extensions/pi-subagent/src/*.ts` and `extensions/pi-subagent/extensions/*.ts`                               | Ten `test/*.test.ts` files counted separately. Generated `dist` and the three sibling runtime packages are excluded. Largest file: `src/ephemeral.ts`, 876 code lines.                        |
| Arhen          | `packages/core/pi-core-subagent/src/*.ts`                                                                    | Eight `test/*.test.ts` files counted separately; `bench/spawn-cost.ts` excluded. `src/manager.ts` contains 1,466 code lines, about 46% of production code.                                    |
| Davis          | `extensions/subagents/index.ts`, production `src/**/*.ts`, **plus `extensions/shared/tool-call-timeout.ts`** | `src/backends/stub.ts` is test support and excluded. Seven tests include two live backend tests excluded from the default test script. Largest file: `src/backends/codex.ts`, 936 code lines. |

To reproduce, enumerate tracked files with `git ls-files`, select the boundaries above, and pass separate production/test file lists to `cloc --config=/dev/null --timeout=0 --quiet --json --by-file --skip-uniqueness --list-file=<list>`. Verify every selected file appears in the result and that its physical lines equal code + comments + blanks. These counts were checked that way. They measure source maintained in each subagent unit; the dependency comparison below accounts for code delegated to other packages.

## What the parent model can actually do

The table describes registered tools. An internal method or a human dashboard action does not count as a model-callable capability. Sources: [ogul entry][OI], [Henry entry][HI] and [flow][HF], [Arhen entry][AI], [Davis entry][DI].

| Capability                              | ogul                                                                                                                    | Henry                                                                              | Arhen                                                                                                                                        | Davis                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Execution engine                        | Separate **Pi RPC process** per active child                                                                            | Separate ephemeral **Pi JSON process**                                             | **Pi SDK in parent process**                                                                                                                 | Pi SDK, Claude Agent SDK, or Codex app-server                                           |
| Parent-facing tools                     | `spawn_agent`, `wait_agent`, `wait_all_agents`, `list_agents`, `read_agent_response`, `send_message`, `interrupt_agent` | `delegate_task`, `delegate_flow`, `delegate_flow_continue`                         | `subagent`, `subagent_status`, `subagent_result`, `await_subagent`, `reply_subagent`, `steer_subagent`, `resume_subagent`, `subagent_cancel` | `subagent_spawn`, `subagent_wait`, `subagent_cancel`, `subagent_check`, `subagent_list` |
| Background dispatch and later result    | Yes                                                                                                                     | Optional `background` mode                                                         | Default                                                                                                                                      | Yes                                                                                     |
| Append instruction while running        | `send_message` steers child                                                                                             | No public tool                                                                     | `steer_subagent`                                                                                                                             | No public tool; human TUI/internal API only                                             |
| Continue a settled child conversation   | `send_message` reopens saved child session                                                                              | No; children use `--no-session`                                                    | `resume_subagent` only for failed/aborted tasks, with settled run and saved session                                                          | Human TUI/internal API only                                                             |
| Explicit model-callable cancellation    | Individual child interruption                                                                                           | No; foreground abort signal or shutdown/reload                                     | Run cancellation; individual task cancellation in UI                                                                                         | Individual child cancellation                                                           |
| Scheduling                              | Parent coordinates individual agents; no explicit concurrency cap                                                       | Single, parallel, chain; default 5 active and FIFO queue; up to 8 entries per call | Single, parallel, chain, DAG; default 3 active, maximum 8; up to 16 tasks                                                                    | Four active across all backends; no built-in chain/DAG                                  |
| Child communications                    | Parent sends instructions; completion returns                                                                           | Final output and chain handoff                                                     | Ask/notify parent; message/poll siblings in same run                                                                                         | No child mailbox protocol                                                               |
| Choose an existing child cwd            | No public parameter; inherits parent cwd                                                                                | No public tool parameter; inherits cwd or creates role worktree                    | Public `cwd`, but writable Git tasks create another worktree                                                                                 | Public `working_dir`; no automatic Git worktree                                         |
| Automated validation/review/integration | None                                                                                                                    | `delegate_flow` owns this sequence                                                 | Worktree commit/result reporting; no acceptance loop                                                                                         | None                                                                                    |

Despite its name, **ogul's package runs Pi, not the Codex CLI**. Davis is the implementation here that actually offers Codex app-server as a separate execution backend. Henry's `pi-multi-codex` dependency supplies Pi provider/account routing, which is a different capability.

All four start new child contexts rather than cloning the parent's full conversation. A separate session, a separate process, and survival after parent shutdown are three different properties. **None of these implementations provides a supervised service that promises to keep tasks running through parent Pi shutdown/restart.** Ogul terminates active children on shutdown and reconciles orphan ownership later; Henry aborts ephemeral children; Arhen aborts/disposes SDK sessions and restores historical snapshots; Davis disposes its Effect runtime and child resources. Session files can preserve conversation evidence without preserving execution. [Ogul shutdown][OI], [Henry lifecycle][HI], [Arhen manager][AM], [Davis manager][DM].

## Implementation differences that matter in development

### ogul: a small, complete task-control loop

A parent spawns `worker`, carries on with another task, then sends a correction through `send_message`. While the child is running, this becomes Pi RPC steering. After it settles, its process exits; another message starts a new Pi process using the same JSONL conversation. Interrupting ends the current execution while retaining that conversation. Cancellation of a wait only stops observation, leaving the child running. [Process launch and control][OC].

This is close to the daily development loop we need. Its scope stays focused on task identity, RPC events, persistence, result delivery and cleanup. It does not impose a Git branch or merge policy. The small size does conceal concentration: much of that lifecycle lives in one `core.ts` file.

Two adoption gaps deserve explicit treatment. First, the child arguments include `--no-context-files`: the package deliberately disables automatic `AGENTS.md`/`CLAUDE.md` loading, alongside default extension and skill discovery. A Pi Stuff fork must decide how required repository instructions reach the child. Passing parent tool names also does not recreate the extension implementations that provided them. Second, the launcher defaults to `process.execPath` with an optional entry script; its behavior under the maintainer's compiled Bun Pi needs a real spawn/interrupt/reopen check. `PI_SUBAGENT_PI_BIN` provides an explicit launcher override. [Launch policy and launcher][OC], [documented resource rules][O].

The default ten-minute timeout covers an individual model response, not tool execution or total task lifetime. There is no explicit concurrency/depth budget. Child extensions are disabled by default, so recursive spawning is unavailable by default; explicitly loading a delegation extension can remove that practical restriction.

### Henry: disposable roles plus a Git integration workflow

`delegate_task` runs packaged scout, reviewer and implementer roles, with explicit tools, extensions, skills and model profiles. A chain passes the preceding successful output through `{previous}`; it does not retain a conversation or automatically share a worktree between steps. The default executor limits each child to 50 turns, ten idle minutes and thirty total minutes; tokens are unlimited unless configured. Configured token limits are not an exact spending ceiling because a final handoff can exceed them. [Role/runtime construction][HS], [executor][HE], [workflow][HW].

Its additional feature is substantial: `delegate_flow` requires a clean committed parent checkout, creates unit worktrees, runs implementers in parallel, then processes units in declared order: **rebase, run validation, optionally obtain an exact review verdict, and `git merge --ff-only` into the captured parent checkout**. Here “Main” means the caller's checkout/branch, not necessarily a branch literally named `main`. A blocked unit has one explicit `delegate_flow_continue` repair attempt. There is no persistent flow recovery, general DAG scheduler or post-merge validation. [Flow implementation][HF].

For example, two implementation units can finish independently, but the second is rebased and checked against the state after the first has been integrated. That is useful when the desired product owns the entire local integration workflow. It is additional policy for Pi Stuff, whose changes currently enter through PRs and whose merges require explicit authorization. Adopting generic role delegation does not require adopting this flow.

The four-thousand-line count also excludes three direct first-party dependencies: shared config storage, task-model routing and conditional Codex account routing. The package leaves Pi context-file discovery enabled at the CLI-argument level; actual AGENTS discovery still depends on the host SDK and is not established by executing this research.

### Arhen: communicating agents and dependency scheduling

Arhen covers more orchestration within roughly 3,200 code lines. A run can ask two scouts to investigate in parallel and start a writer only after both succeed. `needs` edges prepend upstream results to the next prompt. The scheduler executes waves: it waits for the entire current ready wave before moving to the next, so a newly unblocked task can wait for an unrelated slow task in that wave. Invalid edges and cycles fail before dispatch. [Dependency scheduler][AG].

Children can call `ask_parent` and wait for `reply_subagent`, notify the parent, or send sibling messages. Siblings must poll their mailbox; delivery is not a push into the sibling's active prompt. Parent questions time out after ten minutes. The parent can steer live tasks. Resume only reopens a failed/aborted task's saved session after its run has settled; it does not continue successfully completed tasks. [Child tools][AC], [manager][AM].

The main integration cost is the attached Git policy. The effective toolset containing `bash`, `edit` or `write` triggers a new managed worktree, automatic commits and cleanup/recovery behavior; passing an existing worktree as `cwd` does not by itself opt out of that. Non-Git cases can run in place. This is more than choosing a directory for the child. [Worktree implementation][AW], [task preparation][AM].

Its sidecar stores up to 50 historical runs beside the parent session. Reload changes formerly active tasks to aborted; it does not reconstruct a running process. Child resources use `DefaultResourceLoader` with extensions disabled. Agent-file matching is based on description-word overlap rather than exact role name, and a match can supply the prompt/model/tools. These are policies to review when moving to Pi Stuff's explicit agent templates. [Agent matching][AA], [session preparation and persistence][AM].

### Davis: one lifecycle interface for three backends

Davis's useful design contribution is the boundary around backend differences. An Effect `ManagedRuntime` owns scopes, event queues, concurrency, waiting and cleanup; each backend presents a normalized session with events, send and interrupt operations. The same manager feeds model tools and a human dashboard. Its Pi adapter runs in-process; Claude and Codex add external runtime/authentication requirements. [Backend interface][DB], [runtime][DR], [manager][DM].

The important usability limitation is the difference between that internal interface and the five registered tools. **The parent model cannot call send/steer/resume.** Human `/subagents` takeover invokes the manager's send path. Even there, semantics differ: Pi supports live steering, while Codex advertises no steering and queues another turn. A fork intended for autonomous parent-led collaboration would need to expose and specify this capability. [Tool registration and UI][DI], [manager send][DM].

This is the most direct fit for selecting an existing worktree: `working_dir` resolves to a directory without creating Git worktrees. Pi project resources are gated by the host trust decision. The Codex backend instead requests `approvalPolicy: "never"` and `sandbox: "danger-full-access"`; that is a concrete default to evaluate if this backend is adopted. [Pi adapter][DP], [Codex adapter][DC].

Effect v4 is already in use, but that alone does not make this the cheapest fork. Three protocol adapters, event ordering and finalizers remain work to maintain; the shared timeout helper also mutates Pi tool definitions. A Pi-only adaptation would discard much of the reason for the multi-backend interface. The local package depends on Effect `^4.0.0-beta.99`, whereas Pi Stuff selects `4.0.0-rc.112`; specific API differences need checking, and prerelease status alone is not a reason to reject Effect v4.

## Dependencies, license and observed verification

| Implementation | Dependencies outside Pi/TypeBox/Node built-ins                                                                                              | Declared Pi baseline                             | Observed CI at the pinned commit                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| ogul           | No direct runtime dependencies                                                                                                              | Coding-agent `>=0.80.4`; other Pi peers wildcard | No check runs observed; no workflow in inspected tree                                     |
| Henry          | `pi-config-store ^1.0.0`, `pi-task-models ^5.0.0`, `pi-multi-codex ^1.0.0`; shared storage/routing also uses `proper-lockfile`              | Pi peers `^0.85.1`                               | [GitHub Actions `test` succeeded][HC]; Ubuntu/Node 22/pnpm, tests/typecheck/package build |
| Arhen          | No direct runtime dependencies; Git executable used for worktrees                                                                           | Pi peers `^0.84.2`                               | [GitHub Actions `check` succeeded][AX]; Ubuntu/Bun, typecheck/lint/tests                  |
| Davis          | Local `effect ^4.0.0-beta.99`, `@anthropic-ai/claude-agent-sdk ^0.3.216`; root Pi/TypeBox and shared helper; external CLIs for Claude/Codex | Root Pi dependencies `^0.82.0`, lockfile 0.82.0  | No check runs observed; no workflow in inspected tree                                     |

Manifest evidence: [ogul][OP], [Henry][HP], [Arhen][AP], [Davis local][DPKG] and [root][DROOT]. A `^0.84.2` range excludes `0.85.1`; Davis's `^0.82.0` range also excludes it. That is a declared-version gap, not a reproduced runtime failure. Henry's CI success does not establish acceptance on Pi Stuff's Bun-compiled Pi. No candidate was installed, typechecked, tested or run locally, and no child model call was made. Only trusted research/counting scripts ran.

All four use MIT. Preserve the relevant source notices if copying code. Arhen's license identifies its fork from `@ghoulm370/pi-subagent-ui`; Davis uses the repository's MIT license, explicitly covering prior commits. [Ogul license][OL], [Henry license][HL], [Arhen license][AL], [Davis license][DL].

## Fork decision and first acceptance targets

| If the first requirement is…                                                   | Best source to examine first | Main adaptation cost                                                                                                                   |
| ------------------------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Parent-controlled Pi workers with follow-up instructions and interruption      | **ogul**                     | Repository instructions, compiled Bun launcher, bounded concurrency, and lifecycle decomposition around Pi Stuff's Effect I/O boundary |
| Child questions, sibling coordination and dependency graphs                    | **Arhen**                    | Pi 0.85.1 API gap, explicit agent selection, and separating execution from automatic worktree/commit policy                            |
| Disposable scout/reviewer/implementer roles and repeatable checked integration | **Henry**                    | Shared routing dependencies; decide which Git workflow policy is wanted; ordinary children lack public follow-up/cancel tools          |
| Pi plus Claude Code and Codex under one dashboard                              | **Davis**                    | Pi/Effect API port, standalone extraction, and exposing parent-model send/continue controls                                            |

For the first Pi Stuff feature, retain the narrow development loop: create an isolated child conversation, observe or await it, deliver completion once, send a correction, interrupt, and continue from the saved conversation. Reuse an existing worktree cwd when needed. Treat orchestration graphs, managed worktrees, automatic review/merge flows and extra backends as separate product choices.

Before declaring a fork usable, test that loop on the selected **Pi 0.85.1 / Bun 1.4.0 / Effect 4.0.0-rc.112** host, including project instructions, wait cancellation versus child cancellation, parent shutdown, child failure and session reopening. These are proposed acceptance targets, not tests performed by this research. No fork implementation or dependency change is part of this report.

[O]: https://github.com/ogulcancelik/pi-extensions/tree/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents
[H]: https://github.com/HenryQW/pi-harness/tree/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent
[A]: https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent
[D]: https://github.com/davis7dotsh/my-pi-setup/tree/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents
[OD]: https://api.npmjs.org/downloads/point/2026-08-12:2026-09-10/%40ogulcancelik%2Fpi-codex-subagents
[HD]: https://api.npmjs.org/downloads/point/2026-08-12:2026-09-10/%40henryqw%2Fpi-subagent
[AD]: https://api.npmjs.org/downloads/point/2026-08-12:2026-09-10/%40arhen%2Fpi-core-subagent
[OR]: https://registry.npmjs.org/@ogulcancelik%2Fpi-codex-subagents/0.3.5
[HR]: https://registry.npmjs.org/@henryqw%2Fpi-subagent/15.1.4
[AR]: https://registry.npmjs.org/@arhen%2Fpi-core-subagent/1.3.54
[OI]: https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/index.ts
[OC]: https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/core.ts
[OP]: https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/package.json
[OL]: https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/LICENSE
[HI]: https://github.com/HenryQW/pi-harness/blob/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent/extensions/subagent.ts
[HF]: https://github.com/HenryQW/pi-harness/blob/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent/extensions/delegate-flow.ts
[HS]: https://github.com/HenryQW/pi-harness/blob/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent/src/index.ts
[HE]: https://github.com/HenryQW/pi-harness/blob/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent/src/ephemeral.ts
[HW]: https://github.com/HenryQW/pi-harness/blob/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent/extensions/workflow.ts
[HP]: https://github.com/HenryQW/pi-harness/blob/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent/package.json
[HL]: https://github.com/HenryQW/pi-harness/blob/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent/LICENSE
[HC]: https://github.com/HenryQW/pi-harness/actions/runs/34210280575
[AI]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/index.ts
[AM]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/manager.ts
[AG]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/graph.ts
[AC]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/child.ts
[AW]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/worktree.ts
[AA]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/agentfile.ts
[AP]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/package.json
[AL]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/LICENSE
[AX]: https://github.com/arhen/pi-extensions/actions/runs/34469628170/job/102846226743
[DI]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents/index.ts
[DM]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents/src/manager.ts
[DB]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents/src/backend.ts
[DR]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents/src/runtime.ts
[DP]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents/src/backends/pi.ts
[DC]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents/src/backends/codex.ts
[DPKG]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents/package.json
[DROOT]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/package.json
[DL]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/LICENSE
