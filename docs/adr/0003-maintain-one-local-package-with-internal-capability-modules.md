---
status: accepted
---

# Maintain one local Package with internal Capability Modules

Pi Stuff is installed, upgraded, tested, and used as one Suite. The maintainer does not need to publish or install its
capabilities as independent npm Packages. The previous workspace topology imposed a separate manifest, version,
dependency edge, archive, and release step on every Capability even though the user-facing deployment unit was always
`@jczhang02/pi-stuff`.

Pi Stuff will therefore keep one locally installed Pi Package with one default Extension factory. Each coherent
Capability remains an internal Module with a small installation interface. Package removal changes distribution and
maintenance topology only; it does not combine unrelated Capability state or behavior.

The internal Modules are:

- `conversation-ui`
- `tool-display`
- `context-management`
- `rtk`
- `codex`
- `goal`
- `web`
- `mcp`
- `background-work`
- `subagents`
- `todo`
- `btw`

The ordered Suite entry installs these Modules through Pi's existing Extension interface. `conversation-ui` and
`tool-display` provide shared presentation interfaces. Capability Modules may depend on those interfaces. Shared
Modules must not import a Capability Module. The few necessary Capability-to-Capability dependencies remain explicit:
BTW and Subagents use Context projection, and Subagents contribute a source to Background Work.

The adapted MCP and Web implementations become private implementation directories inside their owning Modules. They
are not separate workspace Packages or user-visible dependencies. Their original projects, pinned revisions, license
texts, and Pi Stuff changes remain recorded and shipped with the local Package. Future upstream fixes are reviewed and
incorporated selectively rather than synchronized through a second Package lifecycle.

The local Package is not published to npm. Registry publication, Changesets, per-Capability versions, self-owned
runtime dependencies, and multi-Package release manifests are removed. A single extracted-Package verification remains
because it tests the same file allowlist and Pi loading seam used by local installation.

## Consequences

- Pi remains the Host and continues to own the CLI, TUI, sessions, settings, Package loading, and model interaction.
- Extension import and startup purity, UI behavior, Tool schemas, session history, and model-visible results do not
  change as part of this migration.
- The repository keeps a private development manifest and one runtime Package manifest; only the latter is a Pi
  Package.
- Runtime dependencies are declared once and pinned by the repository lockfile.
- Tests are organized by Module and continue to certify behavior through public Host and Module interfaces rather than
  through npm Package names.
- A Capability may be extracted into a Package later only after it gains a real independent installation or consumer.
