# Magic Context under Effect: optimization and recertification

> **Verdict: keep Effect, upgrade Magic Context to 0.41.1, and do not add bundle caching or queue concurrency.**
> Effect makes cancellation, cleanup, crash containment, and Session isolation better owned; it does not make Magic
> Context's own projection algorithm faster. The 0.41.1 upgrade keeps projection performance non-inferior and brings
> upstream cache and Pi lifecycle fixes, at the cost of a larger and slower-to-build Worker bundle.

**Decision date:** 2026-09-02  
**Control:** `@cortexkit/pi-magic-context@0.40.0` in a detached clean worktree  
**Candidate:** `@cortexkit/pi-magic-context@0.41.1` with the three retained local patch behaviors  
**Platform:** Linux x64, Bun 1.4.0, certified Pi 0.84.4  
**Protocol:** 3 warmups and 10 paired samples, alternating which arm runs first; deterministic 20,000-replicate paired
bootstrap; improvement at ratio ≤0.95 and non-inferiority at upper 95% bound ≤1.10

## Plain-language result

The upgrade is worth taking. Normal Magic Context work is not meaningfully slower: fresh, short, long, and malformed
image first projections all pass the non-inferiority gate. Initialization, single commands, and measured queue wait
also pass. Upstream 0.41.x adds cache-stability repairs, Pi RPC and multi-Session fixes, schema v82, bundled-Pi CLI
detection, and optional ONNX installation hardening.

There are two real costs. The generated Worker bundle grows from 6,863,418 to 8,421,328 bytes, up 22.7%. Its build
time rises from a 93.866 ms sample median to 129.071 ms; the paired median ratio is 1.383. That build runs once when the
Context Engine Worker starts, not on every turn or Session switch. Initialization plus tokenizer preload rises only
about 3.9% by paired median and remains non-inferior.

Effect is helpful here for control, not raw arithmetic. It gives one owner for Worker lifetime, cancellation, pending
request failure, bounded cleanup, and fail-open recovery. The upstream projection still does the expensive token and
history work inside the Worker. That separation is a net positive: failures and cancellation are safer without adding
a measured steady-state projection penalty.

## Paired performance results

Ratios below 1 favor 0.41.1. Absolute columns are the median of each arm's ten samples; classification uses paired
ratios and their 95% bootstrap interval, so an absolute-median quotient need not equal the paired median.

| Metric | 0.40.0 median | 0.41.1 median | Paired ratio | 95% interval | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Worker build | 93.866 ms | 129.071 ms | 1.383 | 1.259–1.449 | Regressed |
| Initialize + tokenizer preload | 754.376 ms | 787.451 ms | 1.039 | 0.943–1.069 | Non-inferior |
| Fresh first projection | 38.362 ms | 39.807 ms | 1.038 | 0.851–1.076 | Non-inferior |
| Short first projection | 122.864 ms | 122.078 ms | 0.987 | 0.948–1.027 | Non-inferior |
| Long first projection | 1,559.720 ms | 1,573.873 ms | 0.998 | 0.963–1.019 | Non-inferior |
| Malformed-image first projection | 134.804 ms | 137.626 ms | 1.006 | 0.962–1.069 | Non-inferior |
| Fresh incremental leaf | 8.391 ms | 8.742 ms | 0.999 | 0.967–1.120 | Inconclusive |
| Short incremental leaf | 9.655 ms | 10.145 ms | 1.087 | 0.612–1.480 | Inconclusive |
| Long incremental leaf | 21.303 ms | 20.649 ms | 1.011 | 0.848–1.079 | Non-inferior |
| Malformed-image incremental leaf | 26.948 ms | 25.726 ms | 0.965 | 0.952–1.024 | Non-inferior |
| Single queued command | 1.179 ms | 1.182 ms | 0.938 | 0.784–1.064 | Non-inferior |
| Two-command elapsed time | 2.383 ms | 2.205 ms | 0.861 | 0.691–1.183 | Inconclusive |
| Inferred queue wait | 1.093 ms | 0.989 ms | 0.840 | 0.677–0.978 | Non-inferior |

