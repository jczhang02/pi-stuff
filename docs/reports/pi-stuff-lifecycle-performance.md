# Pi Stuff lifecycle performance

> **Current disposition (2026-08-31):** the certified Host is Pi 0.84.4; [`docs/compatibility.md`](../compatibility.md)
> is authoritative for its identity. This report now includes the performance-only Effect v4 follow-up below. It also
> preserves measured Pi 0.84.1 and 0.84.2 lifecycle evidence: benchmark schema 6 and the regression budgets at the end
> remain executable repository checks, but historical measurements are not relabeled as Pi 0.84.4 results.

## Effect v4 performance follow-up (2026-08-31)

Bead `ps-a6b` investigated whether adopting Effect v4 had created a practical performance blocker and kept optimizing
until the remaining safe candidates were negligible, negative, or required a lifecycle/architecture trade-off. This
follow-up deliberately evaluates performance only; Effect release status is outside its scope.

The comparison uses the pre-Effect commit `d45db1a7` and the final optimized branch on the same machine with Bun 1.4.0.
Real-Host samples use the certified Pi 0.84.4 binary, one warmup, seven fresh-process samples, a 100×32 PTY, and the
deterministic fixture Provider. Control and candidate runs were bracketed where scheduler drift could affect the
result. Direct import and TypeScript measurements alternated clean pre-Effect and candidate worktrees.

### Retained optimizations

| Checkpoint | Smallest retained change | Measured reason to keep it |
| --- | --- | --- |
| `9e6c573` | Cache Jiti transforms by complete Source fingerprint across explicit changed-source refreshes. | Fixed-path refresh fell from 7,810 ms to 1,371–1,398 ms; real Pi changed-source reload p50 fell from 7,054 ms to 6,562 ms without accepting stale Source. |
| `c07c414` | Import each Effect namespace through `effect/<Module>` instead of the root barrel. | Pi startup p50 fell 7.6%, traced module-graph time 8.0%, direct import 2.7%, direct-import RSS 4.8%, and the measured warm five-profile typecheck 7.8%. |
| `cfe1c7b` | Load the Subagents execution engine at the first Agent request while keeping registration and lifecycle ownership eager. | Pi module-graph time fell 4.8% and startup 2.4%; direct import fell 1.8% and RSS 2.2%. First engine activation cost 7.67 ms on the path that uses it. |
| `dba59da` | Load Web search providers inside the first non-empty search Session effect. | Pi module-graph time fell 4.4–6.8% and startup 1.2–4.2%; the first provider load cost 4.99 ms and about 1,600 KiB only when search was used. |
| `644dc23` | Defer MCP command/proxy handlers, SDK transports, AJV, OAuth, and browser handoff until the first owning MCP action. | Fifteen alternating direct-import pairs improved 12.5% and RSS 8.7%; bracketed Pi module-graph time improved 6.9–7.6% and startup 4.4–5.0%. Immediate stdio use merely moved about 70 ms of SDK work to connection and was roughly flat end to end. |
| `13ecb01` | Replace the shared `Effect.gen` fork/join wrapper with direct `Effect.flatMap`. | Package checking instantiated 168 fewer types. Seven alternating 10,000-run batches reduced the microbenchmark median from 29.23 ms to 21.78 ms, about 0.75 microseconds per shared `EffectFoundation.run` call, while deleting generator machinery. |
| `73f555c` | Give each of the five strict TypeScript profiles its own ignored native incremental-state file. | An unchanged repeat fell from a 39.99-second cache-building pass to 9.16 and 9.02 seconds. A shared-core edit correctly forced a 39.10-second recheck, and an injected type error was detected before the probe was removed. No diagnostic was disabled. |

### Final pre-Effect comparison

The real-Host module-graph interval below runs from `suite.wrapper.imported` to `suite.module-imported`; the factory
interval is `suite.factory.start` to `suite.factory.end`. Values are seven-sample p50 milliseconds.

| Measurement | Pre-Effect | Final optimized branch | Difference |
| --- | ---: | ---: | ---: |
| Real Pi fresh startup | 3,125.71 | 2,931.32 | −194.39 (−6.2%) |
| Traced Suite module graph | 1,952.83 | 1,784.68 | −168.15 (−8.6%) |
| Suite factory after import | 16.88 | 18.26 | +1.38 ms |
| Real Pi shutdown | 100.31 | 100.64 | +0.33 ms |

