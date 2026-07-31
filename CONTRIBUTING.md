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

Publishable behavior or interface changes require a Changeset. Documentation, tests, and internal engineering changes do not. Capability Packages are independently versioned; do not hand-edit generated Aggregate composition or dependency metadata.

## Commits

Use signed Conventional Commits:

```text
<type>(<scope>): <imperative subject>
```

Maintainers may push verified commits directly to `main`. External contributions should use a pull request. Force-pushing and deleting `main` are prohibited.
