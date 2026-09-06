# Quality-assurance migration — 2026-09-06

## Batch 1: command and execution boundaries

Baseline: `cac0e79a866c3973a1515a5044441e136f30652e`. This is checkpoint evidence, not final acceptance of the full
[migration design](../adr/0032-organize-quality-assurance-by-verification-purpose.md).

| Evidence | Before | Batch 1 |
| --- | --- | --- |
| `check` scope | Static checks, all tests, Tool Activity benchmark, archive/Host aggregate | Read-only static checks, including source Package validation |
| Ordinary test runner | Bun runner plus separately invoked Goal runner; arguments ignored | One selected file inventory; Bun and compiled Node files remain separate OS processes |
| Repeated Host verifier families | Ten already-tested families called again by Package aggregate | Ten calls removed; seven previously unique calls have primary test entries |
| Suite surface within Package aggregate | Twice, once before packing and once after | One inspector scenario; installed-source discovery is separate evidence |
| Package delivery evidence | Archive creation/extraction | Real `pi install`, isolated settings, then loading outside the checkout |
| Changed implementation/test source | 4,525 physical lines | 4,856 physical lines (+331) |

The source increase buys argument validation, reporting, live-profile boundaries, real installation evidence, and
proportional command tests. It does not add a dependency or a second product runtime. The largest touched files remain
below the 800-line gate; independent review assessed the files above 500 lines and found their responsibilities cohesive.

Focused execution on the local Linux x64 host, Bun 1.4.0 and Pi 0.85.0:

- Command previews, invalid selectors, benchmark discovery, source constraints, and a selected Goal Node test passed.
  Goal compilation ran once before selected Node execution; the Node test reported 6.64 ms for three cases.
- Source installation passed in 3.29 seconds. The retained Suite inspector, Web fixture, Goal lifecycle, Notification
  PTY, and Host seams passed in 52.02 seconds combined. MCP PTY passed in 17.78 seconds; RTK PTY passed in 7.48 seconds.
- Benchmark command tests passed in 6.80 seconds, source Package tests in 0.11 seconds, and Effect comparison-tool tests
  in 7.52 seconds. Tool Activity completed with a local JSON report and no gating on comparative timing values.
- `bun run check` passed after integration. No live model benchmark was run. Two consecutive independent
  Thermo-Nuclear reviews reported no findings against the final checkpoint source.

These timings have different scopes; they are not additive full-suite timing or a claimed before/after speedup. Baseline
and final full CI comparisons remain part of the final migration evidence. Local JSON reports are under ignored
`.artifacts/tests/`; benchmark reports are separate artifacts.

## Reusable diagnoses

**RTK setup identity:** the maintainer's default executable failed the certified SHA-256 check. This was an environment
failure, not a timing regression or flaky test. Downloading the official 0.45.0 release into local artifacts and verifying
both the archive and executable hashes allowed the unchanged RTK scenario to pass with explicit `RTK_BIN`. Do not
weaken the identity check or treat an unrelated local RTK version as certified evidence.

**Removed-call audit:** filename similarity was insufficient to prove duplicate coverage. MCP and RTK PTY calls had no
test caller and were restored before the checkpoint. All 17 former aggregate calls were then matched to actual call
sites and their dimensions/defaults; the removed ten families already include the original scenarios.
