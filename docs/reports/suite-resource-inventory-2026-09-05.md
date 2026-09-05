# Suite resource source inventory

This 2026-09-05 inventory covers the 16 Capabilities in [suite.json](../../packages/pi-stuff/suite.json) and shared
loading/status/registration paths at `07d2f473`. It records investigation targets, not permission to remove features.
The [continuous observer](suite-responsiveness-observer-2026-09-05.md) and the MCP/RTK samples below record workload
costs; the individual source operations in the table remain unmeasured.
Repeated source operations are not automatically redundant: discovery, validation, recovery and visible refresh may
require them. Beads `ps-yon.3` owns the missing measurements under [ADR 0030](../adr/0030-remove-redundant-suite-work-without-feature-cuts.md).

## Owners, triggers and scaling

`B` means Session branch entries, `T` means Tools or tasks in the indicated owner, and `P` means payload bytes.
The retention column describes observed safeguards; it does not certify a complete memory bound.

| Capability / source owner | Trigger and work to measure | Scaling; existing reuse or release |
| --- | --- | --- |
| Conversation UI — [SessionStatusSource](../../packages/pi-stuff/src/conversation-ui/statusline-session.ts) | Statusline repaint reads Session/leaf; a changed leaf walks ancestry to a cached entry. | Same leaf returns cached state; new tail costs its entry count. Session change resets the ancestry cache. Measure long-Session retention. |
| Session Naming — [controller](../../packages/pi-stuff/src/session-naming/controller.ts) | Settlement/manual naming gets the branch and selects messages; initial naming can scan the full branch. | O(B); later selection uses six messages. Prompt text is capped per message and model attempts have timeouts. Automatic naming remains enabled. |
| Tool Display — [ToolGroupProjection](../../packages/pi-stuff/src/tool-display/group-projection.ts) | Structural Tool/transcript changes rebuild envelope/group indexes; member-only updates also have an incremental path. | Bounded transcript projection; measure rebuild frequency and copied payload, not only final row count. |
| Tool Display — [activity clock](../../packages/pi-stuff/src/tool-display/activity-clock.ts) | Active timers update markers and reconcile leaders every 600 ms. | O(active timers), explicit 768-state bound; stops with no timers. Animation is functional cost, not a removal candidate. |
| RTK — [RtkRuntime](../../packages/pi-stuff/src/rtk/runtime.ts) | Every eligible rewrite calls `assertStable`, resolving/statting and hashing the executable after certificate lookup. | O(executable bytes) per command. Certificate reuse does not remove this read. Drift detection must survive any optimization. |
| Codex — [automatic usage](../../packages/pi-stuff/src/codex/index.ts), [HTTP reader](../../packages/pi-stuff/src/codex/usage.ts) | Settled direct-user work refreshes account usage; response text is read and parsed. | O(P); concurrent refreshes coalesce. Network behavior remains functional cost; measure any duplicate work separately. |
| Goal — [accounting](../../packages/pi-stuff/src/goal/src/accounting.ts) | Usage updates obtain and scan the full branch across settlement, command, menu and compaction paths. | O(B) per update; no incremental usage cache observed. Correct token accounting remains required. |
| Goal — [persistence](../../packages/pi-stuff/src/goal/src/persistence.ts) | Session start/reload selects the latest canonical or legacy Goal entry and normalizes it. | O(B + queue); bounded Goal queue. Replay is necessary; measure repetition separately. |
| Context Management — [projection](../../packages/pi-stuff/src/context-management/projection.ts) | Context/provider activation projects messages; concurrent requests for the same key share work. | O(message payload); provider cache matches model and ordered message identities. Invalidation clears projections/flights; measure retained maps and cold rebuilds. |
| Context Management — [worker snapshots](../../packages/pi-stuff/src/context-management/magic-worker-host.ts) | Activation and event dispatch serialize Host context and Tool metadata for the worker. | O(P + Tool schemas); execution-end result/details are omitted and Tool-call arguments are filtered. Measure repeated schema transfer. |
| Ponytail — [instructions](../../packages/pi-stuff/src/ponytail/instructions.ts), [state](../../packages/pi-stuff/src/ponytail/state.ts) | First Skill use reads the canonical body; Session start restores mode and settings; prompt generation filters the Skill catalog. | Canonical body cached once, owners use a WeakMap. Inspect the Session-identity notification Set's lifetime; retained identities are not yet a demonstrated leak. |
| Web — [storage](../../packages/pi-stuff/src/web/runtime/storage.ts) | Search/fetch persists results; Session start/tree restores stored references from the branch. | O(B + P); one-hour TTL and shutdown clear. TTL alone does not establish peak retained bytes. |
| Web — [implementation](../../packages/pi-stuff/src/web/runtime/implementation.ts) | Each search/fetch snapshots settings and publishes its result; retrieval slices stored content. | O(query/result size); settings snapshots may support live configuration. Measure normalization and publication separately. |
| MCP — [metadata cache](../../packages/pi-stuff/src/mcp/runtime/metadata-cache.ts), [initialization](../../packages/pi-stuff/src/mcp/runtime/init.ts) | Startup reconstructs cached metadata; metadata settlement serializes and writes Tools/resources. | O(metadata bytes); cache version, configuration hash and seven-day age invalidate stale data. Connection/disconnect execution still needs separate measurement. |
| Background Work — [runtime](../../packages/pi-stuff/src/background-work/src/runtime.ts), [storage](../../packages/pi-stuff/src/background-work/src/storage.ts) | Active-task heartbeat persists recovery metadata; recovery enumerates owned directories and verifies process identities. | O(active tasks/owned directories); production heartbeat is five seconds and stops when inactive/disposed. Atomic writes and ownership checks are required. |
| Background Work — [Tasks dialog](../../packages/pi-stuff/src/background-work/src/tasks-dialog.ts) | Open dialog receives changes and refreshes each second. | O(tasks); timer is canceled on disposal. This dialog is not a permanent 250 ms poll. |
| Agents — [discovery](../../packages/pi-stuff/src/subagents/src/agents/agents.ts) | Startup/refresh and launch discover definitions using awaited directory operations and file reads. | O(files + Markdown bytes); repeated discovery has no cache here. Async I/O may cost resources without synchronously blocking the UI. |
| Agents — [public execution](../../packages/pi-stuff/src/subagents/src/extension/public-agent-execution.ts), [result watcher](../../packages/pi-stuff/src/subagents/src/runs/background/result-watcher.ts) | First execution imports the foreground executor; background results use filesystem events plus a three-second safety scan. | Import Promise reused; result work deduplicated and watcher state cleared on stop. Measure launch, settlement and recovery independently. |
| Todo — [replay](../../packages/pi-stuff/src/todo/state/replay.ts), [store](../../packages/pi-stuff/src/todo/state/store.ts) | Startup/tree/compaction replay scans branch candidates and validates snapshots/dependencies; mutations replace Session-owned state. | O(B + tasks); no replay cache observed. Session shutdown evicts its store. Validation is functional cost. |
| Todo — [overlay](../../packages/pi-stuff/src/todo/todo-overlay.ts) | Changes and rendering filter/count task arrays and retain recent completions. | O(tasks); timed completion retention and disposal cleanup. Repeated scans need timing evidence before consolidation. |
| BTW — [context](../../packages/pi-stuff/src/btw/btw.ts), [history](../../packages/pi-stuff/src/btw/btw-history.ts) | Invocation converts the effective branch; overflow retry refits it. Hydration scans entries; exchanges copy/filter and bound retained history. | O(B + P); context fitting budget and 1,000-exchange/8 MiB history bound. Session shutdown releases history. |
| Notification — [runtime](../../packages/pi-stuff/src/notification/runtime.ts) | Qualifying settled work starts one cancellable grace timer; state changes cancel it. | No recurring poll found; delivery reads in-memory settings and emits terminal output. No redundant hotspot established. |
| Code Mode — [Ledger](../../packages/pi-stuff/src/code-mode/ledger.ts), [normalization](../../packages/pi-stuff/src/code-mode/ledger-state.ts) | First lookup normalizes canonical records and restores values; ordinary branch progress folds only new entries. | Cold O(Ledger bytes), warm O(new tail). Cold Spinner failure reproduced; do not reimplement the already-present warm fix. Clone/JSON roundtrips remain candidates, with Host record ownership and validation intact. |
| Code Mode — [host client](../../packages/pi-stuff/src/code-mode/host/host-client.ts) | Execution builds a Tool map and sends definitions to the shared helper. | O(Tool schemas); one shared startup Deferred. Measure repeated definitions separately from helper execution. |

