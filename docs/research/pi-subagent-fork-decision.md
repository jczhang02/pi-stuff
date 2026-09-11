# Pi subagent fork decision

[简体中文](../i18n/zh-CN/research/pi-subagent-fork-decision.md)

## Recommendation

**Fork `@maxedapps/pi-subagents@0.1.2`, from `maxedapps/pi-subagents` commit `0dc176585f4f6c01a86e244d8c8d0db17a89d7cf`.** It offers the closest small starting point for Pi Stuff: four model-facing tools cover asynchronous launch, list/status/wait, live steering and completed-run follow-up, and explicit stop. Its production boundary is **1,924 code lines in seven TypeScript files**, or 2,147 physical lines including comments and blanks. It includes a small terminal UI and returns both current assistant output and a readable transcript path to the parent model.[^max-tools][^max-runtime]

This is a recommendation for a maintained fork with focused repairs. It is a young upstream, with **77 npm downloads in the complete 30-day window**,[^max-downloads] and does not establish the maturity of larger alternatives. Choosing it trades upstream operating history for a small, directly useful control surface. The existing lifecycle and output boundaries need repair before Pi Stuff relies on them; the acceptance work below is part of the proposed fork, not evidence that the package already passes.

The selection supersedes the narrower recommendations in the [earlier download-filtered comparison](pi-subagent-fork-comparison.md) and [four-package comparison](pi-selected-subagent-comparison.md). Those records remain dated studies. This decision covers a broader discovered set and distinguishes model tools from internal services and human UI.

## Scope and comparison method

The snapshot is dated **2026-09-12, Asia/Shanghai**. Discovery combined the Pi package directory, npm package metadata and source tarballs, repository searches, earlier named candidates and fork lineages. The [candidate catalog](pi-subagent-candidate-catalog.md) records **104 unique candidate names**: 85 visible directory entries and 19 supplements. The directory header reported 87 while pagination yielded 85 unique entries; the discrepancy is retained rather than silently filled. This is a reproducible discovery boundary, not a claim to enumerate every public or private implementation.[^catalog]

All 104 received a disposition, but not the same depth of audit. Small plausible replacements and important prior candidates received control-path review and source counts; add-ons, broad suites and external-backend wrappers received narrower screening. The official Pi subagent example is an additional baseline. No candidate package was installed or executed, and no candidate tests or model-provider calls were run.

The required behavior is a native Pi child that can do independent work in an existing cwd, remain controllable while running, preserve context for a completed-task follow-up in the same parent session, and expose useful progress to the parent model and human. In-process Pi SDK sessions and separately launched Pi RPC processes both qualify. Cross-parent-restart survival, automatic Git/worktree operations, scheduling, workflow DSLs and multi-backend routing are not selection requirements.

Downloads use the last complete UTC 30-day window available at collection: **2026-08-12 through 2026-09-10**. They count package downloads, not users or successful deployments. No download floor was applied. Published versions and reviewed Git heads are identified separately; newer Git code is not silently attributed to an npm release.

LOC means TypeScript/JavaScript production **code**, excluding comments, blank lines, tests, fixtures, lockfiles, documentation, generated declarations/output and bundled third-party code. Necessary first-party code is included where a small fork boundary can be resolved: Everyx is 3,175 + 944 lines from its required `pi-ui`; Davis includes its shared timeout helper. Suite-wide counts are labeled and cannot be read as the isolated cost of one tool. Unresolved external dependencies are additional cost, not zero. Counts measure maintenance surface, not feature quality.

The 1,924-line Maxedapps total and the 4,409-line Zichuanlan total were checked with per-file `cloc --timeout 0`. Zichuanlan's default cloc timeout had incorrectly classified its entrypoint as comments and produced 3,137 lines; that number is superseded here. Broad high-volume candidates were also checked for this timeout problem. Source counting did not execute package code.

## What the recommended fork actually does

For a typical development task, the parent supplies the current worktree path and a focused assignment. `subagent_start` starts a Pi RPC child and immediately returns a run ID. The parent continues its own work, then uses `subagent_status` to inspect or wait. If the child is heading in the wrong direction, `subagent_send` steers its active generation; after successful completion, the same tool starts the next generation in the still-open child. Finally `subagent_stop` closes it.[^max-tools][^max-runtime]

