# Conversation UI performance observations

[简体中文](i18n/zh-CN/ui-performance.md) · English is normative.

Reusing Pi's native result component reduced repeated Ctrl+O expansion from a median 1,174 ms to 33 ms. A later width-check change reduced first expansion from 1,097 ms to 102 ms in a fresh comparison. These are bounded experiments for retained retrieval output, not complete performance acceptance for [#106](https://github.com/jczhang02/pi-stuff/issues/106).

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

## Verification limits

For the initial cache increment, retrieval/group/error suites passed 19 cases and failed the two known reload/resume cases on both pinned Pi 0.85.1 and compiled Pi 0.87.0, with 182 assertions per host. After the final lazy-metadata adjustment, independent checks passed the strengthened same-width theme test on both hosts, 16 assertions each, plus 20 real-component assertions for partial/final output, replacement text, warning/error and metadata transitions. The theme test also verifies narrow wrapping and that reopening a result does not reread a changed file.

After the width check, the same three suites passed 20 cases and failed those two history cases on each host: 193 assertions on pinned Pi, 192 on compiled Pi. The compiled reload case failed at the wait, before the next assertion. New host coverage preserves complete CJK and combining-character output at 60/80/120 columns. This preservation test passed before the production change too. A separate renderer comparison passed 2,640 before/after layout comparisons and 5,280 assertions across dark/light themes, 11 selected widths (1–7, 12, 60, 80, 120), four result-part kinds and compact/expanded/partial states. These comparisons establish unchanged rows and bounded widths, not complete lifecycle acceptance.

No numerical acceptance budget was agreed. This experiment does not accept long-history resume, paced streaming, scroll latency, expanded resize, welcome startup, native-display interaction or long-duration real-model sessions. Those checks, resource attribution, the pending history/assistant integration decisions and final full-diff review remain required before complete UI delivery.
