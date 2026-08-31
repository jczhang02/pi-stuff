# Effect v4 adoption baseline and final comparison

**Baseline measurement date:** 2026-08-30  
**Final measurement date:** 2026-08-31  
**Beads:** `ps-pby`, `ps-pby.1`, `ps-pby.35`  
**Baseline commit:** `d45db1a7fa6a60defd822c42d3b103be567ac66a`  
**Measured implementation commit:** `a6edace46111ed89ce44617955fbf525ece863c9`  
**Certified Host:** Pi `0.84.4+source.b79e4cc83497.binary.ce91e1f8bff6.bun.1.3.14`, Linux x64  
**Repository toolchain:** Bun `1.4.0`, TypeScript `5.9.3`  
**Provisional recommendation:** **no-go for adoption now**

The Effect v4 experiment preserves the tested Suite contracts and replaces substantial native lifecycle machinery, but
it does not leave every executable certification gate green. The full lifecycle acceptance matrix completed its
requested coverage and then rejected repeated Pi 0.84.2-era startup, reload, and degraded-provider budgets. A matched
run of the pre-migration commit on the same Pi 0.84.4 binary reproduced those same budget classes, so this is a stale
certification baseline rather than evidence that Effect introduced the failures. The gate is nevertheless red and must
not be described as passed. Together with the release-candidate dependency and measured footprint increases, that makes
the current recommendation no-go. The implementation branch remains available as evidence; ADR 0024 remains proposed.

## Quantitative summary

| Measure | Pre-migration baseline | Effect v4 final | Delta |
| --- | ---: | ---: | ---: |
| Package `src/` TS/JS files | 481 | 495 | +14 (+2.91%) |
| Package `src/` TS/JS physical lines | 120,140 | 124,233 | +4,093 (+3.41%) |
| Package `src/` TS/JS code lines | 107,857 | 111,942 | +4,085 (+3.79%) |
| Direct runtime dependencies | 19 | 19 | unchanged |
| Installed dependency-tree entries | 433 | 443 | +10 (+2.31%) |
| Packed files | 564 | 578 | +14 (+2.48%) |
| Packed archive | 4,521,469 bytes | 4,556,566 bytes | +35,097 (+0.78%) |
| Unpacked file bytes | 11,827,546 bytes | 11,978,928 bytes | +151,382 (+1.28%) |
| Fresh-process startup p50 | 5,410.89 ms | 4,926.02 ms | -484.87 (-8.96%) |
| Fresh-process startup p95 | 7,394.82 ms | 5,030.57 ms | -2,364.25 (-31.97%) |
| Fresh-process shutdown p50 | 124.64 ms | 135.65 ms | +11.01 (+8.83%) |
| Fresh-process shutdown p95 | 138.18 ms | 146.31 ms | +8.13 (+5.88%) |
| Maximum lifecycle-process RSS | 206,116 KiB | 220,904 KiB | +14,788 (+7.17%) |
| Warm typecheck wall time | 59.60 s | 67.37 s | +7.77 (+13.04%) |

The Package still has zero trusted dependencies. The final manifest replaces `p-limit@6.2.0` with
`effect@4.0.0-rc.112`, so the direct runtime dependency count is unchanged. Tokei counted six JavaScript files and 489
TypeScript files in the final tree. The dependency-tree figure is the line count from `bun pm ls --all`, not a count of
unique package identities. The final packed archive SHA-1 reported by `bun pm pack` was
`20655f1e562dece5ff3e8fa690a233c79a55fdac`.

The same-method startup comparison is useful machine evidence, not an attribution claim: the two batches ran on
different dates and global kernel caches were not reset. The back-to-back control below better isolates migration cost.

## Lifecycle mechanism and branching census

The migration materially contracted the syntax associated with hand-owned asynchronous lifecycle mechanics. Native
adapters retain the primitives required by their external protocols; these counts are evidence rather than a semantic
completeness proof.

