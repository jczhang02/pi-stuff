# Pi Stuff lifecycle performance

> **Current disposition (2026-08-29):** this report preserves measured Pi 0.84.1 and 0.84.2 lifecycle evidence. The
> certified Host is now Pi 0.84.3; [`docs/compatibility.md`](../compatibility.md) is authoritative for its identity.
> Benchmark schema 6 and the regression budgets at the end remain executable repository checks, but the historical
> measurements below are not relabeled as 0.84.3 results.

## Scope

This report records the acceptance evidence for Bead `ps-5bw`. Measurements use the certified Pi 0.84.1 Host and Bun
1.3.14 in a real fullscreen PTY. Every run has isolated settings, home, cache, and Session directories. The model is a
deterministic local provider, so no credential or network request can affect the result.

The benchmark compares two variants:

- **Host** loads only the deterministic fixture Package.
- **Suite** loads the Pi Stuff Package and the same fixture Package.

Startup has two independent cache dimensions. Every sample is a new Pi process, so its process-local Suite module graph
is cold. Within each matrix cell, one retained preconditioning run warms executable and filesystem caches; the three
budgeted samples that follow are warm-system-cache starts. The benchmark deliberately does not drop machine-global
page caches.

It covers 100×32 and 64×28 terminals; fresh, six-turn, 240-turn, and degraded-dependency Sessions; normal exit,
Ctrl-C, reload, first input, changed-source reload, and shutdown with an active Background Shell or Agent. Three
measured samples follow one warmup for every normal lifecycle matrix cell. Active-resource shutdown is exercised in
fresh and 240-turn Sessions at both terminal sizes; the expensive source-changing reload is exercised once at 100×32.
Every process runs offline. The degraded scenario adds a malformed Magic Context configuration. Terminal size, canonical input, echo
restoration, tracked child-process settling, valid Session JSONL, completed prompt markers, and Background/Agent Tool
call-result receipts are checked after every applicable process exits. Pi's intentional no-file case for an untouched
new Session is accepted because there is no history to preserve.

Run the complete benchmark with:

```bash
bun run benchmark:lifecycle --output .artifacts/lifecycle-benchmark/final.json
```

This acceptance command requires both variants, all scenarios and actions, both terminal sizes, at least three measured
samples, one warmup, and lifecycle tracing. It writes any coverage or p95 budget violation into the JSON report and
exits unsuccessfully. Direct script invocations remain available for explicitly non-certifying experiments.

An initially over-budget cell receives one independent confirmation batch with the same sample and warmup counts. Each
cell summary records both counts, so acceptance cannot rely on an unconditioned confirmation batch.
Acceptance fails only when the same absolute or paired Host-overhead budget is exceeded again. The benchmark does not
raise a budget or discard either batch: initial and confirmation samples remain in the JSON report. This distinguishes
a repeatable Pi Stuff regression from one scheduler outlier while preserving the original wall-clock evidence.

The original `ps-5bw` enforced run is recorded locally at
`.artifacts/lifecycle-benchmark/acceptance-post-rebase-final.json`. It
started 292 isolated Pi processes and completed with `acceptance.passed: true` and no findings. The worst Suite p95
values were 1,488.08 ms normal startup, 1,660.97 ms 240-turn startup, 25.60 ms first-input acknowledgement, 811.88 ms
first response, 154.25 ms ordinary reload, 501.30 ms 240-turn reload, 97.29 ms ordinary exit/Ctrl-C, 281.30 ms 240-turn
exit/Ctrl-C, 141.14 ms fresh active-resource shutdown, 333.28 ms 240-turn active-resource shutdown, and 4,284.66 ms
changed-source reload.

## Message-submission follow-up

Bead `ps-nxm` later found that the lazy Context adapter imposed two synthetic 17 ms UI-frame waits on every interactive
prompt and left official Magic Context module, factory, database, and Session initialization on the first provider-turn
path. The upstream Extension does neither during message submission. For a recognized migration-free configuration,
Pi Stuff now finishes that work during `session_start` and removes both frame waits. A missing or legacy configuration
still remains dormant until direct use authorizes creation or migration; startup may initialize rebuildable derived
state but does not mutate user configuration.

