# Domain docs

This repository uses a single-context domain layout.

## Before exploring

Read:

- `CONTEXT.md` at the repository root;
- relevant ADRs under `docs/adr/`.

If either location is absent, proceed silently. Domain documentation is created and extended only when terminology or architectural decisions are actually resolved.

## Layout

```text
/
├── CONTEXT.md
├── DESIGN.md
├── docs/
│   ├── README.md
│   ├── compatibility.md
│   ├── adr/
│   └── agents/
└── packages/
```

Workspace Package boundaries do not automatically create separate domain contexts. Introduce `CONTEXT-MAP.md` only when genuinely independent domain languages emerge.
Reports, research, releases, prototypes, and localized translations are evidence or reader aids, not separate domain contexts.

## Vocabulary

Use the terms defined in `CONTEXT.md` in code, tests, issues, plans, and documentation. Do not silently replace canonical terms with synonyms.

If a required concept is absent, either reconsider whether it belongs to the domain or update the glossary through the domain-modeling workflow.

When a Session resolves a durable terminology or ownership decision, update `CONTEXT.md` or an ADR in the same change.
Session history is evidence, not the repository's long-term decision record.

## Architectural decisions

Read ADRs affecting an area before changing it. If proposed work contradicts an ADR, surface the conflict explicitly rather than silently overriding the decision.