| Syntax | Baseline | Final | Delta |
| --- | ---: | ---: | ---: |
| `let` declarations | 1,290 | 1,261 | -29 (-2.25%) |
| Non-`readonly` class properties | 520 | 505 | -15 (-2.88%) |
| `new Promise` | 73 | 29 | -44 (-60.27%) |
| `new AbortController` | 26 | 11 | -15 (-57.69%) |
| `setTimeout` | 72 | 22 | -50 (-69.44%) |
| `setInterval` | 20 | 3 | -17 (-85.00%) |
| `new Worker` | 1 | 1 | unchanged |
| `fetch` calls | 31 | 30 | -1 (-3.23%) |
| `Bun.spawn` calls | 2 | 2 | unchanged |
| `spawn` / `execFile` / `fork` calls | 21 | 20 | -1 (-4.76%) |

| Branch syntax | Baseline | Final | Delta |
| --- | ---: | ---: | ---: |
| `if` statements | 10,804 | 10,855 | +51 (+0.47%) |
| Conditional expressions | 3,407 | 3,570 | +163 (+4.78%) |
| `switch` statements | 47 | 47 | unchanged |
| `case` clauses | 302 | 302 | unchanged |
| Loops | 1,129 | 1,118 | -11 (-0.97%) |
| `catch` clauses | 1,121 | 964 | -157 (-14.01%) |
| `&&`, `||`, and `??` expressions | 8,271 | 8,291 | +20 (+0.24%) |

The census used TypeScript 5.9.3 over every Package TS/JS source file. A mutable class property is a
`PropertyDeclaration` without a `readonly` modifier. Loops include `for`, `for in`, `for of`, `while`, and `do`.
Primitive counts use the same exact source-token patterns as the baseline.

## Runtime evidence

### Recorded baseline method

Both primary comparison batches used one retained warmup followed by five measured
`suite/fresh/exit/80x24` samples. Every sample launched a new certified Pi process with a cold process-local Suite
module cache; executable and filesystem caches were warm, and global kernel caches were not dropped.

The baseline startup samples were 4,475.81, 4,785.86, 5,410.89, 7,394.82, and 6,501.81 ms. The final samples were
4,978.02, 5,030.57, 4,926.02, 4,589.19, and 4,708.92 ms. Baseline shutdown samples were 105.36, 138.18, 124.64,
135.38, and 121.39 ms; final samples were 135.65, 142.55, 128.83, 135.26, and 146.31 ms.

RSS came from an independent one-warmup/one-sample lifecycle batch under the zsh `time` builtin. Typecheck received one
warmup before the measured five-project command. The measured final typecheck also reached 1,857,296 KiB maximum RSS.

### Back-to-back Pi 0.84.4 control

After the full acceptance run reported repeated budget findings, the exact baseline commit and final worktree ran the
same non-acceptance cells back-to-back on the certified Pi binary. Each cell retained one warmup and measured three
samples at 100x32. This control proves whether a finding class appeared before the migration; it does not replace the
repository's executable acceptance contract.

| p95 cell metric | Baseline | Final | Delta |
| --- | ---: | ---: | ---: |
| Fresh exit startup | 3,158.71 ms | 3,356.34 ms | +197.63 (+6.26%) |
| Fresh unchanged reload | 515.11 ms | 538.11 ms | +23.00 (+4.47%) |
| Degraded startup | 2,303.30 ms | 2,548.28 ms | +244.98 (+10.64%) |
| Degraded first provider boundary | 957.29 ms | 958.40 ms | +1.11 (+0.12%) |

The retained acceptance ceilings are 2,700 ms for ordinary startup, 200 ms for ordinary unchanged reload, and 800 ms
for the degraded first provider boundary. Baseline and final both exceed all three. No budget was raised, suppressed, or
reinterpreted to make the experiment pass.

The first full-matrix attempt also encountered one isolated harness timeout while waiting for the initial Editor in
`suite/resume-long/reload/64x28`. A one-warmup/three-sample rerun of that exact cell passed, and a complete restart then
finished every requested primary and confirmation cell without another readiness timeout. The restart still exited
unsuccessfully because the repeated budget findings above remained. This distinguishes the transient readiness miss
from the deterministic acceptance result.

## Certification matrix

