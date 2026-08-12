# Contributing

## Before starting

1. Read `AGENTS.md`, `CONTEXT.md`, and relevant ADRs.
2. Use Beads for accepted work and claim a ready issue before implementation.
3. Keep the change within Pi's native Package and Extension contracts.

External bug and feature requests may start through GitHub issue forms. A maintainer adopts accepted work into Beads before implementation.

## Development

Use Bun 1.3.14:

```bash
bun install --frozen-lockfile --ignore-scripts
bun run check
```

Tests must exercise the agreed public seams, remain offline during verification, and never call an LLM or require credentials.

## Package changes

Pi Stuff has one private local Package. Capability Modules are not independently versioned or published. Update the
Package changelog when a behavior change needs a durable user-facing record; Git history retains removed per-Module
release history.

Do not hand-edit generated composition output alone. Change `packages/pi-stuff/suite.json`, run
`bun run suite:generate`, and verify the extracted local Package with `bun run pack:verify`. There is no registry
publication or Changesets workflow.

## Commits

Use signed Conventional Commits:

```text
<type>(<scope>): <imperative subject>
```

Maintainers may push verified commits directly to `main`. External contributions should use a pull request. Force-pushing and deleting `main` are prohibited.
