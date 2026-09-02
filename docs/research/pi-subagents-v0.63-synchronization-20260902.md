# pi-subagents v0.63.0 synchronization ledger

[Simplified Chinese](../i18n/zh-CN/docs/research/pi-subagents-v0.63-synchronization-20260902.md)

Recorded on 2026-09-02. Pi Stuff is semantically synchronized with `pi-subagents` through `v0.63.0` for the retained
Agents Capability. “Synchronized” means every upstream change since the imported `v0.38.0` baseline was reviewed and
either adopted, already covered by a Pi Stuff owner, or deliberately excluded by an existing architecture boundary. It
does not mean that Pi Stuff exposes every upstream product or remains source-compatible with the upstream Package.

The completion result central to this review is explicit: ordinary delegated work has no implicit turn limit or Tool
limit. A child continues until it completes, fails, is stopped, reaches an explicit caller-supplied Tool budget, or hits
a real execution failure such as a configured timeout or unavailable Provider.

## Verified source snapshot

| Item | Verified value |
| --- | --- |
| Upstream repository | <https://github.com/nicobailon/pi-subagents> |
| Imported baseline | `v0.38.0`, commit `89de10e4bc8895e7948704c38620a5b35ddcd17e` |
| Reviewed synchronization point | `v0.63.0`, commit `4f7eb2b56dc5306416920db8c6e222c7aaad3c81` |
| Compared range | `v0.38.0..v0.63.0` |
| Releases reviewed | 30 |
| Commits reviewed | 820 |
| npm package | `pi-subagents@0.63.0` |
| npm archive size | 1,209,401 bytes |
| npm SHA-1 | `85098af67e96b8b31f3ea456daef5637c1c3de5b` |
| npm SHA-256 | `de6aff4af2ca27ffcb396578559b515f252b1050a0c7c5ffe388be1599bf485f` |
| npm integrity | `sha512-tS2zpzPnJh/tLODZGMN+XnpElOfN+l+KwDe+PnFcPfqwSd8zbirEjXR3W8uAcNlsaD8BxlDUSLHC//+v4+Ptcg==` |
| Preserved MIT license SHA-256 | `2d20dfacd9742706e564470dc77438608a1e54b0ed46959f080709389209093c` |

The Git tag, Git commit, npm `latest` metadata, downloaded npm archive, and license were verified independently. The
Git tag and npm release both identify `0.63.0`; the archive hashes above are hashes observed from the downloaded npm
release, not values inferred from Git.

## Review method

The review traversed the complete Git range and the complete upstream changelog for all 30 releases. Changed paths and
commit subjects were inspected release by release, then retained-capability changes were compared with the owning Pi
Stuff seams. Each change received one of four dispositions:

- **Adopted:** Pi Stuff needed the behavior and changed its implementation or tests.
- **Covered:** Pi Stuff already had the same required outcome under a different implementation or owner.
- **Not applicable:** the change belongs only to an upstream product surface that Pi Stuff does not contain.
- **Conflict:** adopting the upstream surface would violate an accepted Pi Stuff architecture or lifecycle boundary.

The release table makes the traversed range reproducible. The semantic tables retain exact representative upstream
commits for every relevant family; product-only commits are grouped by their upstream owner instead of copying 820
commit subjects into maintained documentation.

```sh
git rev-list --count v0.38.0..v0.63.0
git log --reverse --name-status v0.38.0..v0.63.0
git diff --stat v0.38.0..v0.63.0
git show v0.63.0:CHANGELOG.md
npm view pi-subagents@0.63.0 dist time version
```

## Release coverage

Every row was reviewed through its tag commit. Counts are the commits after the preceding row, beginning at
`v0.38.0`; together they total 820.

