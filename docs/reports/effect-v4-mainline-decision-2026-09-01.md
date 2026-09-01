# Effect v4 versus main decision

> **Verdict: promote the Effect implementation to main.** After correcting the acknowledgement measurement and moving
> Context activation behind the Host acknowledgement, the optimized Effect candidate has no classified lifecycle
> regression. It is materially better than an optimized native control at fresh import while staying inside every
> frozen footprint limit. Per the requested scope, prerelease stability is not a decision factor.

**Decision finalized:** 2026-09-02  
**Frozen protocol:** [Effect v4 mainline comparison](../research/effect-v4-mainline-comparison-protocol-20260901.json)  
**Platform:** Linux x64, Bun 1.4.0, certified Pi 0.84.4 release artifact  
**Recertified native control:** `e4dd26ae250bf6e2d5de80ba9c3f3aefceb878e8`  
**Recertified Effect executable tree:** `79155ab273903f1234db8f2dc24f1ad8d91d113c`  
**Test ceiling:** four hours; every planned performance batch completed within the requested ceiling

## Decision in plain language

The original problem was not that Effect is inherently slow. The candidate initially started Context's Effect work
before Pi acknowledged direct input. That put lifecycle setup on the most latency-sensitive path and caused a real
first-input regression: about 2.19 ms on native main versus 2.56 ms on Effect, or roughly 23% in the paired comparison.

The owning seam now records the input and defers activation until the next Host turn. Hooks that actually need Context
still consume the pending activation before use, so correctness did not move behind the model request. After the fix,
fresh first acknowledgement is 2.25 ms on native versus 2.35 ms on Effect and is statistically non-inferior. A
100-pair short-resume confirmation is also non-inferior at 2.22 ms versus 2.29 ms. Steady acknowledgement and the
Provider/response paths are non-inferior as well.

The optimized native control already contains the portable Jiti-cache and Agent-scan reductions. Effect still imports
the Suite about 12.9% faster, uses about 11.5% less import CPU, and peaks about 9.2% lower in import RSS. That closes the
old attribution gap: the remaining endpoint advantage belongs to this Effect implementation, chiefly its narrowed
lazy Effect loading, rather than to portable optimizations omitted from the control.

Effect is not free. Package TypeScript code grows 3.9%, the packed archive grows 0.74%, and cold typecheck is 3.5%
slower. Background Work and Agent exit medians retain about 3.8–4.3 ms of aggregate shutdown overhead. Those costs are
inside the frozen limits and are not user-visible regressions in the measured lifecycle matrix.

## Protocol integrity

The preregistration remains unchanged and retains its original frozen arms. Two benchmark defects were then found:

1. the fixture started timing before its final Editor clear had settled; and
2. the acknowledgement metric timestamped a later Editor-clear microtask instead of the synchronous Host
   acknowledgement marker.

Both defects were fixed with focused regression tests. The first corrected measurement exposed the real pre-ACK
activation cost described above, and the product was fixed at that boundary. All decision batches were then rerun
prospectively with clean, pinned, stable arms `e4dd26ae` and `79155ab2`. This is a recertification after a declared
measurement and product correction, not a retroactive reclassification of the old samples.

The native control's `fb00fb03` checkpoint carries every portable optimization identified during the study.
`e4dd26ae` adds the same typecheck-process improvement used by the candidate. Documentation commits after
`79155ab2` do not change the measured executable Package tree.

## Gate result

| Gate | Result | Evidence |
| --- | --- | --- |
| Deterministic behavior, security, data, cancellation, cleanup, startup purity | Pass | Complete repository checks and real-Host lifecycle coverage on both executable arms |
| Fresh import non-inferiority | Pass, with superiority | Duration, CPU, and RSS improved; context switches non-inferior |
| Lifecycle non-inferiority | Pass | 143-cell screen had no regression; every screening uncertainty was resolved by higher-sample evidence |
| Package and dependency footprint at or below +5% | Pass | Archive +0.74%; TypeScript code +3.89%; dependency-tree entries +2.31% |
| Current Effect-specific material advantage | Pass | Effect beats the native control after the control received all portable optimizations |
| Exact-arm evidence integrity | Pass | Every final artifact records clean, pinned, stable `e4dd26ae` and `79155ab2` arms |
| Overall | **Promote Effect to main** | Every frozen hard gate passes |

