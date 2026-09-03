# Fast Resume acceptance — 2026-09-03

This report records the final performance, native-UI parity, and real-Host acceptance evidence for Fast Resume on the
certified Pi 0.84.4 release artifact. The owning behavior remains documented in the
[Capability guide](../capabilities/fast-resume.md) and [ADR 0026](../adr/0026-add-fast-resume.md).

## Boundary

The latency boundary starts when the submission Enter for interactive `/resume` reaches Pi and ends when Pi's native
selector shows the complete stable selectable Current Folder list. The native component does not publish partial rows,
so first selectable and complete Current are the same boundary.

The harness polls an isolated tmux socket every 5 ms with `extended-keys=on` and `extended-keys-format=csi-u`. It ran
the exact certified Linux x64 executable with SHA-256
`ce91e1f8bff6176c6a23a690bd0bc4c6e1f5bee1b1183cd2a3b1e92d88c9038a`. The generated corpus contains no private
Session content, and the harness retains only aggregate timings and parity counts.

Each timing comparison used one warmup per variant followed by 20 alternating runs, ten native and ten Fast Resume.
Page cache was not cleared. P95 is the maximum of each ten-run sample.

## Deterministic representative corpus

The real-Host harness generated 75 valid Sessions totaling 432,016,397 bytes. Large assistant entries made Pi's native
loader parse the representative byte volume while Fast Resume read only bounded row metadata.

| Variant | Complete Current median | Complete Current P95 |
| --- | ---: | ---: |
| Pi native `/resume` | 1,003.6 ms | 1,181.3 ms |
| Pi Stuff Fast Resume | 96.3 ms | 119.0 ms |

Fast Resume reached the complete selectable list about 10 times faster at the median and remained below the registered
300 ms P95 ceiling.

## Native UI and behavior

The harness compared the complete visible selector cells and ANSI styling between native Pi and Fast Resume on matched
fixtures. All four cases had zero cell and zero ANSI differences: dark 120×40, light 120×40, dark 64×40, and dark
120×16.

The same certified-Host run verified interactive `/resume`, the configured Host resume action, repeated reload and
settings changes, disabled interception with an initial-query `/fast-resume`, the optional standalone shortcut,
startup `--resume` isolation, Current and All scope controls, sort and Named filters, path display, selection, rename,
current-Session deletion protection, confirmed deletion with post-delete refresh, and editor restoration.

## Ablation

Mounting Pi's exported `SessionSelectorComponent` removed the parallel selector implementation and its duplicate
controller, dialog, search, Session model, and mutation workflow. Fast Resume production TypeScript fell from 2,204 to
872 physical lines (−1,332, or 60%); focused tests fell from 895 to 506 lines (−389, or 43%). The remaining Module owns
only settings, bounded Session loading, Effect operation ownership, the certified interception adapter, and native
component mounting.

## Capability contract results

| Contract | Result |
| --- | --- |
| `fast-resume.selector` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` |
| `fast-resume.navigation` | `normal=pass; failure=pass; recovery=pass; boundary=pass` |
| `fast-resume.mutations` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` |
| `fast-resume.host-integration` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` |
| `fast-resume.latency` | `normal=pass; failure=pass; recovery=pass; boundary=pass` |

## Result

Fast Resume passed its latency, native-UI parity, lifecycle, mutation, entry-point, settings, and responsive real-Host
gates on the certified artifact. The benchmark does not claim complete-history search or exact partial-read metadata;
those remain the explicit ceilings documented by the Capability.
