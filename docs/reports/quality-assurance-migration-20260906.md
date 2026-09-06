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

## Batch 2: test classification and reduction

Base: `f506b4f1` (Batch 1 checkpoint); this is the reviewed Batch 2 checkpoint. The current test
inventory is 332 files (331 offline and one explicit live file): 130 Component, 159 Component Integration, 2 System, 10 System Integration, and 31 Acceptance.
The directory map is `level/capability/scenario`; helpers remain in neutral `test/<legacy-capability>` locations. The
Goal smoke was renamed to `test/component-integration/goal/goal-runtime.test.mjs` and uses native Bun scenarios. The
21 remaining `.node.ts` files retain the Node compatibility boundary and compile once before execution.

The runner now exposes `--level`, `--capability`, `--file`, and `--name` selection. Repeated selectors in one dimension
union; different dimensions intersect. `--name` is a native regex candidate filter and does not scan source names.
Unknown arguments and empty explicit selections fail. The default profile is offline; live execution requires explicit
`--profile live`, with `magic-context-live` as the only live Magic Context wrapper. `--list` reports requirements
without setup. Reports under `.artifacts/tests/` include actual file/process durations and setup duration; zero actual
tests is nonzero, including Node compatibility runs.

Code Mode RPC and TUI offline Acceptance wrappers use the real Host and fixture Provider. The Agent ran Code Mode RPC in 8.33 s and TUI group/failure/media/cancel behavior in 113.48 s, with resume widths 100 and 64.
Goal native name selection (`normal continuation`) took 0.52 s; a native Unit selector ran three tests in 1.2 s. A
Node no-match selection failed with zero tests as intended. Static checks and focused command, native-tool, Node compatibility, and real Code Mode acceptance checks passed. Two consecutive independent Thermo-Nuclear rounds reported no findings against the complete diff. The official Code Mode executable installed in local artifacts has SHA-256
`60bf16414be5333f09ff082540082304c7352931ef64bdeb170d4c35a82e6ef8`; the compatibility row records this identity.

Real RTK scenarios require the certified executable; explicit absence is a failure. Current preflight is
implemented in the shared test-environment helper. The 150 ms first-UI/input/selection targets and
200 ms unchanged-spinner target remain explicit PTY requirements; the 500 ms severe-stall assertion remains a separate
backstop. Stable focused certification is still pending. No full test suite, final CI/affected selection, or live Magic Context call was run for Batch 2. Batch 3 remains responsible
for affected selection and CI orchestration.


The generator test no longer freezes three wrapper statements or Goal's exact multiline formatting. Semantic Capability membership, Suite loader behavior, and real source-install acceptance remain.

Paired same-host focused runs (single samples, including Bun startup): generator `0.185 s` before / `0.168 s` after; Suite loader `0.573 s` before / `0.504 s` after. Both passed on the clean baseline and this worktree. These small differences do not establish an overall speedup. Changed JavaScript/TypeScript source totals 79,366 physical lines before and 79,824 after (+458); file moves preserve most of that source.

The Web direct-Provider redirect-declaration guard now runs with Static Checks; a small Component test protects the AST-based declaration count. This retains the previous parity constraint without claiming request-data-flow proof. Codex native Tool checks no longer skip unsupported/missing executables and passed three cases through the real local binaries. Missing Pi preflight was verified to leave the scenario unexecuted and emit an explicit failure report.

## Reusable diagnoses

**RTK setup identity:** the maintainer's default executable failed the certified SHA-256 check. This was an environment
failure, not a timing regression or flaky test. Downloading the official 0.45.0 release into local artifacts and verifying
both the archive and executable hashes allowed the unchanged RTK scenario to pass with explicit `RTK_BIN`. Do not
weaken the identity check or treat an unrelated local RTK version as certified evidence.

**Removed-call audit:** filename similarity was insufficient to prove duplicate coverage. MCP and RTK PTY calls had no
test caller and were restored before the checkpoint. All 17 former aggregate calls were then matched to actual call
sites and their dimensions/defaults; the removed ten families already include the original scenarios.
