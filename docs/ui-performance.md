# Conversation UI performance observations

[简体中文](i18n/zh-CN/ui-performance.md) · English is normative.

Reusing Pi's native result component reduced repeated Ctrl+O expansion from a median 1,174 ms to 33 ms. A later width-check change reduced first expansion from 1,097 ms to 102 ms in a fresh comparison. These are bounded experiments for retained retrieval output, not complete performance acceptance for [#106](https://github.com/jczhang02/pi-stuff/issues/106).

## Current comparison at `0221b6f`

Six fresh-process runs completed in UI off/on/on/off/off/on order on compiled Pi 0.87.1, Bun 1.4.0 and Terminal Control 1.2.1. Each used 40 turns of eight Read calls, then one Write: 321 calls, 96,000 retained Read lines and a 4,976,301-byte session. The written probe contains 100 lines with 40 CJK characters per line. RTK transformations and automatic compaction were disabled in both conditions; welcome retained its default. The provider emits arguments in a single event. The host version was checked afterward with `pi --version`; the executable modification time preceded these runs. The driver did not record a per-launch version or binary hash. The initial report incorrectly reused the earlier 0.87.0 label.

[Current raw observations](assets/ui/current-layout-performance.json) include all six samples, 24 calibrated layouts, resource snapshots and the one-off driver sources. Source paths use `<WORKTREE>` in the archived copy. Earlier attempts with automatic compaction enabled are excluded: the deterministic provider could not summarize. The legacy compact `resizeMs` field is also excluded because its predicate could accept a frame before Pi reflowed the body. The historical compact-resize figures below have the same observation limitation and cannot establish reflow performance.

| Observation, median                | UI off | UI on |
| ---------------------------------- | -----: | ----: |
| Setup and startup, ms              |    718 |   748 |
| Build conversation, ms             |  5,416 | 5,090 |
| Draft input, ms                    |    2.5 |   2.2 |
| First global expansion, ms         |  5,942 |   109 |
| Repeated global expansion, ms      |  5,918 |    36 |
| Global collapse, ms                |     47 |    33 |
| Calibrated expanded resize, ms     |  4,727 |   107 |
| Visible scroll range change, ms    |     76 |    42 |
| Resume to final marker, ms         |     49 |    73 |
| Reload operation, ms               |    113 |   132 |
| Build CPU, ms                      |  5,693 | 5,525 |
| Interaction CPU, ms                | 78,943 | 1,767 |
| RSS after build, MiB               |    362 |   391 |
| RSS after interactions, MiB        |    626 |   443 |
| RSS after restore cycles, MiB      |    627 |   518 |
| RSS after five fresh sessions, MiB |    659 |   487 |

Each condition has three process samples, 30 draft inputs, three first expansions, 12 repeated expansions, 15 collapses, 12 expanded resizes, 12 scroll observations and nine resume/reload cycles. Resume ranged from 38–80 ms off and 68–89 ms on; reload ranged from 107–145 ms off and 115–155 ms on. The measured resume overhead is about 24 ms at the median. This sample does not show a multi-second UI-on restore pause, but does not establish a universal performance bound.

Before measuring expanded resize, calibration at 60/80/100/120 columns required all 40 CJK characters and the final marker on the last source line, with a displayed row reaching within four cells of the target width. Recorded host and frame widths agreed in all 24 calibrations. Timed resizes then waited for those exact body rows. Scroll measurements waited for an earlier source range on PageUp and the original bottom range on PageDown. These measure the observed content change, not whole-frame stability or first-time layout at an unseen width. CPU during interactions includes calibration and resource commands.

All 18 resume/reload cycles preserved the original session bytes. Startup includes fixture setup and host launch, without proving the complete welcome was drawn. Reload ends at operation readiness and the final marker, which does not guarantee a fresh final redraw. RSS is instantaneous, not peak usage; garbage collection and host scheduling were uncontrolled. Small samples do not prove absence of leaks. Paced streaming and extended real-model testing remain outstanding.

The experiments below describe earlier revisions. The historical Read/retrieval/Web restore failures were addressed by the display-lookup integration; current history evidence is recorded in [UI integration](ui-integration.md). The five-column combining-character gutter overflow was fixed in `0221b6f`, with 14 tests and 108 assertions on each supported host. These updates do not imply universal Unicode correctness or complete acceptance.

## Workload and measurement

The comparison used compiled Pi 0.87.0, Bun 1.4.0 and Terminal Control 1.2.1 on the same Linux x86_64 development host. Each run launched the actual extension through the existing Pi terminal fixture, with fresh temporary settings and sessions, a deterministic local provider, default dark theme and a 100×36 viewport. Welcome and both RTK transformations were disabled in every condition. Retrieval grouping kept its default when UI was enabled.

