# Adopting DESIGN.md for Pi Stuff

Date: 2026-08-17

## Question

Can Google's `design.md` format become the durable shared design description for Pi Stuff without inventing Web
tokens or weakening Pi's ownership of terminal behavior?

## Primary-source findings

Google describes `DESIGN.md` as a plain-text design-system source that combines optional machine-readable YAML tokens
with human-readable rationale. Tokens are normative when present; prose explains how to apply them. The canonical body
order is Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, and Do's and Don'ts.

- [Official README and CLI reference](https://github.com/google-labs-code/design.md/blob/main/README.md)
- [Official format specification](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md)
- [Official design philosophy](https://github.com/google-labs-code/design.md/blob/main/PHILOSOPHY.md)

The philosophy explicitly puts design intent in prose and permits domain-specific sections and token structures. The
format also supports documented omission of token groups. Those two properties make it usable for a terminal product
whose visual values are supplied by a Host rather than by CSS.

The official CLI can lint document structure and references, compare revisions, and export Web/DTCG tokens. Version
`0.4.0` is currently published, but the format is still marked `alpha`; its schema and CLI are under active
development.

## TUI fit

The standard token schema assumes CSS colors, font properties, pixel-like dimensions, rounded corners, and a small set
of Web-shaped component properties. It has no native representation for ANSI semantic theme roles, terminal-cell
width, box-drawing glyphs, keyboard navigation, editor restoration, or Pi's Command Dialog lifecycle.

Pi Stuff therefore uses the portable document structure without pretending that Web tokens are authoritative:

- Root `DESIGN.md` is the shared system-wide visual language.
- Pi Host semantic theme tokens remain the color authority; fixed color tokens are intentionally omitted.
- Host and terminal settings remain the typography authority.
- Reusable cell counts are recorded only where the generic spacing schema can express them honestly.
- TUI component behavior lives in the canonical Markdown sections and remains refined by Capability ADRs.
- Real Pi PTY captures and native-terminal review remain the acceptance authority; the DESIGN.md linter cannot certify
  terminal behavior.

## Adoption boundary

Do not add `@google/design.md` to the Pi Stuff Package or its runtime graph. For now, validate the document with an
explicit, transient, version-pinned CLI invocation:

```bash
bunx @google/design.md@0.4.0 lint DESIGN.md
```

Do not add the Web-oriented Impeccable HTML/CSS sidecar or a custom TUI exporter until a concrete consumer requires
one. Revisit the pinned CLI version deliberately because the upstream format is alpha.

`DESIGN.md` owns durable cross-surface visual language. `AGENTS.md` owns engineering instructions. ADRs and Capability
READMEs continue to own surface-specific information, interaction, state, and safety contracts. Prototype reports are
evidence and may describe accepted-but-unimplemented targets; they do not prove shipped behavior.

## Local evidence used for the first version

- `AGENTS.md` UI and architecture contracts
- `CONTEXT.md` canonical domain language
- `docs/adr/0004-route-suite-diagnostics-through-owned-ui.md`
- `docs/adr/0008-own-the-context-command-surface.md`
- `docs/adr/0010-fold-continuous-retrieval-segments.md`
- `docs/research/agent-activity-ui-reference.md`
- `docs/prototypes/tui/README.md`
- `docs/research/tui-prototype-methods.md`
- `docs/reports/dialog-readability-20260817/content.json`
- Relevant Capability READMEs and the accepted `/tools` split-pane prototype
