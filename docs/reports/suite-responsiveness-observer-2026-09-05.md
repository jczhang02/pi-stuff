# Continuous responsiveness observer and cold Ledger reproduction

On 2026-09-05, the repository observer reproduced a 198.672 ms Spinner hold before the first Code Mode/Bash Tool UI.
The same Suite without old Ledger records passed the frozen gates; native Pi with the same synthetic history shape
also passed. This is a reproducible remaining defect, not a completed fix or whole-Suite resource certificate.

Production source was unchanged from `c6b20efb599a953b0b03bc439aa0bee9ab5ea97e`, whose implementation matches
`main` commit `42ceceb8`. That version already folds new Ledger entries incrementally during ordinary branch
progress. The remaining reproduction concerns the first cold projection; it does not show that the warm fix is absent.

## Observations

Every row used the exact [certified Pi 0.85.0 executable](../compatibility.md), a 120×40 fullscreen terminal, fresh
private configuration/cache directories, one measured Tool call, and no profiler or injected block. Suite runs
exercised automatic Session Naming and one real HTTP usage refresh against a synthetic loopback account in an
isolated network namespace. No user Sessions, credentials, settings, or running Pi processes were used.

| Run | History and execution | Longest Spinner frame ms | Slowest input/setup ms | Slowest selection ms | Result |
| --- | --- | ---: | ---: | ---: | --- |
| `gjIpTt` | Suite, 24 historical executions, Code Mode → Bash | 198.672 | 39.360 | 14.410 | Spinner gate failed |
| `3QdOLF` | Suite, no old Ledger, Code Mode → Bash | 113.392 | 14.770 | 13.886 | Frozen gates passed |
| `8wCzGe` | Native Pi, 24 historical executions, Bash | 117.565 | 16.099 | 16.049 | Frozen gates passed |

The seeded Session contains 96 canonical Ledger entries, with a successful 800,000-character result in each of 24
executions and **zero saved snippets**. A preparatory native Pi process writes them through `CodeModeSessionLedger`;
the observed process reopens the resulting Session. The Suite still reads `ledger.snippets()` before execution even
when no snippet was saved. The native control preserves the history shape, while the no-history Suite control preserves
the Code Mode execution path.

In `gjIpTt`, the longest held frame spans +8,500.742 to +8,699.414 ms from observer start. The first
`Bash(sleep 2; printf PSYON_TOOL_RESULT)` frame appears at +8,751.383 ms. The stall therefore precedes Tool UI.
All three rows have continuous active Spinner observations and maximum capture gaps below 26 ms.

The [numeric evidence](suite-responsiveness-observer-2026-09-05.json) also retains excluded attempts. The earlier
two-Tool Suite run `lBK0DC` had a 47.225 ms observation gap and 60.353 ms startup feedback: it is inconclusive, not a
pass or attributed startup defect. Native run `qHKlIG` overlapped the preceding negative-control test and is diagnostic
only. No measurement was discarded merely because its result was unfavorable.

## Frozen gates and observer checks

The [locked gates](suite-responsiveness-gates-2026-09-05.json) were recorded at 2026-09-05 00:51:32 UTC, before
production optimization. Thirty fresh native samples rotated through 64×28, 120×40, and 180×50. The largest native
held frame plus twice the observed capture gap gives 164.767521 ms; native input/selection maxima plus one gap give
38.124123 ms for startup input, 40.465312 ms for later input, and 38.311641 ms for selection.
These are local fixed-Host comparison limits, not a portable guarantee that every shorter delay is imperceptible.

The observer captures every 10 ms plus capture/interaction cost, from launch through post-settlement input and
selection. Input begins when the first native editor is visible, before the fixture's ready notification. Typing and
autocomplete selection share the capture loop; waiting for their feedback never suspends capture. The final held frame
and capture-time uncertainty are included. Startup before Working and time after `agent_end` are not expected Spinner
intervals. Selection means command-autocomplete selection, not mouse text selection.

An empty/invalid trace, active coverage below nine seconds or 600 captures, a gap above 40 ms, or a missing expected
Spinner makes the sample inconclusive. A single frozen-gate breach fails. The script prints the summary and keeps raw
frames, actions, source snapshots, and limits in its private artifact directory even when validation fails.

The native negative controls inject 350 ms separately at startup, before Tool-call emission, and during settlement.
The regression test requires feedback above 100 ms **in the injected phase**; the pre-Tool case also requires a Spinner
hold above 350 ms. These detection floors validate the observer and are not product acceptance limits.
Pure tests protect the final held-frame interval and invalid/missing-observation accounting.

## Run the checks

Use the prepared executable from the compatibility contract:

```bash
bun test test/pty-observation.test.ts test/responsiveness-pty.test.ts
bun scripts/benchmark-responsiveness.ts --pi "$PI_BIN" \
  --gates docs/reports/suite-responsiveness-gates-2026-09-05.json
```

To reproduce the remaining cold Ledger failure, set `PI_STUFF_CODE_MODE_HOST` to the prepared Code Mode helper and run:

```bash
export PSYON_PARENT_NETNS="$(readlink /proc/self/ns/net)"
unshare --user --map-root-user --net \
  bun scripts/benchmark-responsiveness.ts --pi "$PI_BIN" --suite --code-mode --ledger \
  --gates docs/reports/suite-responsiveness-gates-2026-09-05.json
```

Remove `--ledger` for the Suite control. Remove `--suite --code-mode` for native Pi with synthetic Ledger history.
Each invocation creates its own Session; no existing Session path is accepted. Add `--snippet` to seed one saved
snippet or `--repeat-tool` to compare the first and subsequent Tool in the same process. `--columns` and `--rows`
select geometry. The helper's copied executable hash is recorded; this does not freshly certify its release archive.

