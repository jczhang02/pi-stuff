# Behavior-preserving code reduction and Effect v4 assessment

**Research date:** 2026-08-21  
**Repository snapshot:** `55cd340`  
**Certified runtime:** Bun 1.3.14, Pi 0.84.2, Linux x64  
**Bead:** `ps-4xm` — Reduce Suite code volume and evaluate Effect v4

> **Historical recommendation:** [ADR 0016](../adr/0016-keep-capability-mechanisms-repository-owned.md) rejects upstream
> `core` or factory externalization as a Pi Stuff
> code-volume strategy. The 39,000–48,000-line target below is retired and must not be treated as an active plan.

## Historical recommendation

The earlier 184–265 line estimate answered a narrow question: how much can be deleted by local refactoring while every
Capability and dependency boundary stays fixed. That is not the useful ceiling for a 78,780-line owned implementation.

With behavior preserved, the credible architectural target is **39,000–48,000 owned production code lines**, a net
reduction of **31,000–40,000 lines (39%–51%)**. Reaching it requires upstream packages to expose deep, side-effect-free
mechanism seams and accept the Pi Stuff deltas that belong in those mechanisms. Pi Stuff remains the one Pi Package and
keeps its Capability composition, lifecycle authority, visible behavior, and certification.

This is different from moving exact local files into dependencies. Loading the current complete upstream extensions can
make this repository look like 25,000–35,000 lines, but it would increase the installed source closure and silently add
or change product behavior. That is a vanity lower bound, not an architecture target.

## Three code-volume ledgers

The primary measure is `tokei` code lines: blanks and comment-only lines are excluded.

| Ledger | Current | What it answers |
| --- | ---: | --- |
| Owned production TS/JS, excluding adapted Web/MCP runtimes | **78,780** | What Pi Stuff implements and maintains directly |
| Repository-shipped TS/JS, including adapted Web/MCP runtimes | **115,217** | How much source is present in the Pi Stuff package tree |
| Current six candidate npm package releases | **159,007** | Source shipped by the proposed dependencies before their own dependencies |

The third ledger is the sum of the published tarballs inspected on 2026-08-21:

| Package | Release | Published TS/JS code | Unpacked bytes | Public composition shape |
| --- | ---: | ---: | ---: | --- |
| `pi-subagents` | 0.53.0 | 71,020 | 3,955,953 | Root Extension factory plus selected API subpaths |
| `@narumitw/pi-goal` | 0.52.2 | 10,227 | 785,165 | Extension entry; source factory accepts only `settingsPath` |
| `pi-background-tasks` | 2.4.2 | 27,445 | 1,702,040 | Two complete Pi Extension entrypoints |
| `pi-rtk-optimizer` | 0.9.0 | 6,601 | 278,927 | Root Extension factory only |
| `pi-web-access` | 0.24.0 | 22,803 | 7,465,072 | Complete Pi Extension entrypoint |
| `pi-mcp-adapter` | 2.27.0 | 20,911 | 2,476,029 | Complete Extension plus `types` and `oauth` subpaths |

Depending on all six complete packages while retaining 25,000–35,000 local adapter/product lines would put roughly
**184,000–194,000 TS/JS lines** in the installed source closure, before transitive dependencies. The repository gets
shorter while the actual system gets larger.

## Scenario bounds

| Scenario | Owned/repository result | Net local reduction | Installed-system effect | Decision |
| --- | ---: | ---: | --- | --- |
| Keep dependency boundaries fixed; deepen local modules and reuse stdlib | 78,000–78,480 owned | 300–780 | Slightly smaller | Do now |
| Externalize deep mechanisms through supported upstream seams | **39,000–48,000 owned** | **31,000–40,000** | Similar order of magnitude; ownership moves upstream | Recommended target |
| Replace Modules with current complete upstream Extensions | 25,000–35,000 repository lines | 44,000–54,000 owned, plus 36,437 vendored-runtime lines | Approximately 184,000–194,000 lines before transitive dependencies | Reject |
| Move exact Pi Stuff code into new self-owned packages | Arbitrarily small | Cosmetic only | Unchanged | Reject |

The recommended target is conditional, not a claim that the current packages are drop-in compatible. Every externalized
mechanism needs an official exported seam and public-seam parity evidence first.

## Where the 31,000–40,000 lines can come from

### 1. Agents: externalize the execution mechanism, keep the Pi Stuff product — 24,000–30,000 lines