The shutdown difference is not a measurable regression. In the earlier current/control/current bracket, the mean
current-minus-control 95% interval was −0.90 to +10.20 ms, and the second current-minus-first-current interval was
−5.13 to +8.40 ms. The final p50 is effectively equal to the pre-Effect control. The factory retains about 1.4 ms of
Effect ownership work, but the smaller import graph more than repays it before the editor becomes ready.

Fifteen final alternating fresh-process imports of `suite-runtime.ts` independently confirmed the graph result. Import
p50/p95 changed from 630.47/717.09 ms to 542.90/591.26 ms; maximum-RSS p50 changed from 147,892 KiB to 135,080 KiB.
The final branch therefore imports 13.9% faster while using 8.7% less peak resident memory than the pre-Effect branch.

The shipped Tool Activity benchmark remains clean: 20,000 activity calls took a 7.25 ms median, 1,000 formatted
expansions 2.51 ms, 200 streaming-tail updates 2.13 ms, and shipped exploration 1.03 ms. The Conversation Markdown
benchmark's initial 0.02 ms `thinking-32k` movement did not reproduce in an independent same-machine rerun (1.553 ms
pre-Effect versus 1.550 ms final), and the relevant Source was byte-identical. A Ponytail real-Host run completed all
18 Pi lifecycles without reproducing its earlier process-exit race, but the external model made no Tool call in any
case; that run was invalid behavior evidence and is not used as a performance result.

### Remaining frontier

Cold, uncached TypeScript checking is the one retained development regression. Five alternating complete pairs measured
36.18 seconds pre-Effect and 38.84 seconds after the runtime optimizations, a 2.66-second or 7.4% increase. Three
alternating per-profile pairs reproduced the same broad cost rather than one isolated hotspot:

| TypeScript profile | Pre-Effect p50 | Effect p50 | Difference |
| --- | ---: | ---: | ---: |
| Root | 10.49 s | 11.38 s | +8.5% |
| RTK | 4.40 s | 4.74 s | +7.6% |
| Agents | 6.56 s | 7.15 s | +9.0% |
| Agents tests | 7.26 s | 7.81 s | +7.5% |
| Package | 7.53 s | 8.08 s | +7.3% |

Compiler diagnostics attribute the shared pressure to roughly 117 more files and 165,504 more declaration lines in
the root program, repeated across five independent `tsc` processes. `skipLibCheck` is already enabled. A TypeScript
trace exhausted both the default heap and a 6 GiB heap without producing a source hotspot. Adding an explicit type to
the shared foundation increased instantiations by 17 and was reverted; the direct fork/join simplification above saved
only 168 of about 3.28 million instantiations. Native incremental state removes about 77% from unchanged repeat checks
and often reuses work after local edits, but intentionally does not hide the clean-check cost.

The runtime frontier is similarly bounded by direct experiments. Removing MCP entirely left only a 21.4 ms and about
2.4 MiB theoretical import ceiling while deleting its eager status, keep-alive, and shutdown semantics. Removing Goal
entirely exposed only 13.2 ms and about 2.6 MiB; the safe Goal UI split and combined settings/dialog splits made import
time worse. Code Mode executor, Subagents tokenizer, MCP dialog/OAuth slices, and other smaller lazy-import prototypes
were neutral, noisy, or negative and were reverted. Factory installation is only about 18 ms total, and no remaining
Capability owns a distinct safe 5–10 ms or 1 MiB closure.

Further cold-typecheck gains now require a declaration/build boundary or upstream TypeScript/Effect work; parallel
checking risks several concurrent 1+ GiB compiler processes, while project references require emitted declaration
state and conflict with the Source-only Package lane. Further startup gains require changing eager ownership semantics
or adding dynamic-import boundaries whose measured overhead exceeds the code they defer. Those are architecture or
correctness trades, not unclaimed low-risk optimizations, so this follow-up stops at the practical performance frontier.

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
improved by accepting stale code, shipping a compiled artifact, or writing during initial Package import. A disposable,
content-validated XDG transform cache used only by explicit source refresh is allowed. The certified benchmark enforces
every budget in this table rather than treating it as narrative guidance.

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