Fresh and short incremental samples are noisy rather than proven regressions. Their paired medians are approximately
unchanged and +8.7%, respectively, but the intervals cross both improvement and regression thresholds. They stay in
the test matrix and are not claimed as wins.

## Why there is no bundle cache

A module-level cache would not improve first activation, because the bundle must still be built once after import. It
would save about 129 ms only when the Worker is rebuilt after a failure or full Capability restart. Normal Session
switches reuse the same Worker. Keeping the cache would retain an 8.4 MB Blob for the Host lifetime and add invalidation
questions for a path that the real workload did not show as frequent.

That trade is not justified now. Reconsider it when telemetry shows repeated Worker reconstruction in normal use, or
when rebuild time becomes a material share of user-visible recovery latency. The benchmark exports separate build and
initialization phases so that trigger is measurable.

## Why the queue stays serial

Two simultaneous status commands infer about 0.99 ms of queue wait. Removing that millisecond would require proving
which upstream handlers are read-only while preserving ordering across Session snapshots, incremental entries,
cancellation, mutable Magic Context state, and SQLite transactions. The current FIFO is the simple correctness
boundary, and the measured benefit is below the cost and risk of partitioning it.

Reconsider concurrency only if representative commands show sustained queue waits in the tens of milliseconds and a
real upstream read-only contract lets requests be partitioned without guessing.

## Upgrade and fault certification

- A forced `bun install --frozen-lockfile --force` applies the exact 0.41.1 patch.
- The three retained patch behaviors cover tokenizer root discovery, initialization preload, and known image-token
  reuse during hashing.
- A real SQLite test creates schema v82, removes `mapping_origin` and migration 82 to reconstruct v81, verifies the
  v81-to-v82 migration, then confirms a v81-fenced Worker exposes no commands or Tools against v82 storage.
- The 0.41.1 `pi.events` requirement is satisfied by a Worker-local no-op EventBus because Pi child Extensions are not
  initialized inside this Worker and therefore have no event publisher there.
- Transport tests prove that one Worker exit rejects every concurrent request with one fatal report, cancellation
  sends the protocol cancel message, and a late result cannot revive a cancelled request.
- Session-mirror tests prove replacing or deleting Session A cannot mutate Session B.
- Real Pi PTY tests pass activation, resume, Magic-only compaction, fail-open behavior, input acknowledgement, and a
  4 MiB malformed-image history.

The final real-Provider run passed on Pi 0.84.4. It aborted an active turn and completed a recovery turn, created a new
Session and switched back to the original in the same Host, cold-resumed, preserved the paused Goal and canary, kept
two non-overlapping Magic boundaries with zero native boundaries, completed two Historian runs with zero failures,
isolated a second project, and reported a 21.46% Prompt Cache hit rate. The largest provider prompt was 85,670 tokens
(66.93% of the 128k window).

## Evidence identity and source cost

- Paired benchmark: `.artifacts/magic-context-040-vs-0411-paired.json`, SHA-256
  `f3401fcb0f238167e2a5f88896cb4e24d0b34cde5e2f047baba1eb3d5ebee357`.
- Final real-Provider report: `.artifacts/magic-context-real-acceptance-0.41.1-final.json`, SHA-256
  `0fffc873cd885372fb07b880a4463a5f7ec56e8c602030c4e4ddda996c7e5670`.
- Production Context adapter growth is 15 lines: Worker transport 250→258, Worker entry +7, and the API type change is
  line-neutral. The benchmark, lifecycle verifier, and fault tests are separate Repository-owned Source and remain
  below their applicable hard size gates.

This work does not reopen the broader [Effect-versus-main decision](effect-v4-mainline-decision-2026-09-01.md). It
closes the remaining Magic Context-specific uncertainty: Effect remains the better lifecycle foundation, and 0.41.1
is the better upstream engine, but neither result justifies speculative caching or unsafe parallelism.