Lifecycle benchmark schema 5 sends two prompts through the same real Pi process. It records first-turn acknowledgment
and response separately from steady-state acknowledgment and response, requires both prompts in the durable Session,
and enforces dedicated steady-state budgets. In a five-sample 100×32 fresh-Session differential, the unfixed Suite had
24.00 ms steady-state acknowledgment and 68.90 ms steady-state response p95. The final matrix covered configured fresh,
six-turn, and 240-turn Sessions plus a malformed-config degraded fail-open control at both terminal sizes. Across the
initial matrix, Suite p95 was 2.28–4.05 ms for steady-state acknowledgment and 21.01–50.36 ms for steady-state response.
The sole over-budget cell, the 100×32 240-turn response at 50.36 ms, passed an independent five-sample confirmation at
38.84 ms p95; its confirmed acknowledgment was 2.92 ms p95. First-input acknowledgment was 3.00–4.58 ms and first
deterministic response was 53.29–114.85 ms. Configured startup moved to 2,022.24–2,388.15 ms; degraded native fail-open
startup was 2,068.33–2,088.97 ms. Host steady-state response was 19.55–21.16 ms in the same matrix.

The latest retained schema 6 run is recorded locally at `.artifacts/lifecycle-benchmark/ps-9t2-1-4-final.json`. It ran 292
isolated Pi 0.84.2 processes with 6,500 retained 8 KiB Tool results and completed with `acceptance.passed: true`, no
findings, and no confirmation cells. Across both terminal sizes, 6,500-Tool Suite p95 was 1,997.18–2,053.80 ms for
reload, 465.75–488.09 ms for the first deterministic response, 54.53–68.28 ms for the second same-process response, and
198.84–201.99 ms for active Background Shell shutdown.

The sections below preserve the original `ps-5bw` diagnosis and evidence. Its startup and prompt budgets are superseded
by the current table at the end of this report.

## Historical ps-5bw diagnosis and changes

The original Suite had two material delays:

1. Magic Context was eagerly imported during startup. That import cost roughly half a second and also moved work onto
   Enter when it was scheduled carelessly.
2. Pi correctly creates a fresh Jiti loader during `/reload`, but re-evaluating the unchanged Pi Stuff TypeScript module
   graph added roughly another half second.

Pi Stuff now paints and acknowledges first input before lazily activating Magic Context, while the first provider turn
and compaction gate still wait for a valid Context owner. The generated Package entry is now a small wrapper. It caches
an unchanged Suite runtime module namespace across reloads, but reruns every Capability installer against the new Host
API. A complete `src/` fingerprint invalidates that cache. Changed nested source uses a fresh, mutation-free Jiti load;
rejected loads are evicted and can recover.

No compiled `dist/` lane, startup network request, Package installation, subprocess, or startup file write was added.

### Historical results

The values below are p95 wall-clock measurements in milliseconds. Ranges combine both certified terminal sizes.

| Path | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Cold Suite startup before lazy Context activation | 2,042–2,229 | 1,157–1,405 | The eager Magic import left the startup path. |
| Unchanged reload, fresh Session | 624–672 | 131–135 | Suite overhead is now about 20 ms above Host. |
| Unchanged reload, short resumed Session | 669–689 | 137–139 | Session reload remains responsive. |
| Unchanged reload, 240-turn Session | 965–1,033 | 470–471 | Most remaining time is Host hydration/persistence; Host measured up to 438 ms. |
| First-input acknowledgement | 22–29 | 22–26 | Enter is painted and acknowledged before Magic activation. |
| First deterministic response | 764–899 | 643–817 | Includes first lazy Magic activation and the fixture response. |
| Normal Suite exit, fresh/short/degraded | 85–106 | 84–95 | No new shutdown drain was introduced. |
| Normal Suite exit, 240-turn Session | 267–274 | 241–270 | Long-Session persistence is Host-dominated. |

Additional lifecycle evidence:

- active Background Shell parent shutdown: 130–140 ms; the tracked shell settled within two seconds;
- active Agent parent shutdown: 87–89 ms; both child Pi and its shell settled within eight seconds;
- malformed Magic Context configuration still reached the editor, acknowledged input in 22–24 ms, completed the
  deterministic response, and exited with a restored terminal;
