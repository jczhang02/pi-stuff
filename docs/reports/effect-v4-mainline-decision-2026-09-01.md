# Effect v4 versus main decision

> **Verdict: do not merge yet.** The optimized Effect candidate is clearly better at fresh import, but it does not
> establish lifecycle non-inferiority or an advantage that can be attributed specifically to Effect. Per the requested
> scope, this verdict does not count prerelease stability as a blocker.

**Decision date:** 2026-09-01  
**Protocol:** [Effect v4 mainline comparison](../research/effect-v4-mainline-comparison-protocol-20260901.json)  
**Platform:** Linux x64, Bun 1.4.0, certified Pi 0.84.4 release artifact  
**Frozen baseline:** `b338a27f3c40401bdc6e72f42cc46da2813e39c6`  
**Frozen candidate:** `99e3cd50c8de851446867720cd67d118a9757877`  
**Formal wall-clock cap:** four hours; all performance batches finished by 12:50:45 +08:00

## Decision in plain language

Effect is not simply slower. The final candidate imports the Suite about 11% faster, uses about 10% less import CPU,
and peaks about 9% lower in import RSS. Those are repeatable wins.

The problem is attribution and the slower edges. The structural Effect migration by itself made import substantially
worse; later lazy-loading and cache work more than recovered the loss. Some of those optimizations are ordinary
TypeScript optimizations that native main can also use. The study therefore cannot claim that Effect caused the final
win. Lifecycle measurements also contain two preregistered regressions in resumed-prompt acknowledgement, plus
unresolved shutdown and acknowledgement results. Package TypeScript checks are about 10% slower cold and 19% slower
warm in the three-sample control.

That combination fails the frozen rule: every decision metric must be non-inferior, and a portable optimization does
not justify adopting Effect by itself.

## Measurement correction under validation

Follow-up diagnosis found that `must_editor_ready` sent its final `Ctrl-U` and returned immediately. The Prompt timer
therefore started while the Host could still be processing the benchmark's own Editor clear. This confounded
sub-millisecond input acknowledgement with prior TUI work; it was not a settled-Editor measurement.

The fixture now waits the same 20 ms polling interval after that final clear, outside the timed region. This does not
change a threshold or hide Product work. It makes the preparation boundary complete before measurement starts.

A second audit found another boundary error. The fixture observed the synchronous input-acknowledgement marker, but
reported the timestamp of a later Editor-clear marker emitted from a microtask. The metric therefore included
post-acknowledgement Editor work despite being named `acknowledgement`. First and repeated steady Prompts now record
the clock immediately after matching the acknowledgement marker, before waiting for Editor clear or Provider start.
Focused regression tests cover all three generated paths.

Exact pinned reruns after the first correction produced 5 improved, 121 non-inferior, 15 inconclusive, and 2 regressed
coverage comparisons; precision produced 2 improved, 42 non-inferior, 5 inconclusive, and no regression. A subsequent
50-pair short-resume diagnostic classified steady Editor-clear timing as non-inferior and first Editor-clear timing as
inconclusive. Those acknowledgement classifications still used the wrong later boundary and must not decide the
merge. The other lifecycle metrics remain valid. Exact-arm coverage and precision reruns with the corrected
acknowledgement boundary are pending.

## Gate result

| Gate | Result | Evidence |
| --- | --- | --- |
| Deterministic behavior, security, data, cancellation, cleanup, startup purity | Pass | Full checks passed on both arms; real V8 lifecycle tests passed 10/10 on both |
| Fresh import non-inferiority | Pass, with superiority | Three of four metrics improved; context switches were non-inferior |
| Lifecycle non-inferiority | **Fail** | Coverage had 2 regressions and 22 inconclusive comparisons |
| Package and dependency footprint at or below +5% | Pass | Archive +1.02%; dependency-tree entries +2.31% |
| Current Effect-specific material advantage | **Not established** | Final gains combine Effect-specific and portable optimizations; no native-plus-the-same-optimizations control exists |
| Exact-arm evidence integrity | Partial | Import and coverage are exact; precision moved to a documentation-only newer main commit during the run |
| Overall | **Do not merge yet** | One failed and two unresolved hard gates |

The first Effect full-check attempt failed one shared temporary-lock garbage-collection test while unrelated real Pi
processes were active. The exact test then passed 20 isolated runs, and a clean full rerun passed. This is recorded as a
test-isolation defect, not a product regression. Real external Provider lanes without configured credentials remain
untested and are not claimed as passed.

## Runtime results

### Fresh Suite import

Each arm had five warmups and 20 paired measured fresh processes. Ratios below 1 favor Effect.

| Metric | Candidate / main median | Paired 95% interval | Result |
| --- | ---: | ---: | --- |
| Duration | 0.8872 | 0.8682–0.8994 | 11.28% faster |
| CPU | 0.8970 | 0.8935–0.9171 | 10.30% lower |
| Maximum RSS | 0.9107 | 0.9037–0.9133 | 8.93% lower |
| Context switches | 0.9739 | 0.8963–0.9965 | Non-inferior |

### Lifecycle coverage

Coverage used four Session scenarios, seven actions, two terminal sizes, one warmup, and three paired samples per cell,
with a Host control. Its 143 comparisons classified as:

| Classification | Count |
| --- | ---: |
| Improved | 3 |
| Non-inferior | 116 |
| Inconclusive | 22 |
| Regressed | 2 |

The two regressions were both `steadyAcknowledgementMs` after a short Session resume:

| Cell | Candidate / main median | Paired 95% interval |
| --- | ---: | ---: |
| `resume-short/prompt/100x32` | 1.4943 | 1.3672–2.7609 |
| `resume-short/prompt/64x28` | 1.3459 | 1.3054–3.6458 |