Real external Provider lanes without configured credentials remain untested and are not claimed as passed. They are
unchanged public seams rather than evidence used by this decision.

## Runtime results

### Fresh Suite import

Each arm had five warmups and 20 paired measured fresh processes. Ratios below 1 favor Effect.

| Metric | Effect / native paired median | Paired 95% interval | Result |
| --- | ---: | ---: | --- |
| Duration | 0.8709 | 0.8505–0.8803 | 12.91% faster |
| CPU | 0.8853 | 0.8743–0.8979 | 11.47% lower |
| Maximum RSS | 0.9080 | 0.9061–0.9126 | 9.20% lower |
| Context switches | 0.9364 | 0.8962–0.9615 | Non-inferior |

This comparison does not claim that arbitrary Effect programs are faster than native TypeScript. It establishes that
the reviewed Effect implementation is better than the reviewed native implementation after both received the
portable optimizations available in this repository.

### Lifecycle coverage and precision

Coverage used four Session scenarios, seven actions, two terminal sizes, one warmup, and three paired samples per cell,
with a Host control. Its 143 comparisons classified as:

| Classification | Count |
| --- | ---: |
| Improved | 16 |
| Non-inferior | 107 |
| Inconclusive screening result | 20 |
| Regressed | 0 |

The 15-sample precision batch produced 1 improved, 46 non-inferior, 2 inconclusive, and 0 regressed comparisons. It
resolved nine of the 20 coverage uncertainties. The remaining 11 were resolved by focused higher-sample batches:

| Screening gap | Final evidence | Result |
| --- | --- | --- |
| Fresh 100×32 first and steady acknowledgement | 50 paired prompts | Both non-inferior |
| Degraded 64×28 steady acknowledgement and response | 25 paired prompts | Both non-inferior |
| Long-resume 64×28 steady acknowledgement, Provider start, and response | 25 paired prompts | All non-inferior |
| Short-resume 100×32 first acknowledgement, steady Provider start, and response | 100 paired prompts | All six measured prompt metrics non-inferior |
| Short-resume 64×28 steady acknowledgement | Independent 25-pair confirmation | Non-inferior |

The focused diagnostics timed the complete prompt path but were scoped to the unresolved metrics above. Unrelated
diagnostic metrics do not replace already-classified formal cells.

Two high-sample acknowledgement results show the remaining effect size:

| Scenario | Native median | Effect median | Paired median ratio | Paired 95% interval |
| --- | ---: | ---: | ---: | ---: |
| Fresh 100×32, first input | 2.25 ms | 2.35 ms | 1.0085 | 0.9652–1.0833 |
| Short resume 100×32, first input | 2.22 ms | 2.29 ms | 1.0361 | 1.0045–1.0741 |
| Short resume 100×32, steady input | 1.53 ms | 1.53 ms | 0.9824 | 0.9514–1.0241 |

The short-resume first-input median retains about 0.07 ms. Removing the remaining pending-state write, state read, or
Host-turn scheduling would remove the guarantee that direct input starts Context preparation after dispatch. No safe
change with a measurable user benefit remains at this seam.

### Shutdown residual

The largest repeatable shutdown differences remain non-inferior:

| Scenario | Native p50 | Effect p50 | Absolute delta | Paired ratio (95% interval) |
| --- | ---: | ---: | ---: | ---: |
| Fresh Background Work exit | 140.11 ms | 144.45 ms | +4.34 ms | 1.0485 (1.0110–1.0719) |
| Fresh Agent exit | 96.78 ms | 100.75 ms | +3.97 ms | 1.0366 (1.0060–1.0765) |
| Long-resume Background Work exit | 162.94 ms | 167.26 ms | +4.32 ms | 1.0223 (1.0115–1.0443) |
| Long-resume Agent exit | 112.79 ms | 116.56 ms | +3.77 ms | 1.0370 (1.0094–1.0684) |

`shutdownMs` covers the whole parent Pi exit, including Host cleanup, Session writes, terminal teardown, and Effect
finalization. The retained traces do not attribute the 3.8–4.3 ms to one phase. Effect finalizers already run
concurrently where ordering permits; parallelizing the remaining sequential scopes without phase evidence could
break cleanup order. Speculative shutdown code is therefore not part of this adoption.