The local Agents Capability is **39,785 code lines**. Its `runs` subtree alone is 22,153 lines; shared durability,
process identity, claims, artifacts, discovery, and intercom add most of the remaining reusable mechanism. Pi Stuff's
extension, runtime authority, session projection, UI, and Capability-specific policy account for roughly 9,000 lines
before a required adapter is added.

The current `pi-subagents@0.53.0` package is not a suitable root dependency: its published source is 71,020 lines and its
root factory registers a larger product containing schedules, missions, Fleet, prompts, skills, watchdog behavior, and
other surfaces that Pi Stuff deliberately removed or replaced. It does expose useful protocol API subpaths, showing that
an upstream seam is feasible, but it does not export the execution kernel needed to replace Pi Stuff's local `runs`
implementation.

The behavior-preserving path is an upstream core/factory seam for child process execution, durable claims, recovery,
replay, and protocol primitives. Pi Stuff retains lifecycle authority, its six Agent tools, roster/dialog behavior,
limits, status restoration, and suite integration. Estimated local remainder: **9,800–15,800 lines**.

### 2. Goal: use the upstream state machine behind a Pi Stuff adapter — 4,500–5,300 lines

The local Goal Capability is **6,107 lines**. The current upstream source tree is 5,590 production lines and closely
matches the local module shape: accounting, commands, persistence, prompts, runtime, safety, settings, and run protocol.
This is the highest-leverage low-risk proof candidate.

The current upstream factory only accepts `settingsPath`; it cannot express Pi Stuff's manager surface, completion
evidence, retry policy, status integration, and suite restoration contract. If those deltas are accepted upstream or
exposed as explicit behavior options, Pi Stuff can retain an estimated **800–1,600-line** adapter and delete the rest.

### 3. Background Work: extract only process/storage safety — 1,500–2,200 lines

The local Capability is **3,830 lines**. The current `pi-background-tasks` release is 27,445 lines and includes delegated
agents, Fusion workflows, provider attribution, and a separate product surface. Direct substitution would multiply
system size and change behavior.

Only the durable file, process identity, output-tail, TERM/KILL, and stale-process reconciliation kernel is a plausible
package seam. Pi Stuff must keep Monitor, task identity, dialog, Tool schemas, completion delivery, and lifecycle
ownership. Estimated local remainder: **1,600–2,300 lines**.

### 4. RTK: import the pure rewrite/compaction engine — 1,000–1,500 lines

The local Capability is **2,160 lines**. The current upstream package exports only its whole Extension factory, while
Pi Stuff needs the pure command rewrite, shell-safety, source filtering, and output-compaction techniques under its own
configuration, diagnostics, and Tool presentation.

An official `core` export can leave **600–1,100 local lines**. Importing private package paths is not acceptable because
minor releases could break the Suite without an API change.

### 5. Local deepening, stdlib, and Effect — 300–800 lines

The remaining bounded deletion combines the previously identified Agent launcher deepening, terminal-text
centralization, dead compatibility types, atomic file/retry sharing, small deadline helpers, and at most one narrow
Effect-backed in-process kernel. This estimate is net of replacement adapters.

### Total owned-production target

| Candidate | Conservative deletion | Upper deletion |
| --- | ---: | ---: |
| Agents execution mechanism | 24,000 | 30,000 |
| Goal state machine/runtime | 4,500 | 5,300 |
| Background process/storage kernel | 1,500 | 2,200 |
| RTK pure engine | 1,000 | 1,500 |
| Local deepening, stdlib, optional narrow Effect | 300 | 800 |
| **Total** | **31,300** | **39,800** |
| **Result from 78,780** | **47,480** | **38,980** |

Rounded planning target: **39,000–48,000 owned production lines**.

## Web and MCP: repository reduction, not system reduction

The adapted Web runtime is 19,622 lines and the adapted MCP runtime is 16,815 lines: **36,437 repository code lines**.
The surrounding Pi Stuff adapters are already included in the 78,780 owned baseline.

If the upstream packages expose every required configuration, security, lifecycle, and UI-control seam, Pi Stuff can
delete those snapshots and keep only its adapters. That takes the full repository source target from 115,217 to the same
**39,000–48,000** range as the owned target.

It does not shrink the installed system. Current `pi-web-access` and `pi-mcp-adapter` releases contain 43,714 code lines,
7,277 more than the two local snapshots. The benefit is upstream maintenance and provenance; the costs are dependency
drift, a larger source closure, and the need to certify every update. Without the missing seams, the snapshots remain the
smaller behavior-preserving implementation.

