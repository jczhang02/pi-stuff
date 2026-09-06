# Quality assurance

Static Checks validate source without running product scenarios. Tests establish behavior through their declared seams.
Capability Benchmarks measure performance or effectiveness independently of verification gates. Reviews assess
requirements, design, security, maintainability, and the usefulness of that evidence.

## Current commands

```bash
bun run check
bun run fix
bun run test --list
bun run test --level acceptance --file repository/source-install.test.ts
bun run test --level component-integration --file goal/goal-runtime.test.mjs
bun run benchmark:capability:ponytail --help
```

`check` runs formatting, lint, all TypeScript profiles, dependency/unused-source analysis, generated composition,
repository safety, the Capability Contract Catalog, and static Package/resource/license validation. It does not rewrite
source or execute Benchmarks. `fix` explicitly applies formatting and safe lint fixes; generated composition and
snapshots have separate explicit update operations.

`test` discovers 332 files (331 offline and one explicit live file) under five levels: Component (`unit`), Component Integration (`component-integration`),
System (`system`), System Integration (`system-integration`), and Acceptance (`acceptance`). Within each level, files
are grouped by Capability directory and scenario. It runs one OS process per file. The Goal runtime smoke is a native
Bun test; the other 21 `.node.ts` compatibility files are compiled once and then run through Node. Repeated selectors
within one dimension are a union; different dimensions are an intersection. `--name` uses the native test runner's
regex candidate filter and does not scan source names. `--help` and `--list` execute no scenarios. Reports default to
timestamped JSON under `.artifacts/tests/`; `--output <path>` changes the destination. The report records selected
files, status, process duration, and setup duration. A failing or empty selected run returns nonzero.

The default profile is `offline`: deterministic fixture Providers, no credentials, and no live model calls. Real Pi,
Node, Code Mode, RTK, Expect, tmux, and local system tools are still required where a scenario uses their public
boundaries; missing required tools fail preflight or the scenario. Live Provider and Service evidence requires explicit
`--profile live`; the only live Magic Context scenario is `magic-context-live`. Fixture Provider evidence is not live
acceptance. `--list` reports tool requirements without setup or execution.

## Source installation and retained evidence

Static Package verification checks source/resources, declared external dependencies, native Tool executability, and
license/provenance records. Distribution archives are not a delivery requirement.

`test/acceptance/repository/source-install.test.ts` runs the certified Pi `install` command with isolated Settings and
XDG directories, then starts Pi outside the checkout and observes commands loaded through the installed Package
setting. It never changes the maintainer's installation. The installed process and temporary environment are cleaned up.

The former package-verification aggregate repeated Host/PTY scenarios already owned by test files. Those repeated calls
are removed. Distinct source-install, Suite inspection, Host seams, and dependency interoperability now have primary
homes under the applicable level and Capability directory. Existing RPC and PTY tests remain where they observe
different contracts.

## Benchmarks

Existing experiments are named `benchmark:capability:<name>`. Image transfer, Ponytail behavioral effectiveness,
Skill Discovery, Markdown, Effect/mainline, lifecycle, Magic Context, and Tool Activity are Capability-scoped questions.
Using a complete Host does not establish complete-Suite public-task outcomes.

Use each command's `--help` or `--list` before execution. Ponytail, Code Mode image, and authenticated Skill Discovery
experiments require `--profile live`; their help and previews do not use credentials. Historical reports remain dated
evidence; newly generated reports use local artifacts unless an output is explicitly selected.

Completed experiments may report poor scores or performance regressions without failing the command. Setup failures and
incomplete experiments remain failures. Tool Activity's former 250 ms and relative 25 ms benchmark values are retained
as diagnostic report values rather than verification gates. The explicit PTY requirements remain 150 ms to first Tool
UI/input/selection feedback and no unchanged Vibe Line Spinner frame beyond 200 ms; ADR 0025's 500 ms severe-stall
assertion is a separate backstop. Stable focused certification of these targets remains pending.

The Suite Outcome Evaluation branch is reserved for complete-Suite public-task evaluation. Historical Terminal-Bench
manifests and reports do not constitute a runnable evaluation; `benchmark:suite` is not registered.

## Migration status

Batch 2 classifies and reduces the test corpus, moves files into the five-level/Capability map, adds stable level
aliases, and removes obsolete acceptance aliases. The runner now supports `--level`, `--capability`, `--file`, and
`--name` selection, explicit offline/live profiles, strict empty and unknown selection failures, environment reporting,
and per-file/process/setup timing. Code Mode RPC and TUI have offline Acceptance homes using the real Host with a
fixture Provider. The explicit live Magic Context wrapper remains separate and was not run. Affected-test selection,
CI Plan/Checks/Tests/Verify orchestration, and final verification remain Batch 3 work under
[ADR 0032](adr/0032-organize-quality-assurance-by-verification-purpose.md).