## Shared paths

| Owner | Trigger and work | Existing safeguard / measurement gap |
| --- | --- | --- |
| [Suite loader](../../packages/pi-stuff/src/suite-loader.ts) | Load/reload resolves the root and fingerprints the source tree before import-cache lookup. | O(files + source bytes); matching fingerprints reuse import/install, failed promises are removed. Measure unchanged reload I/O before changing drift detection. |
| [Shared status channel](../../packages/pi-stuff/src/conversation-ui/statusline-channels.ts) | Publication normalizes and serializes old/new snapshots before listener fan-out. | Small fixed schemas; equality avoids unchanged notifications. Frequency/cost unmeasured. |
| [Tool registration](../../packages/pi-stuff/src/tool-display/registration.ts) | Final registry coverage validation enumerates Tools; reload handoff restores missing historical definitions. | O(T); early returns and missing-only recovery. Coverage and historical rendering must remain correct. |

## Evidence still required

This completes a source inventory pass, not the complete resource audit. For each owner, run the applicable startup,
idle, long-Session, Tool/Agent, settlement and recovery workload. Record measured cost and disposition; source inspection
alone cannot close a suspected hotspot. Include child processes and Context workers, not only the parent Pi process.

Continuous foreground and background Agent observation now reaches real child Tool results and verifies birth-bound
process exit. Both modes expose gate failures without Code Mode or old Ledger. Background observation also checks
parent-idle input/selection, canonical completion records and two launches through Code Mode. Native Context request
projection and memory write/retrieval now have scoped CPU and charged-memory measurements, including a Code Mode pair
with and without old Ledger. The resource observer also records live direct cgroup members' RSS and I/O, including
still-running Code Mode helpers; waited-child I/O follows the kernel's aggregation rules. These snapshots do not
establish cumulative allocation, peak process-tree RSS or each owner's repeated work. Recovery, complete resource
dimensions and before/after closure remain open; see the [observer report](suite-responsiveness-observer-2026-09-05.md).

