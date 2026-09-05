# Contributing

## Before starting

Read `AGENTS.md`, `CONTEXT.md`, `docs/compatibility.md`, and the relevant ADR or Module README. Use Beads for accepted
shared work and claim a ready issue before implementation; external requests are adopted by a maintainer first.
Keep changes within Pi's native Package and Extension contracts.

## Development

Use the repository's pinned Bun version. Run focused checks and `bun run check:fast` while developing; run the required
CI checks on the final revision before PR readiness. Tests should exercise agreed public seams, remain offline, and
never call an LLM or require credentials. Unknown-impact changes need the full check.

## Package changes

Pi Stuff has one private local Package. Capability Modules are not independently versioned or published. When behavior
needs a durable user-facing record, update `docs/releases/`. Change `packages/pi-stuff/suite.json`, run
`bun run suite:generate`, and verify with `bun run pack:verify`; do not edit generated output alone.

## Commits

Use signed Conventional Commits:

```text
<type>(<scope>): <imperative subject>
```

Maintainers may push verified commits to `main`. External contributions use a pull request for delivery and review;
accepted scope and status remain in Beads under the [issue-tracker contract](../docs/agents/issue-tracker.md).
Force-pushing and deleting `main` are prohibited.