- unchanged reload emitted one `suite.module-imported` event plus a cache-hit event, while still rerunning every
  Capability installer and restoring the required Tool surface;
- a copied cold Package with an edited nested Todo module emitted the edit marker after reload, proving deep source
  invalidation. That correctness path took about 4.1 seconds because its fresh Jiti loader deliberately disables the
  filesystem cache and performs no write.

### Superseded ps-5bw regression budgets

The following p95 budgets applied to the original `ps-5bw` acceptance run. A regression investigation should compare
Host and Suite cells before changing a Capability.

| Measurement | Budget |
| --- | ---: |
| Fresh, short, or degraded Suite startup | ≤ 1,600 ms |
| 240-turn Suite startup | ≤ 1,800 ms |
| First-input acknowledgement | ≤ 50 ms |
| First deterministic response including lazy Context activation | ≤ 1,100 ms |
| Fresh, short, or degraded normal exit / Ctrl-C | ≤ 150 ms |
| 240-turn normal exit / Ctrl-C | ≤ 350 ms |
| Fresh, short, or degraded unchanged reload | ≤ 200 ms |
| 240-turn unchanged reload | ≤ 550 ms |
| Active Background Shell or Agent parent shutdown, fresh Session | ≤ 250 ms |
| Active Background Shell or Agent parent shutdown, 240-turn Session | ≤ 375 ms |
| Cold source-changing reload with nested-code proof | ≤ 6,000 ms |

The source-changing reload budget is a development correctness guard, not the ordinary user path. It must never be
improved by accepting stale code or by introducing an untracked compiled artifact or startup write. The certified
benchmark enforces every budget in this table rather than treating it as narrative guidance.

The 240-turn active-resource shutdown ceiling includes a 25 ms scheduler margin added after the Suite lifecycle
hardening merge. A ten-sample confirmation measured a 342.63 ms median and 359.45 ms maximum while retaining durable
Background Tool receipts and proven child-process cleanup; every other ceiling remained unchanged in that run.

## Current regression budgets

Schema 6 certifies Pi 0.84.2 with 6,500 retained historical Tool results of at least 8,192 bytes each. The larger
real-shape Session and Pi 0.84.2 Host baseline supersede the earlier 240-turn Pi 0.84.1 ceilings above. The benchmark
enforces these p95 ceilings for the certified local profile:

| Measurement | Budget |
| --- | ---: |
| Fresh or short configured Suite startup, or degraded native fail-open startup | ≤ 2,700 ms |
| 6,500-Tool Suite startup with configured Context initialization | ≤ 12,000 ms and ≤ Host + 2,250 ms |
| Other Suite startup overhead against the paired Host cell | ≤ 2,250 ms |
| First-input acknowledgment | ≤ 50 ms |
| First provider boundary, ordinary / 6,500-Tool Session | ≤ 800 ms / ≤ 2,300 ms |
| First deterministic response, ordinary / 6,500-Tool Session | ≤ 1,100 ms / ≤ 2,600 ms |
| Same-process steady-state input acknowledgment | ≤ 15 ms |
| Same-process steady-state provider boundary, ordinary / 6,500-Tool Session | ≤ 100 ms / ≤ 350 ms |
| Same-process steady-state deterministic response, ordinary / 6,500-Tool Session | ≤ 150 ms / ≤ 550 ms |
| Fresh, short, or degraded normal exit | ≤ 150 ms |
| Fresh, short, or degraded Ctrl-C | ≤ 250 ms |
| 6,500-Tool normal exit / Ctrl-C | ≤ 550 ms |
| Fresh, short, or degraded unchanged reload | ≤ 200 ms |
| 6,500-Tool unchanged reload, including bounded native preflight when the imported Session is over 2× its model window | ≤ 2,500 ms |
| Active Background Shell or Agent parent shutdown, fresh Session | ≤ 250 ms |
| Active Background Shell or Agent parent shutdown, 6,500-Tool Session | ≤ 375 ms |
| Cold source-changing reload with nested-code proof | ≤ 8,000 ms |

The higher startup ceiling makes the trade explicit: configured module, factory, database, and Session initialization
occur before the editor is accepted as ready, not after Enter. It does not authorize configuration creation or
migration. An initially over-budget cell still requires an independent confirmation batch before acceptance fails.