Normal Goal continuation now also has two scoped real-Host samples with automatic Naming/Usage, successful Goal Tool UI,
and canonical completion preceding the final response. Both passed the frozen gates. Their whole-process counters do not
isolate Goal accounting cost or certify Goal replay, compaction and recovery; those investigations remain open.

## Existing MCP and RTK verifier measurements

At `02547c8b`, the unchanged [MCP verifier](../../scripts/verify-mcp-pty.ts) and
[RTK verifier](../../scripts/verify-rtk-pty.ts) both passed on the exact certified Pi 0.85.0 executable. An external
Bun 1.4.0 reader inherited the PTY descriptors, waited for each Pi child to exit, then read `child.resourceUsage()`.
Existing verifier, continuous-observer and product Source were unchanged. The
[numeric record](suite-resource-inventory-2026-09-05.json) binds the samples
to executable, verifier, fixture and reader hashes. The first attempt failed before Pi started because GNU `time`
was absent; it produced no resource sample. The installed Bun API supplied the counters instead.

The two commands were `bun scripts/verify-mcp-pty.ts` and `bun scripts/verify-rtk-pty.ts`, with `PI_BIN` pointing to
the external reader around the certified Host and `RTK_BIN` selecting certified RTK 0.45.0. Each verifier ran under
`unshare --user --map-root-user --net --pid --fork --kill-child --mount-proc`; MCP enabled only the new namespace's
loopback interface. Their private configuration and synthetic Sessions did not touch the running user Pi.