| Evidence | Result |
| --- | --- |
| `bun run check:fast` on the measured implementation | PASS |
| Final `bun run check` with certified Pi and official RTK | PASS |
| Isolated Package tests and Goal upstream/smoke suites | PASS |
| Generated composition, dependency analysis, repository safety, and package verification | PASS |
| Packed Package against certified Pi 0.84.4 | PASS, 578 files |
| Tool Activity performance acceptance | PASS |
| Real Pi Code Mode execution and Session reload | PASS |
| Real Pi Code Mode TUI group/failure/media/cancel matrix at both widths | PASS |
| Real-provider Magic Context lane | NOT APPLICABLE: no configured authentication or authority for external provider calls |
| Matched baseline/final lifecycle comparison | PASS |
| Full lifecycle executable acceptance | **FAIL: repeated stale Pi 0.84.2 budget findings reproduced by the baseline on Pi 0.84.4** |

The Code Mode TUI verifier initially captured one media frame before the outer Host had settled even though the
provider had completed. It now waits for two identical non-working screens before comparison; the isolated media lane,
the complete TUI matrix, and `check:fast` passed after that verifier-only fix. No provider credential was synthesized or
copied for Magic Context real-provider acceptance.

## Architecture evaluation

- **Parity:** complete automated checks, packed-Host verification, Code Mode real execution, and the TUI matrix pass.
  No public Tool, command, Session, settings, Provider, Agent, or visible UI contract was intentionally changed.
- **Execution model:** effectful production paths return Effect values below Pi-facing adapters. One shared foundation
  owns Suite, Session, Capability, and operation Scopes without taking lifecycle policy away from Pi, Goal, Agents,
  Background Work, or Context Management.
- **Mechanism deletion:** native Promise construction, abort-controller construction, timers, mutable lifecycle state,
  and catch clauses all contracted materially. The result is not a wrapper over the complete old mechanism.
- **Ownership enforcement:** repository-safety analysis denies undeclared native effect primitives and lower-level Effect
  runners while retaining narrow Capability-owned native adapters. Generated and packaged source checks pass.
- **Technical footprint:** source grew 3.41% physically and 3.79% by code lines; archive size grew 0.78%; maximum RSS
  grew 7.17%; warm typecheck grew 13.04%; back-to-back startup/reload controls grew roughly 4–11%.
- **Release risk:** the implementation depends on the exact prerelease `effect@4.0.0-rc.112`. The experiment did not
  chase a later RC, and accepting a prerelease as the Suite's internal execution foundation remains a maintainer risk.

## Recommendation

Do not accept ADR 0024 or merge the experiment now. The architectural result is substantive and behaviorally strong,
but a merge-quality candidate cannot claim complete certification while `bun run benchmark:lifecycle` is red. The
failure should be resolved in an independent Pi 0.84.4 benchmark-recertification decision, using clean pre-migration
controls rather than raising thresholds inside this experiment. A later adoption decision should then reconsider the
measured runtime/typecheck footprint and the status of Effect v4's release candidate. No merge, publication, or ADR
status change is authorized by this report.

## Reproduction

Run from the compared worktree with the certified release binary selected through `PI_BIN`:

```sh
tokei packages/pi-stuff/src --types TypeScript,JavaScript
bun pm ls --all
(cd packages/pi-stuff && bun pm pack --destination "$PACK_DIR")
tar -tvzf "$PACK_DIR/jczhang02-pi-stuff-0.3.3.tgz"

bun scripts/benchmark-lifecycle.ts \
  --pi "$PI_BIN" \
  --variants suite \
  --scenarios fresh \
  --actions exit \
  --sizes 80x24 \
  --samples 5 \
  --warmups 1 \
  --output "$LIFECYCLE_REPORT"

TIMEFMT='max_rss_kib=%M wall_seconds=%E'
time bun scripts/benchmark-lifecycle.ts \
  --pi "$PI_BIN" \
  --variants suite \
  --scenarios fresh \
  --actions exit \
  --sizes 80x24 \
  --samples 1 \
  --warmups 1 \
  --output "$RSS_REPORT"

bun run typecheck
TIMEFMT='wall_seconds=%E max_rss_kib=%M'
time bun run typecheck
```

The final comparison also reran the documented TypeScript AST census with the same node and token definitions. Local
measurement artifacts remain under `.artifacts/`; they are machine evidence and are not shipped with the Package.
