# Matched Package resources and a retained input failure

Seven Suite workloads used less scoped CPU at `e7b1170e` than at the comparable pre-optimization Package `40101bb2`.
Their two-sample CPU medians fell 11.2–28.8%; every candidate value was below both corresponding baseline values.
One candidate background-Agent sample failed the frozen input gate: autocomplete appeared after 48.868 ms against
a 40.465 ms limit. The later passing sample does not erase that failure. Whole-Suite acceptance remains open.

The [numeric record](suite-comparable-resources-2026-09-06.json) retains all 32 samples, individual gate breaches,
Source identities and private-evidence hashes. Baseline and candidate use the same dependency lock and Package
dependency manifest. `40101bb2` already includes the certified Host adaptation, Work Continuity and Goal terminal
response semantics. The [earlier lifecycle comparison](suite-lifecycle-comparison-2026-09-06.md) used an older baseline
and cannot isolate this optimization's savings.

## Cost and visible feedback

All runs used the exact Pi 0.85.0 binary
`0cfd1bf3e9468f1052d172502fa388e8e8e53dcdeb9fa97f1ef828fdd7757072`, embedded Bun 1.3.14 and a 120×40 terminal.
The observer used Bun 1.4.0. Measurements ran sequentially from 17:42:14 to 17:57:55 UTC on 2026-09-06,
on an i9-13900H with 20 online logical CPUs and Linux `6.19.10-jc-xanmod1`.

Batch order was baseline/candidate/candidate/baseline. Every batch ran Goal, native Tools, Suite Tools, foreground
Agents, background Agents, Context, cold Ledger Tools and cold Ledger foreground Agents, in that order. Each sample
used a fresh private profile and user/network/PID namespaces. No task tests, agents or other profilers ran concurrently;
ambient machine activity, CPU frequency and kernel page caches were not controlled. There were no discarded warmups
or retries. Two observations per variant are descriptive, not a distributional guarantee.

| Workload | CPU median, seconds: baseline → candidate | Charged-memory peak median, decimal MB: baseline → candidate | Largest Spinner frame, ms: baseline → candidate |
| --- | ---: | ---: | ---: |
| Goal continuation and terminal response | 12.809 → 11.114 | 990.6 → 923.3 | 114.9 → 111.6 |
| Native, two Bash Tools | 2.076 → 2.126 | 195.6 → 199.4 | 110.7 → 111.0 |
| Suite, two Bash Tools | 13.443 → 11.835 | 1,034.9 → 918.6 | 111.7 → 111.8 |
| Two foreground Agents | 29.535 → 25.152 | 1,596.0 → 1,513.0 | 473.5 → 123.1 |
| Two background Agents | 29.909 → 21.300 | 2,313.5 → 1,937.6 | 519.7 → 147.6 |
| Active Context write/search | 12.755 → 11.333 | 1,015.4 → 923.0 | 112.0 → 111.2 |
| Cold Ledger, two Code Mode Bash Tools | 14.184 → 11.854 | 1,033.5 → 896.3 | 183.8 → 133.2 |
| Cold Ledger, two Code Mode foreground Agents | 30.920 → 25.809 | 1,592.6 → 1,530.8 | 572.3 → 135.4 |

CPU and charged-memory counters cover the Host cgroup, including its Workers and reaped children, until final
observation before shutdown. The observer, tmux, synthetic HTTP server and Ledger seed creation remain outside it.
Cold replay is included. Moving foreground execution to a Worker did not merely move its CPU outside these counters.

Memory did not improve in every measure. Final live-process RSS medians rose from 645.4 to 663.9 MB for direct
foreground Agents and from 684.8 to 713.2 MB for the cold-Ledger foreground case. The other Suite final-RSS medians
fell. Final RSS is a snapshot, not peak process-tree RSS; charged-memory peaks include other charges and are not
cumulative allocation. Final-process I/O omits children that have exited, so it cannot establish total I/O savings.

Every Suite run requested and persisted automatic Naming once and performed one automatic Usage HTTP refresh.
Agent cases completed two child Tools and verified both child identities were reaped; background cases also persisted
two distinct completion outcomes while the parent finished independently. Context made three native requests and
retrieved its written evidence. Goal persisted completion and one final response after automatic continuation.
The cold Ledger contained 24 synthetic executions with 800,000-character results; seeding did not disable validation.