### Absolute lifecycle budgets

The old absolute budgets remain stale for both arms. Native produced 67 findings and Effect 28. Effect removes every
startup-budget finding, while both arms still exceed old reload and synthetic Provider-response budgets. These counts
support the relative result but do not turn obsolete thresholds into a claimed green gate.

## Static and development cost

| Measure | Native control | Effect | Delta |
| --- | ---: | ---: | ---: |
| Packed bytes | 4,489,483 | 4,522,708 | +33,225 (+0.74%) |
| Package TypeScript code lines | 108,465 | 112,685 | +4,220 (+3.89%) |
| Installed dependency-tree entries | 433 | 443 | +10 (+2.31%) |
| Cold typecheck median, 3 interleaved samples | 29,998.32 ms | 31,062.61 ms | +3.55% |
| Warm typecheck median, 3 interleaved samples | 105.01 ms | 107.73 ms | +2.59% |

The typecheck comparison deletes each arm's build-info before the cold sample and immediately repeats the command for
the warm sample. It is descriptive rather than a confidence interval. Generic anti-slop, Effect anti-slop, Biome,
Oxlint, TypeScript, dependency analysis, generated-source checks, repository safety, and Package verification apply to
the complete candidate.

## Why Effect now clears the adoption bar

The performance advantage is useful, but the architectural gain is the durable reason to keep Effect. One shared
foundation now owns the root, Session, Capability, and operation Scope tree. A Fiber cannot outlive an operation
without an explicit owner; Session replacement fences old work before it can publish into the new Session; and
Capability-native shutdown remains authoritative before final Scope cleanup.

Repository checks enforce that split: effectful production work belongs in Effect, pure computation remains ordinary
TypeScript, runners stay at Pi-facing boundaries, and native external-resource protocols remain in their owning
Capability adapters. The migration deletes the corresponding dual Promise/Abort/timer lifecycle paths instead of
wrapping them. The optimized native control confirms that the final import advantage remains after portable
optimizations are removed from the comparison.

The measured costs are bounded, the public behavior is preserved, and the ownership model is now mechanically
reviewable. That combination satisfies the frozen rule and justifies making Effect the mainline implementation.

## Evidence identity

Raw samples remain local under `.artifacts/effect-mainline-comparison/`. Their SHA-256 values are:

| Artifact | SHA-256 |
| --- | --- |
| `final-native-optimized-vs-effect-lifecycle-coverage-real-ack.json` | `a3c9b5f4b3b3e1381fd913eee999e6946e55aac356a851952288bfbb50a2cb7e` |
| `final-native-optimized-vs-effect-lifecycle-precision-real-ack.json` | `0ac4f6386c7c4742a5be391f1733645c2a43de8d2d16f2181ccf5f9052d3d52e` |
| `final-79155-fresh-prompt-real-ack-combined-r50.json` | `5f6f2b9083032d4133120a30899abef533f58ea7d5fccdd5a5b99ebe89591ba8` |
| `final-79155-resume-short-100x32-prompt-combined-r100.json` | `98888fa6fffb82f404403882ddd269db8f943b587ed9444e536f56522977bb63` |
| `tight-prompt-paired-64x28-context-enabled-degraded-final-79155-gaps-r25.json` | `fa0f43bab1f1df196947cf3c4f6808abff60c33da1b0aad4f8cb5128bcbdafdf` |
| `tight-prompt-paired-64x28-context-enabled-resume-long-final-79155-gaps-r25.json` | `9eed8c552f400933e4df4c21f8c51c781d518844c9614a2e8ddab27d47dfb4ad` |
| `tight-prompt-paired-64x28-context-enabled-resume-short-real-ack-deferred-r25b.json` | `1d79c2c5420053726dfd9505704969315ea9d2378190ed4804972ee715883a4e` |
| `final-79155-native-optimized-vs-effect-import-20x5.json` | `c734a79d50cc0d9ae214bfdb6378f9d37fab1187300d61b07bfe66d31d71b92c` |
| `final-79155-static-and-development.json` | `a0047636b4a61d1b4371423e0dadf8156f2280ade53cce73d7fb7cf64717dcc5` |

The frozen protocol and superseded raw artifacts remain unchanged. Git history retains the earlier no-go report text
and its evidence; this report records the completed recertification and final mainline decision.