| Development need        | Existing implementation                                                                                | Practical limit                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Background launch       | `subagent_start`; async is default, `wait:true` is available                                           | No admission/concurrency cap in the reviewed runtime                                            |
| List, inspect and wait  | `subagent_status`; selected IDs, all-settled wait, optional wait timeout                               | Uses polling internally; cancellation currently reaches beyond selected IDs                     |
| Redirect running work   | `subagent_send` with `behavior: "steer"` or `"follow-up"`                                              | Steering is delivered through Pi's RPC semantics, not arbitrary interruption of a shell command |
| Continue completed work | Send a new prompt to an `idle` run; increments `generation`                                            | Requires the still-open child; `stop` removes it                                                |
| Stop                    | `subagent_stop` for selected IDs, plus parent lifecycle hooks                                          | Process-tree cleanup and output-drain ordering need hardening                                   |
| Parent-model visibility | JSON `state`, `generation`, `output`, `partial`, `reason`, `transcriptPath`, `needsStop`, `nextAction` | Transcript is a readable activity log, not the full canonical Pi session                        |
| Human visibility        | Below-editor widget and `/subagents` transcript overlay                                                | Optional Herdr tail pane is extra UI; Herdr is not required for execution                       |
| Existing worktree       | Required `cwd` is passed to child spawn; parent owns Git                                               | Does not create, commit, rebase or merge worktrees                                              |

The transcript records timestamps, tool start/end/error summaries, steering and settlement, with a bounded final-answer excerpt. Tool results and every text delta are not a complete persisted conversation. Current assistant text is separately exposed in snapshots. This is enough to inspect useful progress without inventing a full monitoring platform, but it must not be advertised as full transcript capture.[^max-rpc][^max-ui]

The child uses `--mode rpc --no-session --no-context-files --system-prompt ...`. Its conversation survives across generations in the open child, not across a parent restart. Ordinary extensions, tools and skills can load; profile prose is not an enforced read-only tool boundary. Pi Stuff needs an explicit resource/tool policy, including how its project instructions reach the child.[^max-rpc][^max-profiles]

The selected package's 1,924 lines break down as follows. The central run/protocol work is 1,115 lines; the rest supplies the model interface, profiles and visible controls.

| File                            | Code LOC | Responsibility                           |
| ------------------------------- | -------: | ---------------------------------------- |
| `src/runtime.ts`                |      583 | Run state, generations, wait and cleanup |
| `src/rpc-child.ts`              |      532 | Pi process and JSONL protocol            |
| `src/ui.ts`                     |      224 | Widget and transcript overlay            |
| `extensions/subagents/index.ts` |      187 | Pi registration and lifecycle hooks      |
| `src/herdr.ts`                  |      160 | Optional terminal viewer integration     |
| `src/tools.ts`                  |      136 | Four model-facing tool schemas           |
| `src/profiles.ts`               |      102 | Agent profile discovery and loading      |

## Closest alternatives

| Candidate                         | Main strength                                                                                                    | Reason to choose Maxedapps for this fork                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Zjie-Wang, 1,711 LOC              | Very small native SDK manager, complete controls, enforced child tool allowlist                                  | Running status text is narrow; richer tool/message data is UI `details`; no full transcript/viewer; startup/shutdown races need repair    |
| Zichuanlan lite, 4,409 LOC        | FleetView, live conversation UI, model `verbose` conversation query; removes upstream worktree/scheduler systems | Model stop wrapper is absent; wait ignores its signal; ten-minute cleanup disposes resumable sessions; resume needs active-state guarding |
| pi-claude-subagents, 3,678 LOC    | All four model operations, persisted completed follow-up, budgets and diagnostics                                | Broader supervision/nesting/fork policy and optional worktree machinery; less dedicated human live-view UI                                |
| Everyx including pi-ui, 4,119 LOC | Good RPC streaming limits and process-group cleanup; persistent child send                                       | No separate model status/wait/result tool; required UI package and admission policy add adaptation work                                   |
| Ogul, 2,703 LOC                   | Clear spawn/wait/send/interrupt API, native RPC                                                                  | `read_agent_response` returns final text; live detail chiefly belongs to interactive socket UI; buffer/cleanup repairs remain             |
| j0k3r, 7,560 LOC                  | Complete native SDK control, SQLite attempts/events/history, substantial tests                                   | More persistence and task-history machinery than required; useful reliability reference                                                   |
| Ferris, 8,330 LOC                 | RPC readiness, retries, timeouts, process-group cleanup and retention controls                                   | Stronger operating machinery with a much wider implementation boundary                                                                    |
| claude-style-subagent, 3,204 LOC  | Rich model control, transcript and live dock                                                                     | No confirmed permissive license; patches Pi prototypes and private members, increasing upgrade coupling                                   |

