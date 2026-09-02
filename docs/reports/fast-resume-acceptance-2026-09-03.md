# Fast Resume acceptance — 2026-09-03

This report records the final performance and real-Host acceptance evidence for Fast Resume on certified Pi 0.84.4.
The owning behavior remains documented in the [Capability guide](../capabilities/fast-resume.md) and
[ADR 0026](../adr/0026-add-fast-resume.md).

## Boundary

The latency boundary starts when the submission Enter for interactive `/resume` reaches Pi and ends at the first
complete stable selectable Current Folder list. A separate first-paint timestamp records the first Fast Resume frame.
The harness polls an isolated 120 by 40 tmux pane every 5 ms with extended CSI-u keys enabled.

The private corpus was exposed to benchmark processes through a temporary directory containing read-only symlinks and
one temporary active fixture. No Session was selected, renamed, deleted, or modified. The harness retained only counts,
byte totals, and timing values; it retained no private Session name, message, terminal capture, or screenshot.

Each comparison used one warmup per variant followed by 20 alternating runs, ten native and ten Fast Resume. Page cache
was not cleared. P95 is the maximum of each ten-run sample.

## Real local corpus

The mirrored current-project corpus contained 81 Sessions totaling 467,675,212 bytes.

| Variant | First paint median | First paint P95 | Complete Current median | Complete Current P95 |
| --- | ---: | ---: | ---: | ---: |
| Pi native `/resume` | — | — | 1,579.5 ms | 1,676.3 ms |
| Pi Stuff Fast Resume | 47.2 ms | 54.9 ms | 49.2 ms | 59.5 ms |

Fast Resume reached the complete selectable list about 32 times faster at the median and satisfied the registered
first-paint P95 ceiling of 100 ms and complete-list P95 ceiling of 300 ms.

## Deterministic representative corpus

The committed real-Host harness also generated 75 valid Sessions totaling 432,000,000 bytes. Large assistant entries
made Pi's native selector parse the representative byte volume while Fast Resume read only row metadata.

| Variant | First paint median | First paint P95 | Complete Current median | Complete Current P95 |
| --- | ---: | ---: | ---: | ---: |
| Pi native `/resume` | — | — | 644.5 ms | 675.8 ms |
| Pi Stuff Fast Resume | 47.5 ms | 53.7 ms | 49.0 ms | 55.6 ms |

The same harness verified interactive `/resume`, the configured Host resume action, two consecutive reloads,
`/fast-resume` with an initial query when interception was disabled, an optional standalone shortcut, startup
`--resume` isolation, and wide, narrow, and low Command Dialog layouts under real dark and light Host themes.

## Result

Fast Resume passed its latency, lifecycle, entry-point, settings, and responsive real-Host gates on the certified
artifact. The benchmark does not claim complete-history search or exact partial-read metadata; those remain the
explicit ceilings documented by the Capability.