## Why this is not a pass

All samples had continuous observations: no active Spinner absence, at least 12.145 seconds of active coverage and
no capture gap above 24.608 ms. The candidate's only gate breach was `1-candidate-background`, evidence SHA-256
`d48fce849b085ef422a2360ccd5950faa97ae003f90121f202948d7f424141a7`.
Autocomplete setup began 10,639.420 ms after the observer's time origin. Three subsequent captures still showed no
completion list; the list and queued Agent roster appeared together at 10,688.288 ms. This establishes delayed
feedback around first Agent launch, not the responsible function. It is not discarded as an observer gap or attributed
to the native Host without a matching Suite-off reproduction.

The two baseline foreground and background runs each failed Spinner/input gates; both cold-Ledger Tool runs failed
the Spinner gate, and both cold-Ledger foreground runs failed Spinner/input gates. All failures remain in the record.
The [locked thresholds](suite-responsiveness-gates-2026-09-05.json) were unchanged. Passing candidate Spinner maxima
do not excuse the separate input failure or explain previously retained late holds.

An earlier local matrix against `6d0507c1` stopped at Goal before reaching the candidate: that Package's terminal Tool
semantics did not produce the current fixture's final response. Its partial samples are excluded here. Two separate
traced CI attempts at `e7b1170e` also stopped during baseline workloads before comparing candidates
([first](https://github.com/jczhang02/pi-stuff/actions/runs/34048786759),
[second](https://github.com/jczhang02/pi-stuff/actions/runs/34049432866)). Their final frames showed completed Tools
while Pi remained in recovery; those logs did not identify the cause. Traced runs are diagnostics, not liveness gates.

Allocation/GC, peak process-tree RSS, largest main-thread work intervals and the remaining owner/recovery cases need
separate evidence. The scheduler comparison below supplies wakeup counts. These measurements preserve automatic features;
they do not execute every configured external service or close the [resource inventory](suite-resource-inventory-2026-09-05.md).

## Config-directory follow-up

A background-Agent CPU diagnostic at `7fee89ed` sampled `realpathSync` through `getProjectConfigDir` during delayed
autocomplete feedback. The helper rediscovered Pi's immutable config-directory name from the executable and package
metadata on every call, including every project ancestor. It now uses the public Host constant already available
through its SDK import. The actual discovery regression changed from four synchronous realpath calls and 32 metadata
read attempts to zero for the same nested/root lookups. Existing path precedence, selected Skills and MCP checks pass.
The utility shrank from 510 to 441 lines; no cache or dependency was added.

Four unprofiled background-Agent runs compared clean `7fee89ed` with this one-file Package change in baseline/candidate/
candidate/baseline order. They reused the fixed binary, namespaces, terminal, fresh profiles, resource scope and frozen
gates above. Each completed and reaped two children, recorded two background outcomes and automatic Naming/Usage once.
The first setup attempt lacked the new baseline worktree's dependencies and failed before Session start; it produced
no workload sample. After frozen dependency installation, the four-run batch completed without discarded samples.

| Sample | CPU, seconds | Final RSS, decimal MB | Charged-memory peak, decimal MB | Longest Spinner, ms | Slowest input/setup, ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline 1 | 20.995 | 587.5 | 1,950.5 | 160.455 | 37.473 |
| Candidate 1 | 21.267 | 597.3 | 1,959.3 | 123.937 | 72.710 |
| Candidate 2 | 21.255 | 595.5 | 1,916.8 | 111.618 | 14.059 |
| Baseline 2 | 21.237 | 589.1 | 1,938.2 | 114.089 | 14.183 |

This establishes removal of redundant operations, not a whole-workload resource saving or a stall fix. Candidate 1
still failed the 40.465 ms input gate; its evidence hash is
`72fa8cb1d855b1cec7e9b7315a523641f0e59cc3629175d363ea766deb397e5f`. Autocomplete setup began at 10,683.870 ms
and appeared with the queued Agent roster at 10,756.580 ms. All capture gaps were below 26.230 ms and no active Spinner
observation was missing. The profiler's earlier stack does not attribute this unprofiled failure, nor the original
48.868 ms event. The numeric record retains all four results and their Source/diff hashes.

## Traced CI deadline failure

The retained Provider and Session records from [run 34051108002](https://github.com/jczhang02/pi-stuff/actions/runs/34051108002)
identify why its baseline foreground observation was incomplete. Both children completed successfully. The parent
requested its final response at 2026-09-06 18:18:56.993 UTC; the fixture schedules that response four seconds later.
The last capture was at 18:18:58.831 UTC, 2,161.883 ms before the timer could fire. There was no Provider error in the
record. The 60-second observation budget ended before this traced workload finished; completed Tools were not evidence
of a Provider deadlock. Earlier failures without these records remain unattributed.

Scheduler diagnostics now request a separate 75-second observation budget. They cannot use acceptance gates, and their
results identify the diagnostic purpose and budget. Ordinary 30/60-second observations, the collector's outer 90-second
limit, isolation, completion checks and frozen responsiveness thresholds are unchanged. A successful future capture
would establish scheduler evidence, not excuse the retained input failures.

## Completed scheduler comparison

[Run 34052545498](https://github.com/jczhang02/pi-stuff/actions/runs/34052545498) completed all 28 scheduler observations
on kernel `6.17.0-1022-azure`, comparing Package `40101bb2` with `e51caab5` in baseline/candidate/candidate/baseline order.
All samples had zero lost events and complete task birth/exit accounting. The private trace instance tracked the
synthetic Host's threads, Workers and descendants through exit; the observer, tmux, HTTP fixture and Ledger seeding
were outside that boundary. No local permission change was needed.

| Workload | Median `sched_wakeup`: baseline → candidate | Change | Median `sched_wakeup_new`: baseline → candidate |
| --- | ---: | ---: | ---: |
| Native, two Bash Tools | 14,033 → 13,795.5 | −1.7% | 22 → 22 |
| Suite, two Bash Tools | 28,308 → 26,766.5 | −5.4% | 51 → 51 |
| Two foreground Agents | 77,201 → 82,507 | +6.9% | 122 → 128 |
| One background Agent | 45,936 → 40,887 | −11.0% | 89 → 89 |
| Context write/search | 24,096 → 23,637.5 | −1.9% | 25 → 25 |
| Goal continuation | 23,730 → 23,318 | −1.7% | 25 → 25 |
| Cold Ledger, two Code Mode Bash Tools | 28,730 → 27,274.5 | −5.1% | 61 → 60.5 |

Foreground isolation costs more wakeups in these samples. Its task count, including threads, rose from 122 to 128
while both implementations completed and reaped the same two child Agents. Internal task counts need not match when
comparing an isolation change; their full cost stays in the result. The Ledger baseline had 61 tasks in both runs,
while the candidate had 60 and 61. The summaries do not identify the source of that one-task variation.

The background scenario here uses one Agent, unlike the local two-Agent CPU batch. Each Suite observation retained
automatic Naming/Usage; foreground and background checks verified two and one child Tool completions respectively.
Context made three projections and retrieved its evidence; Goal completed after continuation. Artifact hashes and all
individual counters remain in `schedulerComparison` in the numeric record. Two observations per variant on a shared
runner do not establish a distribution or a causal explanation of the retained stalls. Traced timing is not ordinary
acceptance, and wakeups are not context switches.

## Targeted background-input diagnostics

Four separate diagnostics on `e51caab5` investigated the input failures without changing production behavior. The first
CPU profile observed 49.579 ms feedback, with 44 of 47 samples in that interval at native layout rendering. Sampling
also lengthened otherwise ordinary feedback, so those stacks do not establish the cause of either unprofiled failure.

Direct render timing in the next run recorded 430 paints: 360.564 ms total and 4.700 ms maximum. A separate mark around
the first FFI `flock` load measured 1.836 ms. Neither run reproduced the delayed feedback. A final file-syscall trace
recorded 18,039 completed parent-main-thread calls totaling 198.967 ms, with an 8.947 ms maximum while creating a Jiti
cache file during startup. Its slowest input/setup was 14.240 ms. These are observations from those runs, not bounds
on rare rendering or I/O delays.

All four workloads completed and reaped two child Agents, recorded two background outcomes and retained automatic
Naming/Usage. The render wrapper, FFI marks and strace command were temporary and are removed. The numeric record binds
the probes, profiles and observations to their hashes. No render rewrite, eager loading or filesystem change was made
from these non-reproducing probes; the 48.868/72.710 ms failures and historical late holds remain unresolved.