Each run performed 40 user turns, with eight sequential Read calls per turn. Each call read the same 300-line TypeScript file. A final turn wrote a 100-line TypeScript file: 321 tool calls, 96,000 retained Read source lines and a 4,962,321-byte session file. The provider delivered each tool's arguments in one event, so this does not measure paced model streaming.

After building the conversation, the driver measured ten draft inputs, ten alternating Ctrl+O actions and six resizes through 60, 120, 80, 100, 60 and 120 columns. Expansion ended when the final written source line became visible; collapse ended when that line disappeared. Timing includes Terminal Control dispatch and screen observation. Startup includes fixture setup and host launch. CPU and RSS snapshots come from the Pi process only, excluding the provider and terminal driver. Five subsequent new sessions each performed eight reads before another resource snapshot; no explicit garbage collection was requested.

The baseline was `b3655a4`. Its six runs used UI off/on/on/off/off/on order. The final cache then received three UI-on runs. Each condition therefore has three fresh-process samples, 30 input observations, three first expansions, 12 repeated expansions, 15 collapses and 18 resizes. The host was not dedicated or CPU-pinned, and sample sizes are small. Do not interpret small timing differences as established regressions or improvements.

[Raw observations](assets/ui/retrieval-performance.json) retain individual timings and resource snapshots, the baseline commit and the final retrieval source SHA-256. This was a one-off driver using `launchPi`, rather than a new routine benchmark suite.

## Initial cache results

All values are medians. CPU times are accumulated user plus system time; RSS is a point-in-time resident-memory observation.

| Observation                              | UI off | UI before cache | UI with cache |
| ---------------------------------------- | -----: | --------------: | ------------: |
| Setup and startup, ms                    |    708 |             650 |           771 |
| Build the conversation, ms               |  6,721 |           6,107 |         6,716 |
| Draft input, ms                          |    2.1 |             2.9 |           2.1 |
| First global expansion, ms               |  6,094 |           1,208 |         1,248 |
| Repeated global expansion, ms            |  6,045 |           1,174 |            33 |
| Global collapse, ms                      |     47 |              30 |            33 |
| Resize while compact, ms                 |   11.5 |             8.0 |           8.5 |
| CPU while building the conversation, ms  |  6,956 |           6,633 |         7,294 |
| CPU during the measured interactions, ms | 32,754 |           6,435 |         1,663 |
| RSS after building the conversation, MiB |    335 |             396 |           395 |
| RSS after the measured interactions, MiB |    663 |             669 |           405 |
| RSS after five new sessions, MiB         |    622 |             527 |           351 |

Repeated expansion with the final cache ranged from 30 to 38 ms, compared with 1,089 to 1,341 ms before caching. The simpler baseline returned a new result component on each disclosure change. The retained component now keeps wrapped rows and lazily styled rows for one width, using Pi's `lastComponent`; content, theme or width invalidation discards that layout. Hidden metadata is not wrapped. The result supports retaining this cache without adding a separate history store.

The memory observations do not prove absence of leaks. UI-on RSS immediately after building the conversation remained about 60 MiB higher than UI off, while post-interaction and new-session RSS were lower. Allocation timing and garbage collection were not controlled. At this revision, first expansion still processed all retained output with a visible pause.

## Avoid repeated ANSI scanning on first expansion

A fresh comparison at `06768a2` used the same driver, compiled host and 321-call workload. Three runs before the change measured first expansion at 1,061–1,177 ms; three runs afterward measured 100–107 ms. The runs were sequential, before then after, on the same development host. [Follow-up observations](assets/ui/retrieval-width-performance.json) retain every sample, source hashes and probe results.

| Observation, median                      | Before | After |
| ---------------------------------------- | -----: | ----: |
| First global expansion, ms               |  1,097 |   102 |
| Repeated global expansion, ms            |     31 |    31 |
| Draft input, ms                          |    2.4 |   2.2 |
| Resize while compact, ms                 |    8.2 |   7.5 |
| CPU during the measured interactions, ms |  1,505 |   401 |

A separate 96,000-row probe localized most of the work to styled-row truncation: about 842 ms, versus 35 ms for wrapping. Pi's truncation helper scanned the ANSI-styled text even when the row already fit. The result renderer now uses Pi's `visibleWidth` on the unstyled body first; fitting rows return directly, and possible overflow still uses the original truncation. This adds no cache or layout abstraction. The probe compared measuring the colored row with measuring its body; both preserved the output hash, while the body check also avoids parsing ANSI and the gutter.

The workload repeats ASCII source, which benefits from Pi's ASCII width fast path. Unicode correctness was checked separately; Unicode-heavy performance has not been measured. The segment probe ran modes sequentially in one process, so its timings include warm-up/cache-order effects. The actual host comparison used fresh processes. Neither comparison controls CPU scheduling or establishes a numerical acceptance budget.

