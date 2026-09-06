# Contributing

## Before starting

1. Read `AGENTS.md`, `CONTEXT.md`, and relevant ADRs.
2. Use Beads for accepted work and claim a ready issue before implementation.
3. Keep the change within Pi's native Package and Extension contracts.

External bug and feature requests may start through GitHub issue forms. A maintainer adopts accepted work into Beads before implementation.

## Development

Use Bun 1.4.0:

```bash
bun install --frozen-lockfile --ignore-scripts
bun run check
```

Tests must exercise the agreed public seams, remain offline during verification, and never call an LLM or require credentials.

For continuous native Spinner, input, and autocomplete-selection checks, use
`bun scripts/benchmark-responsiveness.ts --pi "$PI_BIN"`. It creates an isolated synthetic Session and retains raw
observations outside the repository. The [observer report](../docs/reports/suite-responsiveness-observer-2026-09-05.md)
documents frozen gates, negative controls, and the cold Execution Ledger reproduction. These focused checks do not
replace complete resource or Capability acceptance.

When `PI_STUFF_UI_PTY_ARTIFACT_DIR` is set, the observer also copies its evidence JSON there after capture. CI retains
these synthetic frames, interaction timings and Source snapshots in its existing failure attachment; Host binaries and
private fixture configuration are not copied.

## Package changes

Pi Stuff has one private local Package. Capability Modules are not independently versioned or published. Update the
release notes under `docs/releases/` when a behavior change needs a durable user-facing record. Git retains the
detailed change history.

Do not hand-edit generated composition output alone. Change `packages/pi-stuff/suite.json`, run
`bun run suite:generate`, and verify the extracted local Package with `bun run pack:verify`. There is no registry
publication or Changesets workflow.

## Commits

Use signed Conventional Commits:

```text
<type>(<scope>): <imperative subject>
```

Maintainers may push verified commits directly to `main`. External contributions should use a pull request as the
code-delivery and review surface; accepted scope and status remain in Beads as described in the
[issue-tracker contract](../docs/agents/issue-tracker.md). Force-pushing and deleting `main` are prohibited.
