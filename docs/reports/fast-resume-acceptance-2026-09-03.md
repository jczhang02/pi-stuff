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
Page cache was not cleared. P95 is the maximum of each ten-run sample. The final matched sample pinned both arms
to the same four observed-idle logical CPUs to isolate unrelated concurrent Host workloads.

## Deterministic representative corpus

The real-Host harness generated 75 valid Sessions totaling 432,016,397 bytes. Each authoritative name precedes a large
assistant entry, placing it outside the former fixed tail window. Pi's native loader parses the representative byte
volume; Fast Resume scans that volume for name records while parsing only bounded transcript metadata.

| Variant | Complete Current median | Complete Current P95 |
| --- | ---: | ---: |
| Pi native `/resume` | 850.9 ms | 960.7 ms |
| Pi Stuff Fast Resume | 259.0 ms | 291.7 ms |

Fast Resume reached the complete selectable list about three times faster at the median and remained below the
registered 300 ms P95 ceiling while preserving every Session name.

## Native UI and behavior

The harness compared the complete visible selector cells and ANSI styling between native Pi and Fast Resume on matched
fixtures whose names sit outside the former fixed tail window. All four cases had zero cell and zero ANSI differences:
dark 120×40, light 120×40, dark 64×40, and dark 120×16.

The same certified-Host run verified interactive `/resume`, the configured Host resume action, repeated reload and
settings changes, disabled interception with an initial-query `/fast-resume`, the optional standalone shortcut,
startup `--resume` isolation, Current and All scope controls, sort and Named filters, path display, selection, rename,
current-Session deletion protection, confirmed deletion with post-delete refresh, and editor restoration.

## Ablation

Mounting Pi's exported `SessionSelectorComponent` removed the parallel selector implementation and its duplicate
controller, dialog, search, Session model, and mutation workflow. Fast Resume production TypeScript fell from 2,204 to
899 physical lines (−1,305, or 59%); focused tests fell from 895 to 565 lines (−330, or 37%). The remaining Module owns
only settings, lightweight Session loading, Effect operation ownership, the certified interception adapter, and native
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
gates on the certified artifact. Session names are exact. The benchmark does not claim complete-history search or exact
message counts and last-message activity; those remain the explicit ceilings documented by the Capability.