| Release | Date | Commits | Tag commit |
|---|---:|---:|---|
| `v0.39.0` | 2026-08-01 | 36 | `ad314315339c` |
| `v0.40.0` | 2026-08-01 | 16 | `d4d2ab706b61` |
| `v0.41.0` | 2026-08-05 | 144 | `92e3a42b1148` |
| `v0.42.0` | 2026-08-06 | 32 | `ebb2917f2b52` |
| `v0.42.1` | 2026-08-06 | 5 | `632e4ac1424e` |
| `v0.43.0` | 2026-08-07 | 24 | `9e8ce9e6af00` |
| `v0.44.0` | 2026-08-08 | 14 | `96c3fec9b502` |
| `v0.45.0` | 2026-08-09 | 20 | `23ba0b61727b` |
| `v0.45.1` | 2026-08-09 | 7 | `165ec1058215` |
| `v0.45.2` | 2026-08-09 | 7 | `7836c0f5ef64` |
| `v0.46.0` | 2026-08-10 | 18 | `4a2d5284a2ac` |
| `v0.47.0` | 2026-08-11 | 20 | `2243d13c052e` |
| `v0.47.1` | 2026-08-11 | 10 | `5d158bf6c8f6` |
| `v0.48.0` | 2026-08-13 | 20 | `56f9723416a6` |
| `v0.49.0` | 2026-08-13 | 39 | `9752fdfd5de0` |
| `v0.50.0` | 2026-08-14 | 31 | `c091da1d9b66` |
| `v0.51.0` | 2026-08-18 | 59 | `10f69cdfd1ec` |
| `v0.52.0` | 2026-08-19 | 19 | `6dc6219797fd` |
| `v0.52.1` | 2026-08-19 | 5 | `afa22c811f81` |
| `v0.53.0` | 2026-08-20 | 23 | `c91f4de5ea95` |
| `v0.54.0` | 2026-08-21 | 19 | `6f0610a6d980` |
| `v0.55.0` | 2026-08-23 | 28 | `c89d86d4db5f` |
| `v0.56.0` | 2026-08-23 | 13 | `a0e2b9e31de5` |
| `v0.57.0` | 2026-08-25 | 49 | `6cb9fb3c82a7` |
| `v0.58.0` | 2026-08-26 | 27 | `a9d0ee1a2189` |
| `v0.59.0` | 2026-08-28 | 59 | `45c0b418a3d0` |
| `v0.60.0` | 2026-08-29 | 27 | `d8c9ceb672fd` |
| `v0.61.0` | 2026-08-30 | 21 | `722bf151d8a0` |
| `v0.62.0` | 2026-08-31 | 14 | `a9b17bb71868` |
| `v0.63.0` | 2026-09-01 | 14 | `4f7eb2b56dc5` |

## Retained Agents Capability

| Semantic family | Upstream evidence | Disposition and Pi Stuff evidence |
|---|---|---|
| Delegated completion | `94ecb66` removed turn-budget controls | **Adopted** in `e07a08f`. Ordinary runs no longer receive an implicit turn budget or Tool budget. Legacy budget fields remain read-only for old artifacts; an explicit caller Tool budget remains authoritative. A 70-turn real-run regression protects convergence beyond the former limit. |
| Wedged Tool calls | `a660ea3` added smart Tool timeout defaults | **Adopted** in `4323575`. Call, launch, Agent, and environment precedence resolve one timeout; fast Tools default to five minutes and waiting Tools are exempt. Timeout evidence is durable and recoverable. |
| Per-Agent Tool exclusions | `b26da18` | **Adopted** in `d839b29`. Exclusions subtract from every Tool source, can remove fanout, and cannot silently remove a required `read` Tool. |
| Agent scan roots | `9433419`, `59d920f` | **Adopted** in `f03c3a6`. Configured roots support `~`, one whole-segment `*`, deterministic precedence, and symlink-cycle protection. |
| Model resolution and fallback | `6b9ccdb`, `fc6b580`, `5b4a1dd`, `fc17d6e`, `71ba8a5`, `15dc4ea`, `c005779`, `86119c8`, `2297ad0`, `d8d1408`, `85520f4`, `374bb15`, `053999e` | **Adopted** in `931c950`. Explicit unknown models fail; unavailable configured candidates are skipped; inherited parent models remain trusted; owner/name identifiers and thinking suffixes resolve correctly; model origin survives recovery; useful child activity prevents unsafe retry; context overflow is non-retryable. |
| Forked Tool-call identifiers | `fd86873`, `e1224d8`, `38cb5e8`, `ce8e171` | **Adopted** in `2c2a517` and `960f84c`. Inherited IDs are provider-portable and at most 64 characters, calls and results stay paired, and Provider-native composite IDs remain live where the API supports them. |
| Atomic persistence failures | `3847dee` includes preservation of the primary write error during cleanup | **Adopted** in `b34fcb0`. Synchronous and asynchronous atomic writers report the original write or rename failure instead of masking it with cleanup failure. |
| Signal-terminated children | `f9aa1d2` | **Covered.** The local process-terminal proof distinguishes manager termination, external signals, crashes, timeouts, and semantic completion; real-process regressions exercise bare `SIGTERM`, `SIGKILL`, and `SIGSEGV`. |
| Oversized control input | `bc40535` | **Covered.** Pi Stuff uses bounded, one-request-per-file control claims and a separately bounded control-event reader. An oversized record cannot block the next valid control event. |
| Oversized nested events | `35b2b5f` | **Covered.** The child protocol and nested-event model bound records, aggregate projections, depth, steps, and descendants before persistence or UI projection. |
| Fork context and continuation | upstream fork-pruning, cache-affinity, and resume fixes across `v0.51.0`–`v0.60.0` | **Covered.** Pi Stuff uses Pi Session snapshots, a bounded child continuation projection, signed recent Tool exchanges, model-aware input capacity, and durable recovery descriptors. It does not create a second fork cache. |
| Path and result-index safety | `84438a1`, `8c5269b` | **Covered.** Launch IDs and persisted Session identities are fixed-size SHA-256 derivations, nested path entries are validated, and result files live under Suite-owned private directories rather than user-controlled URI segments. |
| MCP direct Tool selection | `e0d5e4b` and later selector fixes | **Covered / not applicable.** Direct Tool grants already intersect the capability ceiling and validate available Tools. Pi Stuff has no upstream MCP metadata cache, so there is no protocol-hash cache key to migrate. |
| Agent capability discovery | `f1b338c`, `7ebae72` | **Covered.** The existing dynamic Agent roster and Tool description project discovered Agent metadata. A second public capability-list Tool would duplicate the same visible authority. |
| Child output timing footer | `bb44244` | **Covered.** Pi Stuff extracts child protocol output and does not append Pi's timing footer to the delegated result, so there is no footer-removal branch to port. |
| Storage exhaustion | `3847dee` also adds an upstream capacity-resilient queued writer | **Conflict.** Pi Stuff requires durable lifecycle evidence before advancing Agent ownership and therefore fails closed on a real storage write failure. Its observer and stale-run reconciler retain and retry unfinished evidence; it does not keep unrecorded work running while storage is full. The atomic error-preservation fix above keeps the actual `ENOSPC`/quota cause visible. |