| Workload, in execution order | Start, UTC | CPU seconds | Child lifetime seconds | Bun maxRSS, decimal MB |
| --- | --- | ---: | ---: | ---: |
| MCP light setup | 08:26:44.840 | 6.279 | 7.808 | 734.966 |
| MCP dark setup | 08:26:52.707 | 5.011 | 6.521 | 737.624 |
| MCP connection, Tool and historical Session | 08:27:05.025 | 10.384 | 12.831 | 835.863 |
| RTK fresh execution | 08:33:18.935 | 20.309 | 14.027 | 927.912 |
| RTK restart and resume | 08:33:33.042 | 7.201 | 7.204 | 687.849 |

RTK's separate `--version` preflight used 0.498 CPU seconds and did not load the Suite. All six Pi children exited
with status zero. MCP exercised local stdio Tool execution, HTTP discovery and graceful termination, a failed
connection, confirmed configuration changes, and display of a seeded historical Tool result after Session switching.
It also asserted that opening the dialog did not connect either server. The resumed history was seeded, not a
crash-recovery trace. RTK executed three rewritten Bash commands and one 1,600-line ANSI-output command, then started
a new Host on the same Session and verified unchanged raw history and identical bounded model projection.

These are whole-Host workload counters, not MCP/RTK attribution or optimization comparisons. The
[Bun API](https://bun.sh/docs/runtime/child-process#resource-usage) reports CPU microseconds and maxRSS bytes.
Native waited-descendant accounting can include child work; the reader, Expect, `script` and sibling HTTP fixture
server are outside this boundary. maxRSS is not aggregate peak process-tree RSS, filesystem counters are operations
rather than bytes, and context switches are not wakeups. The [Linux accounting contract](https://man7.org/linux/man-pages/man2/getrusage.2.html)
describes these limits. Wall time includes deliberate verifier interaction waits and is not an interface-stall metric.

Both verifiers use offline Providers; RTK additionally disables Naming explicitly and uses preapproved Bash. They
do not certify automatic Naming/Usage, live OAuth, native Context payloads or continuous Vibe Line/input/selection
gates. MCP uses fresh private HOME/XDG/Agent/project/Session directories; its ambient temporary and source caches
were not reset. RTK uses a fresh private HOME/XDG/TMPDIR, but fresh/resume share their fixture state. The kernel page
cache was not reset for either verifier. Different themes and fresh/resume workloads are not paired optimization
samples. Per-owner repetition, scale, crash recovery, allocation/GC and complete resource dimensions remain open.

### RTK executable-read attribution

A separate diagnostic launched at 08:51:10 UTC on `dee4f81b` repeated the unchanged RTK verifier with strace 7.1
following the exact Host and filtering file operations to the certified RTK executable. Fresh and resumed verification
passed. The fresh trace contains five complete reads of the 10,326,432-byte binary: 51,632,160 bytes returned to user
buffers, through ten positive `read` calls and five EOF reads. Five additional `O_PATH` opens inspect identity without
reading content; counting every open as a full read would double the result. The parser joined the one interrupted
read with its resumed return. Trace/source hashes and counts are retained in `rtkIdentityTrace` in the numeric record.

The [runtime owner](../../packages/pi-stuff/src/rtk/runtime.ts) explains the count: `certify()` reads once, and
`assertStable()` reads before each of the four rewrite requests, including the command for which RTK returns no
replacement. There were one version probe, four rewrite executions and three resulting RTK command executions.
Opening the already-ready dialog added no read. The resumed fixture performed no tracked RTK executable read or
execution. This rules out extra certification in this measured sequence, not in every possible concurrent workload.

Retain these identity checks under the current [drift-detection contract](../capabilities/rtk.md#runtime-verification).
The existing runtime and certified-executable tests passed on repository Bun 1.4.0: 14 tests, 60 assertions, including
cached verification, concurrent verification deduplication, path changes and in-place binary changes. The evidence
does not justify weakening the contract to avoid its reads. It also does not establish that the complete RTK
implementation has no removable work.

strace changes scheduling. Its read durations are not hashing CPU time, main-thread blocking or Vibe Line liveness;
returned bytes are not physical storage reads or total allocation. Those dimensions and RTK projection/savings costs
remain open. No production or verifier change was needed for this attribution.
