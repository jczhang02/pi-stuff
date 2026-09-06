# Quality assurance

Static Checks validate source without running product scenarios. Tests establish behavior through their declared
seams. Capability Benchmarks measure performance or effectiveness independently of verification gates. Reviews assess
requirements, design, security, maintainability, and the usefulness of that evidence.

## Current commands

```bash
bun run check
bun run fix
bun run test --list
bun run test --file source-install
bun run test --file goal-upstream/command.node.ts
bun run benchmark:capability:ponytail --help
```

`check` runs formatting, lint, all TypeScript profiles, dependency/unused-source analysis, generated composition,
repository safety, the Capability Contract Catalog, and static Package/resource/license validation. It does not rewrite
source or execute Benchmarks. `fix` explicitly applies formatting and safe lint fixes; generated composition and
snapshots have separate explicit update operations.

`test` discovers Bun tests and the Goal Node compatibility corpus, including the Goal runtime smoke. Each file receives
a separate OS process. Repeated `--file` arguments and positional path fragments select their union; every explicit
selector must match. `--help` and `--list` execute no scenarios. Reports default to timestamped JSON under
`.artifacts/tests/`; `--output <path>` changes the destination. The report records executed files, exit statuses, and
per-file elapsed times. A failing file produces a failing command while later selected files still run.

Ordinary Tests use deterministic fixtures without model credentials. Real Pi, Node, Code Mode, RTK, Expect, tmux, and
local system tools are required where a scenario uses their public boundaries; missing tools fail that scenario.
Configured live Provider and Service evidence is separate from these offline results.

## Source installation and retained evidence

Static Package verification checks source/resources, declared external dependencies, native Tool executability, and
license/provenance records. Distribution archives are not a delivery requirement.

`test/source-install.test.ts` runs the certified Pi `install` command with isolated Settings and XDG directories,
then starts Pi outside the checkout and observes commands loaded through the installed Package setting. It never
changes the maintainer's installation. The installed process and temporary environment are cleaned up.

The former package-verification aggregate repeated Agents, BTW, Context, Goal, Tools, UI, and Background Work
Host/PTY scenarios already owned by test files. Those repeated calls are removed. Its distinct Suite Tool inspectors,
Web fixture integration, Goal lifecycle, MCP/RTK/Notification PTY, and public Host-seam scenarios now live in
`test/package-host.test.ts`. The existing RPC and PTY tests remain because they observe different contracts.

## Benchmarks

Existing experiments are named `benchmark:capability:<name>`. Image transfer, Ponytail behavioral effectiveness,
Skill Discovery, Markdown, Effect/mainline, lifecycle, Magic Context, and Tool Activity are Capability-scoped questions.
Using a complete Host does not establish complete-Suite public-task outcomes.

Use each command's `--help` or `--list` before execution. Ponytail, Code Mode image, and authenticated Skill Discovery
experiments require `--profile live`; their help and previews do not use credentials. Historical reports remain dated
evidence; newly generated reports use local artifacts unless an output is explicitly selected.

Completed experiments may report poor scores or performance regressions without failing the command. Setup failures
and incomplete experiments remain failures. Tool Activity's former 250 ms and relative 25 ms limits are retained as
diagnostic report values rather than verification gates. They measured comparison outcomes, not an independently
specified performance requirement. The separate 200 ms spinner requirement audit remains pending.

The Suite Outcome Evaluation branch is reserved for complete-Suite public-task evaluation. Historical Terminal-Bench
manifests and reports do not constitute a runnable evaluation; `benchmark:suite` is not registered.

## Migration status

This first batch separates command execution boundaries and removes repeated archive/Host invocation. Current CI still
uses the existing Fast/Acceptance orchestration, with the new static and test commands and no benchmark gate.
Five-level directory classification, Capability and test-name filtering, conservative `verify` selection, explicit live
acceptance routing, and Plan/Checks/Tests/Verify CI are the next migration batches under
[ADR 0032](adr/0032-organize-quality-assurance-by-verification-purpose.md). They are not yet exposed as completed commands.
