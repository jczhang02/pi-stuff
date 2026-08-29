# Engineering documentation

[Simplified Chinese](i18n/zh-CN/docs/README.md)

This directory and the linked repository documents form the Pi Stuff engineering wiki. English sources are
authoritative; Simplified Chinese mirrors are navigation-compatible translations, not separate specifications.

## Start here

Read the narrowest current authority that answers the question:

1. [`README.md`](../README.md) — user entry point, installation, and Suite overview.
2. [`packages/pi-stuff/README.md`](../packages/pi-stuff/README.md) — current Package behavior and commands.
3. The owning Capability Module README — behavior and maintenance notes closest to the source.
4. [`CONTEXT.md`](../CONTEXT.md) — canonical terminology and ownership boundaries.
5. [`DESIGN.md`](../DESIGN.md) — shared visual and interaction contract.
6. An accepted ADR — why a durable architecture choice exists.

Repository-wide rules live in [`AGENTS.md`](../AGENTS.md), [`code-quality.md`](code-quality.md), and
[`compatibility.md`](compatibility.md). Contributor and issue workflows live in
[`CONTRIBUTING.md`](../.github/CONTRIBUTING.md) and [`agents/`](agents/).

## Document roles

| Document | Owns | Does not own |
| --- | --- | --- |
| Root and Package READMEs | Current user-facing behavior and navigation | Historical rationale |
| Capability READMEs | Current local behavior, contracts, and maintenance | Cross-Suite architecture |
| `CONTEXT.md` | Canonical language and ownership boundaries | Procedural workflow |
| `DESIGN.md` | Shared visible-surface rules | Capability internals |
| ADRs | Durable decisions, trade-offs, and consequences | Current behavior already obvious from code or a README |
| Research and reports | Dated external evidence and acceptance records | Current requirements |
| Release notes | Historical shipped changes | Current compatibility |

When current behavior changes, update its owning README or contract in the same change. Record a new ADR only for a
hard-to-reverse, non-obvious trade-off. Git history is the archive for removed prototypes and redundant evidence.

## Capability documentation

| Area | Current documentation |
| --- | --- |
| Conversation UI | [`conversation-ui`](../packages/pi-stuff/src/conversation-ui/README.md) |
| Session Naming | [`session-naming`](../packages/pi-stuff/src/session-naming/README.md) |
| Tool Display | [`tool-display`](../packages/pi-stuff/src/tool-display/README.md) |
| RTK | [`rtk`](../packages/pi-stuff/src/rtk/README.md) |
| Codex Runtime | [`codex`](../packages/pi-stuff/src/codex/README.md) |
| Goal | [`goal`](../packages/pi-stuff/src/goal/README.md) |
| Context Management | [`context-management`](../packages/pi-stuff/src/context-management/README.md) |
| Ponytail | [`ponytail`](../packages/pi-stuff/src/ponytail/README.md) |
| Web | [`web`](../packages/pi-stuff/src/web/README.md) |
| MCP | [`mcp`](../packages/pi-stuff/src/mcp/README.md) |
| Background Work | [`background-work`](../packages/pi-stuff/src/background-work/README.md) |
| Agents | [`subagents`](../packages/pi-stuff/src/subagents/README.md) |
| Todo | [`todo`](../packages/pi-stuff/src/todo/README.md) |
| BTW | [`btw`](../packages/pi-stuff/src/btw/README.md) |
| Notification | [`notification`](../packages/pi-stuff/src/notification/README.md) |
| Code Mode | [`code-mode`](../packages/pi-stuff/src/code-mode/README.md) |

## Current ADR index

| ADR | Decision |
| --- | --- |
| [0001](adr/0001-keep-pi-as-the-host.md) | Keep Pi as the Host and Pi Stuff as one repository-owned Package |
| [0004](adr/0004-route-suite-diagnostics-through-owned-ui.md) | Route Suite diagnostics through owned UI |
| [0006](adr/0006-cache-unchanged-suite-modules-across-host-reload.md) | Cache unchanged Suite Modules across Host reload |
| [0007](adr/0007-initialize-configured-context-before-editor-readiness.md) | Initialize configured Context before editor readiness |
| [0008](adr/0008-own-the-context-command-surface.md) | Own the Context command surface |
| [0009](adr/0009-align-code-mode-with-openai-and-cloudflare.md) | Align Code Mode with OpenAI and Cloudflare |
| [0012](adr/0012-merge-pi-stuff-settings-file.md) | Use one merged settings file with read-only startup |
| [0015](adr/0015-certify-the-upstream-release-binary.md) | Certify the upstream release binary |
| [0017](adr/0017-project-chart-and-tree-fences-inside-conversation-markdown.md) | Project chart and tree fences inside Conversation Markdown |
| [0018](adr/0018-end-live-v1-agent-governor-coexistence.md) | End live v1 Agent governor coexistence |
| [0019](adr/0019-isolate-context-engine-work-from-the-host-ui-thread.md) | Isolate Context engine work from the Host UI thread |
| [0020](adr/0020-add-automatic-session-naming.md) | Add automatic Session naming at the settled user-work boundary |
| [0021](adr/0021-fork-ponytail-as-a-suite-capability.md) | Fork Ponytail as a Suite Capability |
| [0022](adr/0022-restrict-folding-to-native-retrieval.md) | Restrict compact folding to native retrieval |
| [0023](adr/0023-use-a-closed-operation-block-family.md) | Use a closed Operation Block family |

## Evidence and history

- [`research/`](research/) keeps selected external references and feasibility findings.
- [`reports/`](reports/) keeps acceptance records and retained raw or rationale material.
- [`releases/`](releases/) records historical releases.

These dated documents describe their recorded snapshot and never override current contracts. Redundant reports,
rendered duplicates, and disposable prototypes are removed once their useful conclusion has an owning current document
or ADR.

## Translations

Every retained human-authored English Markdown document has a Simplified Chinese mirror under
[`docs/i18n/zh-CN/`](i18n/zh-CN/) at the same repository-relative path. Each mirror records its source path and raw
source SHA-256; repository checks reject missing or stale mirrors. Runtime `SKILL.md` resources and
`THIRD_PARTY_NOTICES.md` files remain byte-sensitive English artifacts and are excluded. The historical Chinese-only
execution checklist remains Chinese-only.