These acknowledgement values are very small in absolute time, so the ratios amplify scheduler noise. They still block
this decision because the rule was frozen before measurement and did not include an absolute-effect exemption.

The old absolute lifecycle budgets also remain stale for both arms: main produced 54 findings and Effect 32. After
normalizing numeric values, 30 categories were shared, 24 appeared only on main, and 2 appeared only on Effect. Effect
is better overall, but neither arm can honestly claim the existing absolute budget gate is green.

### Precision batch

The 15-sample precision batch produced 38 non-inferior and 11 inconclusive comparisons, with no classified regression.
It still showed decision risks:

- fresh Background Work shutdown: ratio 1.1124, interval 1.0026–1.1529;
- fresh prompt acknowledgement: ratio 1.1615, interval 1.0072–1.4444;
- fresh prompt steady acknowledgement: ratio 1.1818, interval 1.0837–1.8667;
- resumed-long prompt steady acknowledgement: ratio 1.5357, interval 1.0960–2.0196.

This batch is supplemental rather than exact formal evidence. The main worktree fast-forwarded from `b338a27f` to
`6f7d9d03` while it ran. The intervening final tree changes no executable Package source or dependency graph; it
changes documentation, repository checks, and removes `CHANGELOG.md` from the published file list. Runtime comparison
therefore remains informative, but the commit identity violated preregistration. The runner now rejects dirty,
unpinned, or moving formal arms.

## Static and development cost

| Measure | Main | Effect | Delta |
| --- | ---: | ---: | ---: |
| Packed bytes | 9,610,330 | 9,708,090 | +97,760 (+1.02%) |
| Package TS source lines | 120,699 | 124,885 | +4,186 (+3.47%) |
| Installed dependency-tree entries | 433 | 443 | +10 (+2.31%) |
| Package typecheck cold median, 3 samples | 6,781 ms | 7,464 ms | +10.07% |
| Package typecheck warm median, 3 samples | 1,367 ms | 1,632 ms | +19.32% |

The typecheck control used a distinct build-info file for each arm and iteration. It is descriptive, not a confidence
interval. Generic anti-slop, Effect anti-slop, Biome, Oxlint, TypeScript, dependency analysis, generated-source checks,
repository safety, Package verification, and the complete repository check all passed on the tested candidate.

## What caused the import result

Three additional 20-sample paired comparisons separate the historical checkpoints:

| Comparison | Duration | CPU | Maximum RSS | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Native `d45db1a7` → structural Effect `5f94be91` | +16.36% | +14.56% | +9.59% | Effect migration initially added real cost |
| Structural Effect → optimized Effect `05250080` | -24.72% | -22.25% | -17.41% | Later optimization more than recovered it |
| Native → optimized Effect | -13.25% | -11.72% | -9.28% | Final endpoint is materially better |

The retained optimization bundle includes Effect-specific lazy import narrowing as well as portable Jiti caching and
Agent scanning reductions. Without a native arm carrying the same portable changes, the final endpoint comparison is
not causal proof for Effect.

## Next optimization work and likely payoff

1. **Background Work shutdown is the best runtime target.** The current path waits for process/storage cleanup, closes
   the Capability Scope, and later closes the shared Effect root Scope. Phase timing should prove whether work is
   duplicated or merely serial. The observed median gap is about 11%; a genuine duplicate wait could recover low tens
   of milliseconds.
2. **Keep acknowledgement work out of the immediate prompt path.** The absolute values are tiny, so the user-visible
   payoff is probably milliseconds, but this is the only statistically classified regression. Avoiding an unnecessary
   Fiber/Scope boundary is the plausible seam.
3. **Reduce Effect type exposure to the TypeScript compiler.** Narrow imports and keep large generic Effect types below
   Module boundaries. The measured development-time headroom is roughly 10–19%; some portion may be inherent.
4. **Build the missing native-plus-portable-optimizations control.** This is the shortest path to knowing whether
   Effect contributes a unique benefit or merely hosts generally useful optimizations.
5. **Isolate every lifecycle run's temporary locks and process namespace.** This removes the one observed false
   full-check failure without changing product behavior.

Random refactoring is no longer justified. The remaining work needs phase timing or the missing causal control first;
otherwise it would optimize guesses.

## Evidence identity

Raw samples remain local under `.artifacts/effect-mainline-comparison/`. Their SHA-256 values are:

| Artifact | SHA-256 |
| --- | --- |
| `formal-import.json` | `6474182e8516e44d345193bdbb1b4a681547cd145e4757b161123d6661f0f673` |
| `formal-lifecycle-coverage.json` | `9e1ac1186c290a25d376b9f4de4810b6797a191016a69604f96673db48a720c1` |
| `formal-lifecycle-precision.json` | `7d6f977e9042ae89da179e6e80359d9dfd4206fba6b19068f7d0c31696ddf512` |
| `causal-import-native-vs-structural.json` | `d585e9b0b708d215313332c1b2ff3ff307cbf4c7e5c93ab7be97942e85f7d13e` |
| `causal-import-structural-vs-optimized.json` | `2d4a6925833cc853fe56febd272108a95889ffec832dae0ceb66d8abfbc5311d` |
| `causal-import-native-vs-optimized.json` | `1af745bca36febeed7792a100b51ed80e10cb27cec6e7c3fcf482083eac10c26` |

The latest main documentation changes were merged into the Effect branch in signed commit `05f6e2a`. The benchmark
identity guard landed in `dc1f983`; it does not retroactively upgrade the deviated precision batch.
