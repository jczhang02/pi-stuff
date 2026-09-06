# ps-yon profiling permissions

Date: 2026-09-06

The local permission failure does not establish that the maintainer must grant more privileges to finish `ps-yon`.
Stopping the entire task on that basis was premature. Ordinary-user probes work on the approved Host, and the
repository already uses a GitHub-hosted VM with passwordless sudo. Kernel-event collection there still needs a probe.

## What acceptance requires

[ADR 0030](../adr/0030-remove-redundant-suite-work-without-feature-cuts.md) requires CPU, resident memory,
allocation/GC, I/O, wakeups, and operation duration, with explicit measurement limits. It does not require tracing
every individual allocation. Missing dimensions still need the directly evidenced bounds required by `ps-yon.3`
and `ps-yon.5`; a heap snapshot is not a substitute for allocation volume, and context switches are not wakeups.
None of these requirements is waived by this correction.

## Ordinary-user probe

The probe used the fixed Pi 0.85.0 Linux x64 executable, SHA-256
`0cfd1bf3e9468f1052d172502fa388e8e8e53dcdeb9fa97f1ef828fdd7757072`, with embedded Bun 1.3.14.
It cleared inherited environment variables, used fresh private configuration and a separate network/PID namespace,
and exited from a measurement-only Extension before any Provider request. The namespace's root identity mapped to
one ordinary host UID; this was not host-root execution. Parent, Worker, and child completed and exited.

| Measurement | Observed result | Limit |
| --- | --- | --- |
| Parent and child CPU profiles | 269 and 266 samples, both at a reported 1 ms interval | No per-Worker profile demonstrated; sampling does not bound every task's duration |
| `bun:jsc` heap statistics | Parent, Worker, and child returned heap size and object counts | Snapshots, not cumulative allocated bytes |
| `bun:jsc` memory usage | All three returned current and peak process memory | Worker shares its parent's process; do not sum their RSS or sum per-process peaks as a simultaneous tree peak |
| `JSC_logGC=1` | Parent/Worker and child emitted GC diagnostics | Log lines are not GC cycle counts or a complete pause/allocation account |
| `MIMALLOC_SHOW_STATS=1` | No native-heap summary appeared in this executable | Native allocation totals were not established; no permission error identified |

The result record's SHA-256 is `ff264ab29ac512f08c9375cf635623fa39252c04fea8d063b6acfc905a5f2daa`.
This was an instrumentation capability check without the Suite, not a resource-saving or acceptance benchmark.
Heap sizes stayed unchanged across a 20,000-object allocation exercise; interpreting that delta as zero allocation
would be incorrect. An earlier combined-profiler probe and a Worker `close()` probe failed and were excluded.
A separate scout reached a live Provider; it was disclosed and excluded from offline evidence.

Bun documents its JavaScript/native heap distinction, heap statistics, and CPU profiling through `BUN_OPTIONS`.
These APIs require no kernel tracing permission. See the pinned
[Bun 1.3.14 benchmarking documentation](https://github.com/oven-sh/bun/blob/bun-v1.3.14/docs/project/benchmarking.mdx)
and [`bun:jsc` declarations](https://github.com/oven-sh/bun/blob/bun-v1.3.14/packages/bun-types/jsc.d.ts).

## The narrower kernel restriction

The local `sched_wakeup` tracepoint ID was unreadable. A kernel-inclusive `perf_event_open` software context-switch
event returned `EACCES`; the userspace-only variant opened but read zero in the short probe. `/proc` and process
resource-usage context-switch counters remained readable. They do not establish a wakeup count or its upper bound.
Linux permits waking a task that has not yet descheduled; see `ttwu_runnable` and `ttwu_do_wakeup` in the
[Linux scheduler source](https://github.com/torvalds/linux/blob/v6.12/kernel/sched/core.c). That source is a semantic
counterexample, not the exact local kernel build. Access controls are described in
[`perf_event_open(2)`](https://man7.org/linux/man-pages/man2/perf_event_open.2.html).

Exact kernel-event collection through this local route needs tracing access. It does not follow that all profiling
needs elevated privileges, or that the maintainer must change permissions on their machine.

## Existing route and remaining work

The repository's [CI workflow](../../.github/workflows/ci.yml) already uses `ubuntu-24.04`, sudo package installation,
and privileged setup for isolated namespace checks. Those steps passed in
[run 34038726153](https://github.com/jczhang02/pi-stuff/actions/runs/34038726153) on
`6d4d1a27dae633a1e1141f162de668c9f9a38037`. GitHub documents fresh VMs for this runner class and passwordless sudo
on its Linux VMs in the [runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
This provides an existing environment to test the narrow kernel requirement without requesting local admin access.
Its tracepoint availability and useful workload capture have not yet been verified.

Continue the ordinary-user resource and retained-stall investigation with existing observers. The responsiveness
observer already has a separate `--cpu-profile` diagnostic mode; do not mix profiling with frozen liveness gates.
Probe kernel-event support in the existing isolated CI VM, then run matched workloads there if supported. Do not
combine a local baseline with a CI candidate, build a new profiler framework, or rerun unchanged full acceptance just
to answer this permission question. Full resource coverage, long-Session/recovery evidence, and historical-stall
attribution remain unfinished; neither the successful probe nor green CI closes `ps-yon`.
