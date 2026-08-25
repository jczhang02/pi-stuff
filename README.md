<div align="center">

# Pi Stuff

**A conversation-first capability suite for the native [Pi coding agent](https://github.com/earendil-works/pi).**

One local Pi Package for compact Tool activity, durable work, focused side flows, and lazy integrations—without
replacing Pi.

English · [简体中文](docs/i18n/zh-CN/README.md)

[![CI](https://github.com/jczhang02/pi-stuff/actions/workflows/ci.yml/badge.svg)](https://github.com/jczhang02/pi-stuff/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2f2f2f.svg)](LICENSE)

</div>

## Interface

These visual captures were recorded in Ghostty `1.3.1` on Pi `0.84.1`; they are historical UI evidence, not the
current Host certification. Click an image for the full-resolution view.

**Welcome and shared Statusline**

[![Pi Stuff Welcome card and shared Statusline](docs/assets/readme/pi-stuff-welcome.png)](docs/assets/readme/pi-stuff-welcome.png)

| Native `/ui` settings | Compact Tool activity and Todo |
| :---: | :---: |
| [![Pi Stuff native UI settings](docs/assets/readme/pi-stuff-ui-settings.png)](docs/assets/readme/pi-stuff-ui-settings.png) | [![Pi Stuff compact Tool activity and Todo](docs/assets/readme/pi-stuff-tool-activity.png)](docs/assets/readme/pi-stuff-tool-activity.png) |

## What is Pi Stuff?

Pi Stuff assembles a personal set of capabilities into one ordinary Pi Package. Pi remains the **Host** and continues
to own the CLI, TUI, sessions, settings, Package loading, and model interaction. Pi Stuff adds one ordered **Suite**
through Pi's native Extension interface.

The result is a denser, quieter coding workflow:

- **Conversation-first UI** — a responsive Welcome card, one bounded Statusline, live Thought projection, terminal
  `chart`/`tree` fences, input highlighting, and full-width Pi-native Command Dialogs.
- **Compact Tool activity** — continuous Tool work becomes one semantic Activity Group; `Ctrl+O` and `/tools` restore
  the underlying detail.
- **Semantic Session names** — the first settled direct-user exchange receives a bounded model-generated name;
  `/autoname` refreshes it explicitly, `/autoname settings` controls routine policy and the primary model, and automatic naming never takes over Child Agent Sessions.
- **Durable objectives and plans** — Goal can continue one evidence-gated objective, while Todo keeps recoverable
  session tasks in a bounded checklist.
- **Current-session parallel work** — Background Shells, one-shot Monitors, and foreground or background Agents stay
  inspectable without becoming a second scheduler or runtime.
- **Side questions without transcript noise** — `/btw` answers a focused question outside the main conversation and
  restores the original editor draft when closed.
- **Settled-work attention** — terminal-native alerts arrive only after user-started Agent work genuinely settles,
  with a short activity-cancellation grace period.
- **Bounded integrations** — configured Context initializes before editor readiness; unconfigured Context, Web, MCP,
  RTK, Codex controls, and optional Code Mode activate only when needed and fail safely when unavailable.

Pi Stuff is maintained as a private, local-only Package. It is not published to npm, and its Capability Modules are
not independently installable products.

## Quick start

For the certified path, use the Pi `0.84.3` Linux x64 Host built from upstream
`4e58f324fae8ebfa98a3d45181fb248072a2afac`. A matching version string alone does not establish certification.

```bash
git clone https://github.com/jczhang02/pi-stuff.git
cd pi-stuff
pi install ./packages/pi-stuff
pi
```

`pi install` lets Pi add the Package to the user-owned Settings Layer. Pi Stuff does not install itself or mutate Pi
settings during import or startup.

Once Pi starts, these are useful entry points:

| Command | Purpose |
| --- | --- |
| `/ui` | Configure the Statusline, Welcome card, input presentation, and Tool timer |
| `/ctx` | Inspect Context status and run guided history maintenance |
| `/notifications` | Configure and test completion and failure notifications |
| `/autoname` · `/autoname settings` | Regenerate the current Session name or configure automatic naming policy and its primary model |
| `/goal <objective>` | Start persistent, evidence-gated work toward one session objective |
| `/btw <question>` | Ask a no-Tool side question without changing the main transcript |
| `/tasks` | Inspect and control Background Shells and Monitors |
| `/agents` | Inspect and control current-session Agents |
| `/tools` | Inspect the members and bounded results of a Tool Activity Group |
| `/diagnostics` | Review bounded, redacted Suite problems from the current process |
| `/codex` | Inspect Codex usage and Fast mode when using a supported Codex model |
| `/mcp` | Inspect lazily configured MCP servers |
| `/rtk` | Verify or configure optional RTK command rewriting |
| `/codemode` | Open the optional Code Mode controls and persist the choice in the trusted project |

Inside tmux, terminal-native notifications require `set -g allow-passthrough on`. Pi Stuff wraps notification
protocols for tmux, and `Tmux notification` exclusively controls attention BELs. Turning it on adds BEL without
replacing a supported system notification, or falls back to BEL when `auto` cannot identify a visual protocol. Turning
it off preserves supported system notifications and suppresses BEL, including explicit `bell` delivery. Pi Stuff does
not mutate user-owned tmux settings.

Notification `auto` delivery selects Kitty OSC 99, Ghostty OSC 777, or OSC 9 for iTerm2 and WezTerm. Response previews
are off by default because desktop notification history may be visible outside Pi. Outside tmux, the optional
terminal-bell setting adds BEL; the terminal, not Pi Stuff, decides how BEL sounds or appears.

External services, authentication, MCP declarations, Magic Context configuration, and the RTK executable remain
optional and user-owned. Their absence does not prevent ordinary Pi turns.

## Architecture

[![Animated Pi Stuff architecture: user-owned settings and input flow through the Pi Host into one local Pi Stuff Package and its ordered Capability Modules](docs/assets/readme/pi-stuff-architecture.gif)](docs/assets/readme/pi-stuff-architecture.png)

The architecture has three deliberate layers:

1. **Pi Host** owns the CLI, TUI, sessions, settings, Package loader, and model loop.
2. **`@jczhang02/pi-stuff`** exports one default Extension factory. Its generated entry follows the order declared in
   [`packages/pi-stuff/suite.json`](packages/pi-stuff/suite.json).
3. **Capability Modules** each own one coherent behavior inside the Package. `conversation-ui` provides shared
   presentation and Host-lifecycle coordination; `tool-display` provides the shared Tool presentation contract.

Import stays pure. Session startup does not access the network, launch subprocesses, mutate Host settings, or create,
rewrite, or migrate user configuration. Under [ADR 0007](docs/adr/0007-initialize-configured-context-before-editor-readiness.md),
a recognized, migration-free Context configuration may initialize rebuildable derived SQLite state before editor
readiness. Required initialization failures propagate instead of leaving a silently partial Suite.

### Capability map

The ordered Suite currently contains:

| Capability Module | What it contributes |
| --- | --- |
| `conversation-ui` | Welcome, Statusline, live Thoughts, `chart`/`tree` fence projection, input presentation, `/ui`, diagnostics, and shared Command Dialog lifecycle |
| `session-naming` | Bounded semantic Session names after settled direct-user work, branch-local ownership state, and `/autoname` policy/model controls |
| `tool-display` | Compact Tool Activity Groups, native expansion, `/tools`, and deterministic resume reconstruction |
| `rtk` | Optional fail-open Bash rewriting and model-only Bash/Grep output projection |
| `codex` | `/codex`, Fast mode, subscription usage, `apply_patch`, `view_image`, and `imagegen` |
| `goal` | One persistent session objective with automatic continuation and evidence-gated completion or blocking |
| `context-management` | Configured Magic Context integration, the `/ctx` control center, and Pi JSONL as the raw session authority |
| `ponytail` | Feature-complete Ponytail fork with persistent modes, six Skills, shared Statusline state, and a `/ponytail` control dialog |
| `web` | Bounded Web search, public HTTP(S) reading, PDF extraction, and continuation retrieval |
| `mcp` | One lazy MCP gateway with explicit authentication and stdio/HTTP transports |
| `background-work` | Current-session Background Shells, one-shot Monitors, and `/tasks` management |
| `subagents` | Foreground and background Agents, a compact roster, and `/agents` inspection |
| `todo` | Branch-replayable Task Tools and a bounded checklist above Pi's editor |
| `btw` | One-shot side questions that do not enter the main transcript or model context |
| `notification` | Delayed terminal-native completion and failure alerts for settled user-started Agent work |
| `code-mode` | An opt-in JavaScript envelope that exposes active Suite Tools through one provider-visible schema |

These names are internal maintenance boundaries. They have no separate manifest, version, installation, or publication
lifecycle.

### Context controls

`/ctx` opens Pi Stuff's full-width Context dialog. It shows current usage, compartments, memories, notes, Historian
state, pending drops, and available maintenance actions. The same actions are available as typed subcommands:

```text
/ctx status
/ctx flush
/ctx wrapup [messages-to-keep]
/ctx recomp [start-end]
/ctx upgrade
```

Maintenance progress and results use Pi Stuff Activity rows in the Session transcript. They remain available after
resume but never enter model context. Magic Context remains the data and execution authority; its Header, Footer,
Widget, Statusline, and dialog surfaces do not compete with Pi Stuff's UI.

### Ponytail controls

`/ponytail` opens the full-width control dialog for the current Session mode, default mode, Statusline visibility,
startup notification, and specialized Skills. Direct commands remain available, including `/ponytail full`,
`/ponytail default lite`, and the upstream-compatible `/ponytail-review` through `/ponytail-help` aliases. The shared
Statusline shows the selected mode as `♞ <mode>`; Agent activity remains in the Working Row. `off` contributes no
Ponytail instructions or model-visible Ponytail Skills, while explicit Skill commands remain available.

## Themes

The Package includes `catppuccin-latte`, `catppuccin-frappe`, `catppuccin-macchiato`, and `catppuccin-mocha`. Select a
theme in Pi's `/settings` menu or set its name in Pi's `settings.json`. Pi retains control of terminal-color fallback and
the user's theme choice.

## Compatibility and status

| Contract | Certified profile |
| --- | --- |
| Pi Host | `0.84.3`, upstream `4e58f324fae8ebfa98a3d45181fb248072a2afac` |
| Pi Host binary | Audited upstream Linux x64 release SHA-256 |
| Platform | Linux x64; Ubuntu 24.04 is the CI system-utility baseline |
| Bun | `1.3.14` |
| TypeScript | `5.9.3` |
| Optional RTK runtime | `0.42.4`, certified Linux x64 builds only |

Compatibility with other Pi builds is not claimed. A Pi upgrade is a coordinated repository change that updates the
pinned Host source profile, development types, and public-seam acceptance checks together. See the full
[`compatibility contract`](docs/compatibility.md).

## Development

Install the frozen dependency graph and run the complete repository check:

```bash
bun install --frozen-lockfile --ignore-scripts
bun run check
```

The check covers formatting, type surfaces, tests, unused code, generated Suite composition, repository safety, Tool
Activity performance, and verification of the extracted local Package against the certified Pi Host release. CI
downloads that release, verifies its exact binary hash, and runs acceptance without external network access.

Maintainer documentation is indexed in [`docs/README.md`](docs/README.md). Before changing behavior, read
[`CONTRIBUTING.md`](.github/CONTRIBUTING.md), the canonical language in [`CONTEXT.md`](CONTEXT.md),
[`DESIGN.md`](DESIGN.md) for visible surfaces, and the relevant records under [`docs/adr/`](docs/adr/). Engineering
work follows the [Beads workflow](docs/agents/issue-tracker.md) and is mirrored to
[GitHub Issues](https://github.com/jczhang02/pi-stuff/issues).

## Security

Pi Extensions execute with the user's operating-system permissions. Pi Stuff does not add a permission or command-
interception layer. Review the source before installation and use [private vulnerability reporting](.github/SECURITY.md) for
security issues.

## License

[MIT](LICENSE) © 2026 JC Zhang. Absorbed third-party source retains its adjacent license and provenance records.