`--block-ms 350 --block-phase startup|pre-tool|settlement` is an explicit negative control. `--cpu-profile` is a separate
diagnostic mode and cannot be combined with `--gates`. No profiler was active in the table above.

## Remaining scope

This checkpoint retains the reproducer and gates. It does not implement the cold Ledger fix. Observer CPU is reported
separately and must not be presented as Pi or Suite CPU. Complete process-tree CPU/RSS, allocation/GC, I/O, wakeups,
and largest main-thread-task accounting remain open. The [16-Capability source inventory](suite-resource-inventory-2026-09-05.md)
now records owners and measurement targets; active Context and recovery workloads remain open. The foreground and
background Agent scenarios below cover successful execution, not every Agent lifecycle or its complete resource cost.
Default-loaded Capabilities are not evidence that those paths executed.
The shared machine was not CPU-isolated; full responsiveness closure also needs longer repeated workloads.
Beads `ps-yon.3`, `ps-yon.4`, and `ps-yon.5` retain that work under
[ADR 0030](../adr/0030-remove-redundant-suite-work-without-feature-cuts.md).

## Foreground Agent extension

The observer now accepts `--suite --agent foreground`. It creates one private named Agent definition, invokes the
public `subagent` Tool with fresh context, and keeps capturing the parent TUI while a real child Pi executes Bash.
The child must return the expected Tool result and final marker. Each child Provider request is bound to its PID;
the observer requires the expected request sequence and verifies process exit against its recorded birth identity.
Parent automatic Naming and usage refresh remain enabled and must each execute once. `--code-mode` sends both parent
and child Tools through Code Mode; `--repeat-tool` launches a second child sequentially. The scenario timeout is
60 seconds to include child startup, without changing any feedback or Spinner gate.

On 2026-09-05, the first no-Code-Mode/no-history foreground sample held a Spinner frame for 888.131 ms before the
Agent row appeared; input feedback took 779.337 ms. Its lifecycle test passed because the observer captured the complete
run, not because responsiveness passed. A separate frozen-gate invocation failed again with a 188.750 ms frame and
40.660 ms startup input. Both children completed and exited, with no missing active Spinner samples or capture gaps
above 23 ms. The [Agent numeric evidence](suite-responsiveness-agents-2026-09-05.json) retains both failures.

| Run | Workload | Longest Spinner frame ms | Slowest input/setup ms | Disposition |
| --- | --- | ---: | ---: | --- |
| `zmHdBv` | Suite foreground Agent → child Bash | 888.131 | 779.337 | Observer test; retrospective gate breaches |
| `KHWw6O` | Same foreground workload, fresh process | 188.750 | 40.660 | Frozen gates failed |
| `ewiJgE` | Code Mode → foreground Agent → child Code Mode/Bash, old Ledger | 194.857 | 97.208 | Frozen gates failed |
| `JN8MPG` | Suite Bash, no Agent or old Ledger | 111.590 | 15.067 | Frozen gates passed |

These runs narrow the investigation but do not establish the new stall's root cause or certify every Agent lifecycle.
The ordinary Bash control lacks child-process load, so it does not alone distinguish parent launch overhead from
resource contention. Diagnostic run `hQfUTb` completed two sequential foreground Agents with CPU profiling; it is not
a responsiveness acceptance sample. Parent and child profiles are separate. The parent samples include tokenizer
initialization during startup, which is not evidence that tokenizer initialization caused the pre-Agent-UI stall.
The observer also retains its time origin and first Agent-row timing for later diagnostic correlation.

Reproduce the foreground case in the same isolated network setup used above:

```bash
unshare --user --map-root-user --net \
  bun scripts/benchmark-responsiveness.ts --pi "$PI_BIN" --suite --agent foreground \
  --gates docs/reports/suite-responsiveness-gates-2026-09-05.json
```

## Background Agent extension

Use `--agent background` in the same command to observe the parent after it settles while a child continues working.
Capture ends only after the visible completion rows, automatic Naming/Usage, and another input and selection complete.
The observer requires input and selection feedback between parent completion and the last child's completion. It reads
the synthetic parent's native Session file after capture to verify one canonical `pi-stuff-agent-outcome` per child,
with unique identities and completed status. Provider request counts reject an unsolicited parent turn during the
observed interval, and birth-bound exit checks cover each child Pi. They do not certify every helper's cleanup.

The background fixture waits six seconds before its final parent/child Provider response instead of four. This keeps
both the parent-active and parent-idle/child-active observation windows long enough for the existing checks; it changes
no production scheduling or responsiveness gate. No active Spinner is required while only the background child runs.

| Run | Background workload | Longest Spinner frame ms | Slowest input/setup ms | Disposition |
| --- | --- | ---: | ---: | --- |
| `eh1S2n` | One Agent → child Bash | 177.973 | 63.629 | Observer test; retrospective gate breaches |
| `H1NZud` | Same workload, fresh process | 183.665 | 17.929 | Spinner gate failed |
| `O2afCg` | Two Agent launches through Code Mode, child Code Mode/Bash, old Ledger | 232.401 | 53.915 | Spinner and input gates failed |

All three runs retained 11.8–13.3 seconds of observation after parent settlement, with complete expected Spinner
coverage and maximum capture gaps below 22 ms. Every child completed its Tool and exited; canonical outcomes numbered
one, one, and two respectively. Parent Naming and Usage each ran once. The two-child case verified that `--repeat-tool`,
`--code-mode`, and `--ledger` compose with background observation at 120×40. Other geometries remain to be measured.
The [Agent numeric evidence](suite-responsiveness-agents-2026-09-05.json) records each source snapshot. These failures
extend the investigation to background delegation; they do not prove it shares the foreground stall's root cause.