## Effect v4's real contribution

Effect v4 is not the lever that removes tens of thousands of lines. Most of Pi Stuff's large implementations encode Pi
Host integration, OS process supervision, durable claims, crash recovery, replay, TUI behavior, and Capability-specific
lifecycle policy. Effect does not replace those contracts.

Across the repository, a shared Effect kernel could theoretically remove **350–650 lines** by unifying timeout,
cancellation, retry, finalizer, typed-error, and in-process queue mechanics. After counting the runtime owner,
Promise/`AbortSignal` boundaries, tagged errors, adapters, and tests, the credible result is **0–180 lines deleted**; a
Suite-wide conversion can add 250–700 lines.

The completed beta.106 prototype already found the representative result:

| Measure | Native | Effect | Effect delta |
| --- | ---: | ---: | ---: |
| Lifecycle implementation | 137 lines | 151 lines | +14 (+10.2%) |
| Source bytes | 4,285 | 5,496 | +1,211 (+28.3%) |
| Real Pi readiness | baseline | Effect | +23–25 ms |
| Real Pi median RSS | baseline | Effect | +15–22 MiB |
| Aggregate archive | 21,325,131 bytes | 29,551,068 bytes | +8,225,937 (+38.58%) |

Current RC.111 remains a prerelease. Its official tarball is 8,309,901 bytes, unpacks to 46,808,894 bytes, and includes
2,331 files. A fresh Bun process importing `effect/Effect` added about 24.7 ms median elapsed time and 18.0 MiB median
RSS in the local isolated measurement. Effect should be reconsidered only after stable v4 and only for one lazy-loaded,
in-process slice that beats the optimized native implementation by at least 15% net lines.

## Required upstream contract

A package substitution counts as behavior-preserving only when all of these hold:

1. Pi Stuff remains the one local Pi Package and the only default Extension composition factory.
2. The dependency exports a documented, versioned core/factory subpath; Pi Stuff never imports private paths.
3. Importing the core is pure. It registers no commands, Tools, UI, lifecycle handlers, or background work by itself.
4. Pi Stuff retains Goal, Agents, Context Management, Host, and Background Work lifecycle authority exactly as recorded.
5. Pi Stuff retains the visible Claude-style hierarchy and native Pi interaction grammar.
6. Exact versions are pinned; upstream updates are explicit maintainer work.
7. Existing real-Host RPC, package-loader, archive, replay, recovery, and PTY seams prove parity.
8. The scorecard reports both repository LOC and dependency-closure LOC so code movement cannot masquerade as deletion.

## Recommended order

1. **Goal proof:** propose an upstream configurable runtime/factory seam and demonstrate a 4,500–5,300-line local
   deletion behind existing Goal parity tests.
2. **RTK core export:** upstream the pure rewrite/compaction engine; keep Pi Stuff configuration and presentation.
3. **Agents design negotiation:** define the execution-kernel boundary before moving any code. This is the main
   24,000–30,000-line opportunity and the highest architectural risk.
4. **Web/MCP decision:** externalize only if upstream accepts all Pi Stuff security and lifecycle seams; treat it as a
   maintenance transfer, not a system-size reduction.
5. **Effect last:** run one stable-v4 spike only if native cleanup has not already removed the candidate boilerplate.

## Primary sources

- [`pi-subagents` upstream](https://github.com/nicobailon/pi-subagents)
- [`@narumitw/pi-goal` upstream workspace](https://github.com/pi-packages/narumiruna-pi-extensions)
- [`pi-background-tasks` upstream](https://github.com/ismailsaleekh/pi-background-tasks)
- [`pi-rtk-optimizer` upstream](https://github.com/MasuRii/pi-rtk-optimizer)
- [`pi-web-access` upstream](https://github.com/nicobailon/pi-web-access)
- [`pi-mcp-adapter` upstream](https://github.com/nicobailon/pi-mcp-adapter)
- [Effect 4.0.0-rc.111 release](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-rc.111)
- [Effect RC.111 package manifest](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.111/packages/effect/package.json)
- [Effect v4 migration guide](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md)

Local provenance and behavioral deltas are documented in each Capability's `UPSTREAM.md`; those records are the
authority for deciding whether an upstream package can actually preserve Pi Stuff behavior.
