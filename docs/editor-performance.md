# Editor and visualization performance measurements

[简体中文](i18n/zh-CN/editor-performance.md).

Measured on 2026-09-23 for [Issue #119](https://github.com/jczhang02/pi-stuff/issues/119), comparing pre-feature `1369773` with production code `0c997f5`. Ordinary input has small measured overhead. Long expanded drafts have a clear regression, and pathological regex consumes substantial process CPU during editing despite responsive text input. These results do not support a blanket "no performance problems" claim. The initial measurement changed tooling and evidence only. The subsequent fix and its measurements are recorded below.

## Environment and method

Linux 6.19.10-jc-xanmod1, Intel Core i9-13900H, approximately 32 GiB RAM, maintainer-compiled Pi 0.87.1 / Bun 1.4.0, Terminal Control 1.2.1, fullscreen 100×30. Each process uses isolated settings, working and session directories and a local deterministic model. The baseline is an extracted Git archive using the same installed dependencies. No live provider is timed. Measurements were sequential on a shared development machine, without CPU pinning or fixed frequency; small differences and isolated maxima are not statistically established regressions.

Input timing starts before the driver sends `x` and ends when the native terminal reports `END_TAGx`. Backspace restores the draft outside the timed interval. Three rounds alternate configuration order, with 30 retained samples per size/configuration per round. Each size's first edit is stored separately and excluded from the summary. The 131,072-character stress case uses two rounds, 60 retained samples. P95 uses the nearest-rank definition across retained samples.

The public editor setter loads a fully expanded draft, avoiding native large-paste folding. Sizes are UTF-16 code units, not byte sizes, plus an eight-character marker. Text repeats skill references, `Review`, ordinary text and Chinese characters. The 10/100-rule cases have one matching `review` expression and simple nonmatching alternatives. They do not represent every regex or dense overlap workload. These are injected-input-to-PTY-observation timings, not physical keyboard/compositor latency or initial paste latency. Input timing alone does not establish completion of asynchronous keyword coloring.

## Input results

P95 milliseconds; each ordinary cell has 90 samples, each stress cell has 60:

| Draft characters | Baseline | Disabled | Skills only | 10 regex rules | 100 regex rules |
| ---------------- | -------: | -------: | ----------: | -------------: | --------------: |
| 256              |      4.0 |      4.6 |         4.1 |            6.5 |             6.6 |
| 4,096            |      6.2 |      4.5 |         6.9 |            7.9 |             7.5 |
| 32,768           |      7.4 |      5.6 |        11.9 |           13.4 |            13.6 |
| 131,072          |      6.8 |      8.9 |        26.7 |           29.3 |            35.4 |

At 32,768 characters, enabled highlighting adds roughly 4–5 ms to median visible-input latency. At 131,072, enabled medians are 18.6–21.4 ms versus 3.6 ms at baseline; the slowest enabled sample was 46.2 ms. The measured large-draft penalty is real. Source inspection identifies repeated whole-draft matching and palette construction as plausible contributors; this was not a CPU-profile attribution of each function.

After 131,072-character runs, baseline RSS snapshots were 165–168 MiB and disabled snapshots 165–167 MiB. Enabled snapshots ranged from 180 to 283 MiB. These are whole-process point samples, including runtime/worker/JIT/GC state, not allocation deltas or proof of a leak. Long-duration memory growth was not tested.

## Keyword color completion

A separate scenario inserts a fresh ` Review` and checks that this new word's `R` has the expected bold RGB, rather than waiting only for text. The same suffix is repeatedly appended and deleted. Three rounds provide 60 color samples per size/rule count. Each round also takes ten no-input frame observations to calibrate tool cost, 30 total. Values are milliseconds:

| Characters | 10-rule color observation P95 | 100-rule color observation P95 | No-input frame observation P95, 10/100 rules |
| ---------- | ----------------------------: | -----------------------------: | -------------------------------------------: |
| 256        |                          49.8 |                           46.6 |                                  26.3 / 17.4 |
| 4,096      |                          57.8 |                           51.0 |                                  22.6 / 21.4 |
| 32,768     |                          59.5 |                           58.1 |                                  28.1 / 18.8 |
| 131,072    |                          75.2 |                           80.8 |                                  19.6 / 19.1 |

The observed color time is an upper bound: it includes frame retrieval and `waitUntil` polling at 10 ms. No-input observation itself has a median of roughly 13–18 ms, so these values are not pure worker times and P95 values must not simply be subtracted. All new keyword colors were confirmed without timeout. At 131,072 characters, color observation P95 was 75–81 ms, with a 104 ms maximum. RGB confirmation occurs after character observation; this difference cannot all be attributed to product coloring. Dense-overlap and arbitrary-pattern color completion were not measured.

## Message display

Three rounds, ten fresh-session messages per workload per revision, 30 samples per cell. Timing starts at Enter on the fixture command and ends at the unique rendered body marker. Skill expansion starts at the native expansion key and ends at the final instruction marker. It includes command dispatch and terminal observation, not only parser execution. Source text is identical between revisions, but the baseline shows raw chart/tree code and the feature shows graphics.

| Workload                             | Baseline median / P95 | Current median / P95 |
| ------------------------------------ | --------------------: | -------------------: |
| Plain message, 16,000 characters     |           31.7 / 78.8 |          32.4 / 86.9 |
| 16 trees, 256 nodes each             |         178.1 / 195.8 |          34.5 / 46.2 |
| 16 heatmaps, 32×63 data cells each   |           17.0 / 27.2 |          14.0 / 19.9 |
| Collapsed skill card                 |             3.9 / 5.6 |            4.5 / 7.2 |
| Expand 16,000-character instructions |           14.7 / 21.0 |          15.0 / 20.0 |

There is no large median regression for ordinary messages or skill cards in this workload. Ordinary-message tails vary: current P95 is 86.9 ms versus 78.8 ms, with maxima 103.4 versus 87.5 ms; a small tail change cannot be excluded. Tree projection is faster here than rendering its thousands of raw code lines. Heatmap rows contain a label plus 63 numeric cells, so this measures 32×63, not the 32×64 parser limit. It is not a benchmark of every chart type or a long accumulated conversation.

## Pathological regex

With `(a+)+$` and 80 `a` characters followed by a failing suffix, three fresh hosts each process 30 insert/delete cycles. Visible-input median/P95/max were 2.6/3.7/4.3 ms. However, whole-process CPU increased by 5.26–5.38 CPU seconds over 2.08–2.11 seconds of wall time, including one second after typing stopped. That is roughly 2.5 CPU cores on average over this window, not free work.

The following idle one-second window consumed 0–10 ms of process CPU. Linux `CLK_TCK=100` gives 10 ms accounting granularity. This supports recovery after the burst, not zero CPU usage or proof that a single regex worker consumed all measured CPU. Worker isolation preserves text responsiveness; repeated timeout/recreation and runtime work still have a cost.

## Reproduction and data

Run from this worktree after the pinned install. The host path selects the measured maintainer build; a different build is a different environment. The scripts close their owned sessions and drivers in `finally`, and do not install CI gates or new dependencies.

```sh
perf_base="$(mktemp -d)"
git archive 1369773 | tar -x -C "$perf_base"
ln -s "$PWD/node_modules" "$perf_base/node_modules"
export PI_PERF_BASELINE="$perf_base"
export PI_TEST_HOST=/opt/bin/pi
bun tools/performance/terminal-input.ts
bun tools/performance/terminal-input.ts --stress
bun tools/performance/terminal-display.ts
bun tools/performance/terminal-pathological.ts
bun tools/performance/terminal-colors.ts
```

Scripts write JSON to temporary paths printed in their source; `PI_PERF_OUTPUT` overrides the output file. Retained measurements: [input](assets/editor-performance/input.json), [stress](assets/editor-performance/stress.json), [message display](assets/editor-performance/display.json), [pathological regex](assets/editor-performance/pathological.json), [color observation](assets/editor-performance/colors.json).

## Performance fix and remeasurement

The fix compares against `7c35b91`, whose product code is the original `0c997f5`. It caches unchanged skill ranges, generates colors only for the visible draft range while preserving whole-match Unicode phase, compiles worker regex once, and replaces candidate-by-skill overlap scans with a sorted linear scan. A failed worker must finish termination before replacement. Pending edits coalesce to the latest draft during a 1-second cooldown, doubling on consecutive failures up to 30 seconds and resetting on success. A failed draft is not automatically retried without another edit.

The simpler visible-range calculation replaces the broken full-palette identity cache: default skill matching previously returned a fresh array on every redraw. Regression tests first failed for unstable match identity and offscreen palette entries, then passed after the fix. Added regression coverage also exercises actual editor scrolling, same-matcher recovery after timeout and closing during cooldown.

The same maintainer host and fixture ran sequentially. The table compares freshly measured pre-fix default highlighting with fixed configurations, using the same sample counts and alternating order as above. P95 milliseconds:

| Characters | Before fix, skills | Fixed, disabled | Fixed, skills | Fixed, 10 regex | Fixed, 100 regex |
| ---------- | -----------------: | --------------: | ------------: | --------------: | ---------------: |
| 256        |                4.7 |             5.6 |           5.2 |             4.5 |              5.5 |
| 4,096      |                9.8 |             5.2 |           5.7 |             5.3 |              6.9 |
| 32,768     |               12.8 |             5.6 |           6.2 |             5.3 |              6.6 |
| 131,072    |               27.5 |             5.6 |           7.4 |             7.5 |              9.3 |

At 131,072 characters, default highlighting P95 fell about 73%, with median 20.9 → 5.4 ms. The fixed 100-rule maximum was 11.4 ms. This establishes improvement for the measured workload, not zero overhead or a bound for arbitrary regex. The new baseline column is pre-fix highlighting, not the earlier pre-feature baseline. Fresh before-fix 10/100-rule input runs were not repeated; their historical results remain above.

New RGB observations at 131,072 characters had P95 53.0/57.1 ms for 10/100 rules, versus historical 75.2/80.8 ms. All colors were observed, but a 32,768-character/100-rule sample reached 182.6 ms (P95 62.3 ms). Frame/polling overhead and shared-machine variation still apply; the improvement does not eliminate tails. Message rendering code is unchanged by this fix; its earlier display benchmarks remain applicable, and functional E2E is rerun.

To reproduce the fix comparison, archive `7c35b91` instead of `1369773`, then run the input scripts from the fixed checkout. The color script measures the selected current package. Raw data: [fixed input](assets/editor-performance/fixed-input.json), [fixed stress](assets/editor-performance/fixed-stress.json), [fixed colors](assets/editor-performance/fixed-colors.json).

The extended pathological-regex comparison includes the typing burst plus one second, a following one-second window, then two more idle seconds. Before-fix process CPU was 4.92–6.12 seconds during the 1.96–2.13-second burst window, 0–30 ms in the following second, and 10 ms in the final two seconds. Fixed CPU was 1.04–1.13 seconds during the 1.92–2.01-second burst window, 720–760 ms in the following second, and 0–10 ms in the final two seconds. Total measured CPU across all windows fell from 4.93–6.16 to 1.77–1.89 seconds (about 62–70% per corresponding round). Input P95 was 3.4 ms before and 3.3 ms after.

The cooldown shifts one queued attempt into the first idle second; it does not make every idle window free. The extended window confirms the measured burst eventually settles without repeated automatic retries. Arbitrarily complex regex still costs CPU, and a later safe edit can wait for the current cooldown. Continuous pathological editing and long-duration memory growth are not covered by these short runs. Use `PI_TEST_PACKAGE=<baseline-archive>` with the same pathological script for the before-fix run, and unset it for the current package. Raw data: [before-fix pathological](assets/editor-performance/before-fix-pathological.json), [fixed pathological](assets/editor-performance/fixed-pathological.json).