### Local ps-qer completion controls

The upstream synchronization removes the premature default cutoffs. Pi Stuff also owns lifecycle requirements that are
outside the upstream Package boundary:

| Local requirement | Pi Stuff result |
|---|---|
| Cumulative work accounting | The initial attempt, every settled model attempt, fallback, and resume share one durable work unit. It records turns, Tool calls, input/output tokens, authoritative Provider-reported USD, model attempts, and resumes. |
| Finite expansion policy | Later automatic work requests attention at 1,000,000 reported tokens or $5.00 of reported cost. The policy never stops an in-flight child; a direct user acknowledgement resumes the retained child without resetting totals. |
| Abnormal result contract | Stable terminal classes distinguish completed, timeout, stopped, interrupted, Provider, Context, storage, protocol, explicit budget, cost guard, process, and unknown outcomes. Incomplete results carry bounded evidence, a stable Agent Target, and resume eligibility. |
| Explicit Tool budget | A hard limit blocks only the configured Tool set. Final Assistant synthesis and unconfigured Tools remain available, and a later real failure keeps its own terminal class. |
| Legacy recovery | Versionless active artifacts remain live only with current owner evidence. Terminal, dead, reused-PID, or unknown-owner records become presentation-only incomplete quarantine entries; recovery does not signal or reclaim an unknown process. |

The design input is retained in [Subagent completion controls](subagent-completion-controls-20260902.md). Credential-backed
metrics and final Host certification belong to the
[dated acceptance report](../reports/ps-qer-agent-completion-acceptance-20260902.md) rather than this upstream ledger.

## Deliberately excluded upstream product surfaces

These are not unfinished migrations. They are outside the Pi Stuff Package boundary or owned by another Pi Stuff
Capability.

| Upstream surface | Disposition | Boundary |
|---|---|---|
| Chain, Workflow, `workflowScript`, Missions, Schedules, Fleet, Herdr, and workflow lanes | **Not applicable / conflict** | Pi remains the Host; Pi Stuff does not add another CLI, runtime, session layer, or orchestration shell. Goal owns Goal continuation and terminal policy. |
| `acceptance.report` output mode (`7281103`) and upstream reviewer/watchdog acceptance layers | **Not applicable** | Structured output remains an internal retained kernel; Pi Stuff does not expose the removed Workflow/Acceptance product. |
| Watchdog, review automation, permissions broker, and LSP diagnostics | **Not applicable** | These upstream products were removed at the initial fork and have no retained local owner. |
| External CLI runners, Codex/Claude/Grok adapters, external jobs, and Worktrunk (`c29ae86`) | **Conflict** | Delegated execution stays inside Pi. Native Pi Stuff worktree isolation remains the only provider. |
| Upstream Fleet/TUI panes, token statusline, settings UI, slash aliases, and wait/auto-drain Tools | **Not applicable** | `/agents` and Suite conversation UI are the single visible authorities. Ordinary foreground Agent runs remain owned by Pi. |
| Memory, Share, Teams, upstream prompt library, bundled Agents/Skills, Doctor/admin, and profile management | **Not applicable** | These are separate upstream products, not Agents lifecycle foundations. |
| `defaultProvider`, `maxThinking`, persistent model-exclusion TTL, and related upstream profile settings | **Not applicable** | Pi's active model registry and the explicit launch/Agent model contract own selection. Pi Stuff does not add a parallel global profile system. |

## Synchronization result

The retained Agents Capability has no known unclassified `v0.38.0..v0.63.0` delta. The implementation adopts every
applicable completion, timeout, Tool-capability, discovery, fallback, fork-history, and persistence correction found in
the range, while existing local implementations cover the remaining retained behavior. Excluded changes are tied to a
named product or lifecycle boundary above rather than left as unspecified future work.

The next upstream sync must begin at `v0.63.0` / `4f7eb2b56dc5306416920db8c6e222c7aaad3c81` and append a new dated
ledger; it must not reinterpret this document as a promise of upstream API or product compatibility.
