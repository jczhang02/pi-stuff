# Engineering documentation

Current engineering documentation is English. Use these sources in this order:

- [`README.md`](../README.md) — user entry point and current Capability overview.
- [`CONTEXT.md`](../CONTEXT.md) — canonical domain language and ownership boundaries.
- [`DESIGN.md`](../DESIGN.md) — shared visual and interaction language.
- [`compatibility.md`](compatibility.md) — the only current Host and toolchain certification statement.
- [`adr/`](adr/) — accepted and superseded architectural decisions.
- [`agents/`](agents/) and [`CONTRIBUTING.md`](../.github/CONTRIBUTING.md) — maintainer workflows.
- [`packages/pi-stuff/README.md`](../packages/pi-stuff/README.md) and Module READMEs — behavior closest to the source.

## Current decision map

| Area | Current authority |
| --- | --- |
| Host and Package boundary | [`CONTEXT.md`](../CONTEXT.md), ADR [0001](adr/0001-keep-pi-as-the-host.md), and [0003](adr/0003-maintain-one-local-package-with-internal-capability-modules.md) |
| Visible UI | [`DESIGN.md`](../DESIGN.md) plus the owning Module README or accepted ADR |
| Tool Activity | ADR [0010](adr/0010-fold-continuous-retrieval-segments.md); ADR 0002 is superseded |
| Code Mode | ADR [0009](adr/0009-align-code-mode-with-openai-and-cloudflare.md), [0011](adr/0011-add-global-code-mode-default.md), and [0014](adr/0014-expose-code-mode-configuration-scope.md); ADR 0005 is superseded |
| Context Management | ADR [0007](adr/0007-initialize-configured-context-before-editor-readiness.md) and [0008](adr/0008-own-the-context-command-surface.md) |
| Settings and Web configuration | ADR [0012](adr/0012-merge-pi-stuff-settings-file.md) as amended by [0013](adr/0013-unify-web-configuration.md) |
| Session Naming | ADR [0020](adr/0020-add-automatic-session-naming.md) and the owning Module README |
| Agent lifecycle compatibility | ADR [0018](adr/0018-end-live-v1-agent-governor-coexistence.md) |
| Compatibility and verification | [`compatibility.md`](compatibility.md) and the root [`AGENTS.md`](../AGENTS.md) |

## Time-bound evidence

The files under [`reports/`](reports/), [`research/`](research/), [`releases/`](releases/), and
[`prototypes/`](prototypes/) preserve dated evidence and rejected alternatives. Their recorded versions and paths
describe the snapshot that produced them; they do not override the current sources above.

## Localizations

Reader-facing translations live by locale under [`i18n/`](i18n/). The Simplified Chinese entry points are
[`i18n/zh-CN/README.md`](i18n/zh-CN/README.md) and [`i18n/zh-CN/DESIGN.md`](i18n/zh-CN/DESIGN.md). English current
engineering documents remain authoritative when translations differ.
