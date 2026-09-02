# Magic Context under Effect: optimization and recertification

> **Verdict: keep Effect, upgrade Magic Context to 0.41.1, and do not add bundle caching or queue concurrency.**
> Effect makes cancellation, cleanup, crash containment, and Session isolation better owned; it does not make Magic
> Context's own projection algorithm faster. The 0.41.1 upgrade keeps projection performance non-inferior and brings
> upstream cache and Pi lifecycle fixes, at the cost of a larger and slower-to-build Worker bundle.

- **Decision date:** 2026-09-02
- **Control:** `@cortexkit/pi-magic-context@0.40.0` in a detached clean worktree
- **Candidate:** `@cortexkit/pi-magic-context@0.41.1` with the three retained local patch behaviors
- **Platform:** Linux x64, Bun 1.4.0, certified Pi 0.84.4
- **Protocol:** 3 warmups and 10 paired samples, alternating which arm runs first; deterministic 20,000-replicate paired
bootstrap; improvement at ratio ≤0.95 and non-inferiority at upper 95% bound ≤1.10

## Plain-language result

The upgrade is worth taking. Normal Magic Context work is not meaningfully slower: fresh, short, long, and malformed
image first projections all pass the non-inferiority gate. Native Worker-handle start and initialization also pass.
The millisecond-scale command and queue measurements are too noisy to classify, but remain too small to justify a
more complex scheduler. Upstream 0.41.x adds cache-stability repairs, Pi RPC and multi-Session fixes, schema v82,
bundled-Pi CLI detection, and optional ONNX installation hardening.

There are two real costs. The generated Worker bundle grows from 6,863,704 to 8,421,328 bytes, up 22.7%. Its build
time rises from a 101.599 ms sample median to 136.854 ms; the paired median ratio is 1.391. That build runs once when
the Context Engine Worker starts, not on every turn or Session switch. Native Worker-handle start remains below one
millisecond and non-inferior. Initialization plus tokenizer preload, measured after subtracting handle start, rises
only about 1.7% by paired median and remains non-inferior.

Effect is helpful here for control, not raw arithmetic. It gives one owner for Worker lifetime, cancellation, pending
request failure, bounded cleanup, and fail-open recovery. The upstream projection still does the expensive token and
history work inside the Worker. That separation is a net positive: failures and cancellation are safer without adding
a measured steady-state projection penalty.

## Paired performance results

Ratios below 1 favor 0.41.1. Absolute columns are the median of each arm's ten samples; classification uses paired
ratios and their 95% bootstrap interval, so an absolute-median quotient need not equal the paired median.

| Metric | 0.40.0 median | 0.41.1 median | Paired ratio | 95% interval | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Worker build | 101.599 ms | 136.854 ms | 1.391 | 1.230–1.452 | Regressed |
| Worker-handle start | 0.671 ms | 0.477 ms | 0.648 | 0.438–1.030 | Non-inferior |
| Initialize + tokenizer preload | 769.386 ms | 784.051 ms | 1.017 | 0.978–1.090 | Non-inferior |
| Fresh first projection | 38.383 ms | 39.423 ms | 1.002 | 0.955–1.087 | Non-inferior |
| Short first projection | 120.828 ms | 118.821 ms | 0.996 | 0.975–1.003 | Non-inferior |
| Long first projection | 1,528.344 ms | 1,548.235 ms | 1.015 | 0.973–1.066 | Non-inferior |
| Malformed-image first projection | 132.128 ms | 136.297 ms | 1.019 | 0.956–1.073 | Non-inferior |
| Fresh incremental leaf | 8.546 ms | 9.007 ms | 1.077 | 0.799–1.206 | Inconclusive |
| Short incremental leaf | 13.243 ms | 13.430 ms | 1.077 | 0.668–1.302 | Inconclusive |
| Long incremental leaf | 20.990 ms | 23.626 ms | 1.046 | 0.876–1.142 | Inconclusive |
| Malformed-image incremental leaf | 26.066 ms | 27.666 ms | 0.977 | 0.851–1.038 | Non-inferior |
| Single queued command | 1.229 ms | 1.206 ms | 1.029 | 0.695–1.150 | Inconclusive |
| Two-command elapsed time | 2.389 ms | 2.450 ms | 0.928 | 0.788–1.252 | Inconclusive |
| Inferred queue wait | 1.165 ms | 1.251 ms | 0.943 | 0.632–1.415 | Inconclusive |

Fresh, short, and long incremental samples are noisy rather than proven regressions. Their paired medians rise by
about 7.7%, 7.7%, and 4.6%, respectively, but every interval crosses both improvement and regression thresholds.
They stay in the test matrix and are not claimed as wins. The malformed-image incremental path remains non-inferior.

## Why there is no bundle cache

A module-level cache would not improve first activation, because the bundle must still be built once after import. It
would save about 137 ms only when the Worker is rebuilt after a failure or full Capability restart. Normal Session
switches reuse the same Worker. Keeping the cache would retain an 8.4 MB Blob for the Host lifetime and add invalidation
questions for a path that the real workload did not show as frequent.

That trade is not justified now. Reconsider it when telemetry shows repeated Worker reconstruction in normal use, or
when rebuild time becomes a material share of user-visible recovery latency. The benchmark exports separate build,
Worker-handle start, and initialization phases so that trigger is measurable.

## Why the queue stays serial

Two simultaneous status commands infer about 1.25 ms of queue wait. Removing that millisecond would require proving
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
  `a2150fa9a35950753c51d443804d955fe05e72bdada577dae7ed82fb4bbaeba2`.
- Final real-Provider report: `.artifacts/magic-context-real-acceptance-0.41.1-final.json`, SHA-256
  `0fffc873cd885372fb07b880a4463a5f7ec56e8c602030c4e4ddda996c7e5670`.
- Production Context adapter growth is 15 lines: Worker transport 250→258, Worker entry +7, and the API type change is
  line-neutral. The benchmark, lifecycle verifier, and fault tests are separate Repository-owned Source and remain
  below their applicable hard size gates.

This work does not reopen the broader [Effect-versus-main decision](effect-v4-mainline-decision-2026-09-01.md). It
closes the remaining Magic Context-specific uncertainty: Effect remains the better lifecycle foundation, and 0.41.1
is the better upstream engine, but neither result justifies speculative caching or unsafe parallelism.