## Bash disclosure and the simpler alternative

At `56e32f1`, repeated expansion of a separate Bash-heavy conversation took a median 563 ms. Each fresh process executed 15 turns with eight `cat source.ts` calls per turn, each returning the same 400-line ASCII file, followed by a 100-line Write. That is 121 calls, 48,000 Bash lines and a 2,458,436-byte session. The compiled host, isolated provider, settings, viewport and interaction measurements were the same as above, but this experiment did not perform the five new-session cycles.

The baseline ran UI off/on/on/off/off/on. A candidate that reused `lastComponent`, wrapped rows and styled rows then ran three times. Independent review requested a simpler comparison: keep only the `visibleWidth` check before styled truncation, still creating a fresh result component. That version ran three times and is the selected implementation. [Bash observations](assets/ui/bash-performance.json) retain all twelve runs and the candidate/source hashes.

| Observation, median                      | UI off | Before | Cache candidate | Width check only |
| ---------------------------------------- | -----: | -----: | --------------: | ---------------: |
| First global expansion, ms               |  2,177 |    545 |              34 |               60 |
| Repeated global expansion, ms            |  2,222 |    563 |              29 |               53 |
| Global collapse, ms                      |    171 |     50 |              28 |               50 |
| Draft input, ms                          |    4.0 |    1.5 |             1.6 |              1.7 |
| Resize while compact, ms                 |    9.0 |    9.4 |             7.7 |              7.6 |
| CPU during the measured interactions, ms | 12,619 |  3,330 |             462 |              656 |
| RSS after building the conversation, MiB |    327 |    281 |             304 |              280 |
| RSS after the measured interactions, MiB |    590 |    485 |             335 |              323 |

The selected change reduced repeated expansion to 49–61 ms. The extra cache saved another 24 ms at the median in this workload, but introduced separate body/style state and invalidation paths. The width check removes most of the observed pause with a smaller change, so the cache was discarded. This is not a new acceptance threshold. RSS depends on allocation and garbage-collection timing; these samples cannot establish a leak or a guaranteed memory saving.

The new host test checks streaming tail previews, appended output, completion switching to the first three rows, theme changes at the same width, repeated disclosure and CJK wrapping at 60/80/120 columns. It passed on the baseline before the optimization. Its first draft captured an intermediate resize frame; waiting for the requested width and complete line fixed the test, without changing the product. The final tools, streaming, terminal-output and RTK-result suites pass 28 cases with 197 assertions on each of pinned Pi 0.85.1 and compiled Pi 0.87.0. These functional checks do not measure paced-streaming performance or resolve the known history failures.

Independent review passed 3,600 exact-row comparisons against the baseline across two themes, 12 widths (0–7, 12, 60, 80, 120), ten text samples and multiple preview/result states. An additional width assertion exposed an existing edge case: at five columns, the leading combining/spacing sequence `\u0301\u093eX` can yield a row measured as six columns. The reviewer confirmed 22 such overflow cases were identical before and after. This establishes equivalence for the optimization, not universal Unicode width correctness; the edge case was subsequently fixed in `0221b6f`, as recorded above.

## Verification limits

For the initial cache increment, retrieval/group/error suites passed 19 cases and failed the two known reload/resume cases on both pinned Pi 0.85.1 and compiled Pi 0.87.0, with 182 assertions per host. After the final lazy-metadata adjustment, independent checks passed the strengthened same-width theme test on both hosts, 16 assertions each, plus 20 real-component assertions for partial/final output, replacement text, warning/error and metadata transitions. The theme test also verifies narrow wrapping and that reopening a result does not reread a changed file.

After the width check, the same three suites passed 20 cases and failed those two history cases on each host: 193 assertions on pinned Pi, 192 on compiled Pi. The compiled reload case failed at the wait, before the next assertion. New host coverage preserves complete CJK and combining-character output at 60/80/120 columns. This preservation test passed before the production change too. A separate renderer comparison passed 2,640 before/after layout comparisons and 5,280 assertions across dark/light themes, 11 selected widths (1–7, 12, 60, 80, 120), four result-part kinds and compact/expanded/partial states. These comparisons establish unchanged rows and bounded widths, not complete lifecycle acceptance.

No numerical acceptance budget was agreed. This experiment does not accept long-history resume, paced streaming, scroll latency, expanded resize, welcome startup, native-display interaction or long-duration real-model sessions. The current comparison above adds bounded resume, scroll and expanded-resize evidence. Paced streaming, complete welcome rendering, extended real-model sessions and final full-diff review still require acceptance evidence; the history/assistant integration decisions are no longer pending.