These are engineering judgments about the stated scope. The Maxedapps advantage over Zjie is its existing model-visible snapshot/log contract; over Zichuanlan it is the smaller public control/runtime boundary. It does not beat every alternative on every reliability or UI feature.[^zjie][^zichuan][^pi-claude][^everyx][^ogul][^claude-style]

The newer Narumitw package has active-child messaging and inspection, but terminalization revokes child control rather than preserving a completed follow-up target. Yishan's completed send is primarily a human command. The unscoped `pi-subagents-lite` has continuation internally/UI-side, which must not be confused with a complete model-facing follow-up API. Danchamorro adds several terminal/backend workflows. Their individual dispositions and source identities are retained in the catalog.

## Source size across the comparison set

The table contains 36 candidates with measured boundaries plus the official example. The catalog covers the remaining screened entries without presenting rough tarball line counts as comparable production LOC. `Git` marks a reviewed repository snapshot; the linked pin controls the source claim even when the npm version differs.

| Candidate and source boundary                                                                                                                                       | Production code LOC | Files | Relevance to this fork                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------: | ----: | -------------------------------------------------------------------- |
| [Maxedapps 0.1.2](https://github.com/maxedapps/pi-subagents/blob/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/src/runtime.ts)                                           |               1,924 |     7 | Four model tools; small RPC runtime and UI                           |
| [Zjie-Wang 0.1.2](https://github.com/ZJie-Wang/pi-extensions/blob/0cc6b349c3e31636f80ceed2f74feb1de8f0fcfa/extensions/subagents/manager.ts)                         |               1,711 |     7 | Complete controls; model inspection and transcript need expansion    |
| [Zichuanlan lite 0.2.0](https://github.com/ZiChuanLan/pi-subagents-lite/blob/360d7cfbc0ba583898295bcb17b44fba43908719/src/index.ts)                                 |               4,409 |    21 | Rich viewer; missing model stop, wait/retention repairs              |
| [pi-claude-subagents 0.3.7](https://github.com/FFatTiger/pi-claude-subagents/tree/f4287a2e196be4819789b8e79d0dec1b150aee38)                                         |               3,678 |     8 | Native Pi SDK; supervision, nesting and optional worktrees           |
| [Everyx 1.3.6 + pi-ui](https://github.com/everyx/pi-extensions/tree/2fd03fdab465e8180a2a9736f1a9c9f18e2c4adb/packages)                                              |               4,119 |    26 | 3,175 runtime + 944 required UI; model inspect/wait gap              |
| [Ogul 0.3.5](https://github.com/ogulcancelik/pi-extensions/tree/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents)                               |               2,703 |     3 | RPC; live detail is chiefly interactive UI                           |
| [pi-agents-pool 0.2.0](https://github.com/minghinmatthewlam/pi-subagents/tree/c52ab42784e61a3e564f355fdce3fc08cc37939b)                                             |               1,047 |     3 | Small RPC pool; model read surface is latest response                |
| [pi-subagents-j0k3r 1.5.15](https://github.com/j0k3r-dev-rgl/pi-subagents-j0k3r/tree/ccde60b51e5ab9ae5ff9ea0bd3eb6bae1eae7c73)                                      |               7,560 |    59 | Complete SDK control and SQLite history; larger persistence boundary |
| [Gotgenes 21.7.0](https://www.npmjs.com/package/@gotgenes/pi-subagents/v/21.7.0)                                                                                    |               6,463 |    68 | Published source; no model stop; resumed-turn abort caveat           |
| [Ferris 4.3.18](https://github.com/MCapricorns/pi-subagents/tree/205daadd0193b3f3bf5fcc269311a7523795ce22)                                                          |               8,330 |    32 | Strong RPC limits/retry/cleanup; broader isolation machinery         |
| [pi-submarine 0.3.0](https://github.com/dnouri/pi-submarine/tree/97d8715ebce695a618d1775d6d3d4b9072396c77)                                                          |               2,430 |    12 | Foreground SDK with resume; no independent running-task controls     |
| [Henry 15.1.4](https://github.com/HenryQW/pi-harness/tree/d7977aa2788fab09f15da5bd29be7d9e48f4e005)                                                                 |               4,049 |    13 | Package boundary; flow/Git automation and first-party dependencies   |
| [Arhen 1.3.54](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1)                                                                |               3,167 |    11 | Resume failed/aborted only; writable jobs own Git lifecycle          |
| [Davis Git](https://github.com/davis7dotsh/my-pi-setup/tree/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents)                                          |               4,390 |    15 | Includes needed timeout helper; multiple backends, steer mainly UI   |
| [mjakl Git 3.0.3](https://github.com/mjakl/pi-subagent/tree/8e1b40b51440804246e312ef2a27a6399ded3186)                                                               |               3,463 |    11 | npm 3.0.1 separately cataloged; foreground RPC sessions              |
| [Aefree 0.8.1](https://github.com/aefreedman/pi-subagents/tree/dab12e3f13c47d054dd41b6a91c6f315c1215fe2)                                                            |               2,652 |    11 | Foreground chains/parallel; no full background controller            |
| [pi-sub-agent 0.1.5](https://github.com/HamdiMaz/pi-sub-agent/tree/f1c0ae29f4cf370255530d3d126ec71b0d7a6194)                                                        |               1,593 |     2 | Foreground JSON subprocess wrapper                                   |
| [pi-open-agents 0.1.22](https://github.com/andrea-tomassi/pi-open-agents/tree/9273b556726a5b86cce9159891094f8c4b3ecc8b)                                             |               2,919 |    22 | Foreground Pi/OpenCode compatibility scope                           |
| [pi-herdr-agents 1.7.0](https://github.com/giuseppecrj/pi-herdr-agents/tree/371265e74fb7485afbfbc7c028d60dc4f98d2779)                                               |              10,339 |    19 | External mux/worktree dependency                                     |
| [goofansu Git](https://github.com/goofansu/pi-subagent/tree/c60b654c9f6f53181181695749f533b34b52a29c)                                                               |              24,118 |   137 | Effect reference; broader Pi/Claude and lifecycle scope              |
| [pi-subagentura 3.6.2](https://github.com/lmn451/pi-subagentura/tree/b36367eb71e3e66d5f4f2a1ebef05fd03b026aa1)                                                      |              32,664 |    56 | Interactive mux, workflows, telemetry and state                      |
| [pi-agent-suite 2.10.1](https://github.com/n-r-w/pi-agent-suite/tree/741c2a6b407c97a26e2e27b79fc7e5264c112723)                                                      |              47,254 |   196 | Whole published pi-package; not isolated run-subagent cost           |
| [fitchmultz Git 0.37.2](https://github.com/fitchmultz/pi-subagents/tree/c3d36cf1f858d5bee57a8240ac40c9208aa3f4d6)                                                   |              33,521 |   115 | Requires patched Pi; extensive detached runtime                      |
| [Router-for-me lite 1.5.4](https://registry.npmjs.org/@router-for-me%2Fpi-subagents-lite/1.5.4)                                                                     |               7,660 |    47 | Published source; broader UI/model/worktree surface                  |
| [nested-subagents 0.1.0](https://github.com/kmmuntasir/pi-nested-subagents/tree/50922638163fd21edefd82063f88ffa8d55328f4)                                           |               5,419 |    30 | Adds nesting, schedules, verification, memory and worktrees          |
| [xz-pi-subagents 0.1.7](https://github.com/Xuzan9396/xz-pi/tree/4b75f772b7cecf9bb0e865a0c46226e09d4cc146/xz-pi-subagents)                                           |                 998 |     9 | Fixed synchronous batch; no steer/resume                             |
| [nano-team 1.0.1](https://github.com/daynin/nano-team/tree/b5c72b3077a33a75e4893213654775af41ea5f35)                                                                |                 981 |     7 | Roster spawn/kill/status; no completed continuation                  |
| [pi-subagents-team 0.3.0](https://registry.npmjs.org/pi-subagents-team/0.3.0)                                                                                       |               2,137 |     3 | Add-on requiring another subagent runtime                            |
| [nicobailon pi-subagents 0.67.0](https://github.com/nicobailon/pi-subagents/tree/aa75b3353836f7868898e3bd58234d21eaff1463)                                          |              90,437 |   283 | Runs, watchdog, workflow, mission and inspection platform            |
| [tintinweb Git / npm 0.19.0](https://github.com/tintinweb/pi-subagents/tree/e955e29c51b7a6cce37e1108cd2d6c57a77e151c)                                               |              12,217 |    56 | Current Git; model stop gap, broader agent/UI policy                 |
| [pi-background-tasks 2.5.0 / Git](https://github.com/ismailsaleekh/pi-background-tasks/tree/14aa4ef382952f073bd4d540f57d6e8e3c2789a2)                               |              28,349 |    49 | Inspect delegation and broad background-task system                  |
| [dynamic-workflows 3.10.1 / Git](https://github.com/QuintinShaw/pi-dynamic-workflows/tree/b6f2c631368b627e75ee68518402541c3b83265e)                                 |              15,467 |    51 | Current Git; workflow replay, not live child steering                |
| [pi-fabric 0.92.4 / Git](https://github.com/monotykamary/pi-fabric/tree/95c8a89faf9994a109167c9807f25c348dd99bcf)                                                   |              86,803 |   351 | Current Git; distributed worker/MCP platform                         |
| [Tian Zuo 0.1.2](https://registry.npmjs.org/@tian.zuo%2Fpi-subagents/0.1.2)                                                                                         |               4,527 |    32 | Published source; report-oriented RPC, weaker live controls          |
| [claude-style-subagent 0.1.5](https://github.com/nishuzumi/claude-style-subagent/tree/981ec288a29dfcc0e3a0f4dd2afe4a2aba73834d)                                     |               3,204 |     — | License unresolved; patches Pi prototypes/private internals          |
| [Nilskluewer 0.8.0](https://www.npmjs.com/package/@nilskluewer/pi-subagent/v/0.8.0)                                                                                 |               3,835 |     — | Resumable RPC; model status/stop less direct                         |
| [Official Pi 0.85.1 example](https://github.com/earendil-works/pi/tree/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/examples/extensions/subagent) |               1,027 |     2 | Additional baseline; foreground single/parallel/chain                |

The large nicobailon package is not 90,437 lines just to spawn and wait. Its reviewed release includes 48,654 lines under runs, 11,339 for UI/inspection/slash surfaces, 7,180 for agents/profiles, 4,280 for workflows, 4,315 for watchdog and 1,887 for missions, with other infrastructure making up the remainder. It buys a wider operating platform; Pi Stuff would then own the work of retaining, understanding or removing that platform.[^nico]

## Why the selected pin is 0.1.2 rather than current Git HEAD

The current upstream HEAD, [`646e766b5dbc8be7b6662b3c6b05f5162cfc4a54`](https://github.com/maxedapps/pi-subagents/tree/646e766b5dbc8be7b6662b3c6b05f5162cfc4a54), declares source version **0.2.0**. It was also reviewed. It has **2,681 production code lines in eight files** and **1,302 test code lines in five files**, compared with 1,924/7 and 800/4 at 0.1.2. This Git snapshot is distinct from the npm 0.1.2 artifact used in the catalog.

The added code includes a 736-physical-line Pi Office coexistence module, an open-run registry for that integration, a pre-deadline wrap-up prompt and an automatic recovery-summary generation after abnormal settlement. The [runtime change](https://github.com/maxedapps/pi-subagents/compare/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf...646e766b5dbc8be7b6662b3c6b05f5162cfc4a54) preserves the original failure state alongside recovery data, which is useful, but also adds another model-generation policy and cross-extension coordination.

**Keep 0.1.2 as the fork base.** The newer tree still contains the global wait-abort stop path and does not solve the JSONL growth, process-tree termination or complete startup/shutdown admission concerns identified here. Its open-run registry is not a substitute for those fixes. Pi Stuff does not currently need Pi Office coexistence or automatic recovery generations. Review the later abort-cause classification fix for a focused port, with its associated tests; do not import the whole later policy surface merely because it is newer. This is a deliberate scope choice after inspecting the newer source, not an assumption that npm is current.

## Fork boundary and necessary changes

Retain the four tools, the run/generation distinction, cwd input, current-output snapshot, small widget/overlay and the separation between `tools.ts`, `runtime.ts` and `rpc-child.ts`. Retain the upstream MIT notice and tests. The optional Herdr view can be omitted from Pi Stuff's first supported path. Do not turn this fork into a general workflow engine.

Before adoption, address three concrete groups of work:

1. **Bound output and admission.** The public snapshot has a text cap and the in-memory log keeps 2,000 lines, but the incoming JSONL buffer, accumulated assistant stream and disk transcript can still grow without a corresponding bound. Add coherent byte/line/file limits and an explicit active-child limit. Define whether reaching a limit truncates observation, rejects a new child or stops execution; do not silently report success.
2. **Repair cancellation and teardown.** `waitForRuns(ids)` currently calls global `stopActive` on abort, contradicting the selected-ID scope in its tool description. Stop must target its stated runs. Handle stop/shutdown during launch, reject admission after shutdown starts, serialize generation transitions, drain stdout before final exit classification, and confirm process-tree termination before declaring cleanup complete. A direct child `kill` is not evidence that its shell descendants exited. These are static source findings, not reproduced failures.
3. **Adapt Pi Stuff's boundary.** Route boundary decoding, errors and necessary I/O through the repository's existing Effect v4 policy. Make tools/skills/project instructions explicit; preserve normal existing-cwd operation. Add completion notification if the parent should wake automatically: upstream currently requires explicit status/wait. Reuse Pi's existing invocation resolution where needed for the Bun-compiled host, and validate the actual executable path before changing launch logic.[^max-runtime][^max-rpc][^pi-launch]

The UI already exposes useful progress. Full canonical session capture, replay after parent restart, a custom transcript explorer, auto-Git and multi-backend support are optional product expansions; none is required to establish the first usable fork. Retention for the readable log still needs a deliberate policy because upstream normally deletes its owned temporary transcript directory on parent shutdown.

## Maturity, compatibility and acceptance

MIT licensing and no added runtime dependencies are confirmed for the selected published package. Pi/TypeBox are host peer dependencies, so “no runtime dependencies” does not mean a standalone executable. The README states Node 22.19+ and Pi 0.81.1+, while peers are wildcard ranges. Neither this declaration nor successful import elsewhere establishes operation on Pi Stuff's **Bun-compiled Pi 0.85.1 / Bun 1.4.0**.[^max-metadata]

Upstream tests and CI are assessed separately from local execution. Zjie's pinned Git repository contains tests and a smoke script even though its npm tarball omits them; its exact-head [CI run](https://github.com/ZJie-Wang/pi-extensions/actions/runs/32721992314) succeeded. Nico's published commit has a successful [CI run](https://github.com/nicobailon/pi-subagents/actions/runs/34438313918) including Pi 0.85.0/0.85.1 and Bun-standalone cases. This gives those projects stronger compatibility evidence in those checked environments, not automatic acceptance of their code on this host.

The seven production files in npm 0.1.2 match the fixed Git source byte for byte (SHA-256). Its repository contains **four test files, 800 code lines / 889 physical lines**, covering schemas/profiles, RPC classification and settlement, waits/timeouts, idle follow-up and UI/viewer behavior. They were read, not run. The source has four commits at the selected pin and six at current HEAD; neither is a long operating history. [Pinned tests](https://github.com/maxedapps/pi-subagents/tree/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/tests).

No exact-head successful CI run was established for Maxedapps. Its small source boundary is the reason to fork it; observed popularity and host validation are its weak points. The first implementation acceptance must cover:

- Fresh and background launch in an existing worktree, with correct model/resources and no incidental Git operations.
- Parent-visible live output/activity, readable logs, result collection, and successful same-child follow-up.
- Wait timeout versus explicit stop, abort scoped to selected IDs, and unaffected sibling tasks.
- Stop/shutdown before startup completes, during a tool call, during queued control and after successful completion.
- Huge/fragmented UTF-8 JSONL and output, provider failure, unexpected process exit, and a shell descendant that requires cleanup.
- Accurate state after cleanup, final output after stdout drains, bounded resource retention and any chosen completion-notification behavior.

These are proposed acceptance checks, not tests run in this research. The decision is **one fork base with named repair obligations**, followed by target-host validation in a separately authorized implementation task.

## Sources

The candidate catalog links the complete discovered set. The following pinned source files support the selection and its limitations.

[^max-tools]: [Maxedapps, model tool schemas and results](https://github.com/maxedapps/pi-subagents/blob/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/src/tools.ts). Source snapshot accessed 2026-09-12.

[^max-runtime]: [Maxedapps, run/generation/state/wait/shutdown implementation](https://github.com/maxedapps/pi-subagents/blob/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/src/runtime.ts). Source snapshot accessed 2026-09-12.

[^max-rpc]: [Maxedapps, Pi RPC launch, JSONL parsing, transcript and stop](https://github.com/maxedapps/pi-subagents/blob/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/src/rpc-child.ts). Source snapshot accessed 2026-09-12.

[^max-ui]: [Maxedapps, transcript UI](https://github.com/maxedapps/pi-subagents/blob/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/src/ui.ts). Source snapshot accessed 2026-09-12.

[^max-profiles]: [Maxedapps, profile loading](https://github.com/maxedapps/pi-subagents/blob/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/src/profiles.ts). Source snapshot accessed 2026-09-12.

[^max-metadata]: [Maxedapps 0.1.2 package metadata and license](https://github.com/maxedapps/pi-subagents/blob/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/package.json). Source snapshot accessed 2026-09-12.

[^catalog]: [Pi package catalog, queried for subagents](https://pi.dev/packages?name=subagents). Source snapshot accessed 2026-09-12.

[^zjie]: [Zjie-Wang, model-visible content versus UI details](https://github.com/ZJie-Wang/pi-extensions/blob/0cc6b349c3e31636f80ceed2f74feb1de8f0fcfa/extensions/subagents/index.ts). Source snapshot accessed 2026-09-12.

[^zichuan]: [Zichuanlan, controls, resume and verbose conversation](https://github.com/ZiChuanLan/pi-subagents-lite/blob/360d7cfbc0ba583898295bcb17b44fba43908719/src/index.ts). Source snapshot accessed 2026-09-12.

[^pi-claude]: [Pi Claude Subagents, native Pi tools](https://github.com/FFatTiger/pi-claude-subagents/blob/f4287a2e196be4819789b8e79d0dec1b150aee38/src/index.ts). Source snapshot accessed 2026-09-12.

[^everyx]: [Everyx, registered tools](https://github.com/everyx/pi-extensions/blob/2fd03fdab465e8180a2a9736f1a9c9f18e2c4adb/packages/pi-subagent/index.ts). Source snapshot accessed 2026-09-12.

[^ogul]: [Ogul, reviewed package source](https://github.com/ogulcancelik/pi-extensions/tree/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents). Source snapshot accessed 2026-09-12.

[^claude-style]: [Claude-style Subagent, reviewed source and package metadata](https://github.com/nishuzumi/claude-style-subagent/tree/981ec288a29dfcc0e3a0f4dd2afe4a2aba73834d). Source snapshot accessed 2026-09-12.

[^nico]: [nicobailon, published 0.67.0 source boundary](https://github.com/nicobailon/pi-subagents/tree/aa75b3353836f7868898e3bd58234d21eaff1463/src). Source snapshot accessed 2026-09-12.

[^pi-launch]: [Pi 0.85.1, official compiled/Node invocation resolution](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/examples/extensions/subagent/index.ts#L249-L263). Source snapshot accessed 2026-09-12.

[^max-downloads]: [npm downloads, 2026-08-12 through 2026-09-10](https://api.npmjs.org/downloads/point/2026-08-12:2026-09-10/%40maxedapps%2Fpi-subagents).
