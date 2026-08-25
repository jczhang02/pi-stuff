# `@jczhang02/pi-stuff`

The single local Pi Package for the complete Pi Stuff Suite.

## Contract

- Loads through Pi's native Package system and exports one default Extension factory.
- Installs the internal modules listed in `suite.json` in one explicit order.
- Targets the certified Pi 0.84.2 Host profile documented by the repository.
- Fails fast when a required module cannot initialize.
- Performs no network access, file writes, subprocess launch, or Host-settings mutation during import.
- Is private and local-only; it has no npm publication contract.

## Included modules

- [`conversation-ui`](src/conversation-ui/README.md): Statusline, Welcome, live Thought, terminal `chart`/`tree` fences, input presentation, `/ui`, and Command Dialog lifecycle.
- [`session-naming`](src/session-naming/README.md): bounded semantic Session names after settled direct-user work, resumable ownership state, and `/autoname` controls.
- [`tool-display`](src/tool-display/README.md): compact presentation for Pi built-ins and participating Suite Tools.
- [`code-mode`](src/code-mode/README.md): one provider-visible JavaScript Tool that composes active Suite Tools locally without changing Tool UI.
- [`context-management`](src/context-management/README.md): configured official Magic Context integration, the `/ctx` control center, and Pi JSONL as raw
  session authority.
- [`rtk`](src/rtk/README.md): fail-open Bash rewriting and model-only Bash/Grep output projection.
- [`codex`](src/codex/README.md): `/codex`, Fast mode, subscription usage, `apply_patch`, `view_image`, and `imagegen`.
- [`goal`](src/goal/README.md): persistent objective, continuation, accounting, and evidence-gated completion/blocking.
- [`web`](src/web/README.md): bounded search, public HTTP(S)/PDF reading, and continuation retrieval.
- [`mcp`](src/mcp/README.md): lazy proxy gateway, explicit authentication, stdio/HTTP transports, and `/mcp` status.
- [`background-work`](src/background-work/README.md): current-session Background Shell, Monitor, and `/tasks` management.
- [`subagents`](src/subagents/README.md): current-session foreground/background Agents and their shared roster.
- [`todo`](src/todo/README.md): branch-replayable Task Tools and the compact checklist above Pi's editor.
- [`btw`](src/btw/README.md): one-shot side questions using effective conversation context without changing the main transcript.
- [`notification`](src/notification/README.md): delayed terminal-native completion and failure alerts, with owned `/notifications` settings and test.

These names are internal maintenance boundaries, not npm dependencies or independently installable Packages.
Before changing absorbed or adapted source, read the nearest Module README and its adjacent `UPSTREAM.md`,
`SECURITY.md`, and third-party notices when present.

## Context controls

Use `/ctx` to open the Pi Stuff Context dialog. Its actions share one dispatcher with `/ctx flush`, `/ctx wrapup [N]`,
`/ctx recomp [start-end]`, and `/ctx upgrade`. Operation progress is stored as model-invisible Pi Stuff Activity entries;
Magic Context's own global UI remains suppressed.

## Storage

Pi Stuff keeps user configuration beside the Pi Agent directory or owning project and uses XDG directories for its
derived state, cache, and runtime files:

| Data | Location |
| --- | --- |
| Pi Host settings | `<agentDir>/settings.json` |
| Pi Stuff settings (`ui`, `tools`, `rtk`, `codex`, `notification`, `goal`, `sessionNaming`, `codeMode`, and `web`) | `<agentDir>/pi-stuff.json` |
| Shared standard MCP configuration | `$XDG_CONFIG_HOME/mcp/mcp.json` |
| Pi-specific MCP overrides | `<agentDir>/mcp.json` and `<project>/.pi/mcp.json` |
| Project Code Mode choice | `<project>/.pi/code-mode.json` |
| Pi Stuff state | `$XDG_STATE_HOME/pi-stuff` |
| Pi Stuff cache | `$XDG_CACHE_HOME/pi-stuff` |
| Ephemeral locks and Agent runtime files | `$XDG_RUNTIME_DIR/pi-stuff` |
| Session and project artifacts | Pi's Session directory or the owning project |

Only absolute XDG environment paths are accepted. Config, state, and cache fall back to `~/.config`,
`~/.local/state`, and `~/.cache`; when `XDG_RUNTIME_DIR` is unavailable, existing lock/temp fallbacks remain active.
Legacy MCP onboarding state is read from the Pi Agent directory only when the XDG state file is absent; subsequent
writes use XDG state without deleting the legacy file.

Legacy per-Capability settings files, including `web-search.json`, are migration inputs rather than current
configuration locations. Direct user configuration changes migrate their owned namespace into `pi-stuff.json`.
The upstream `pi-autoname.json` file is not read or migrated; Session Naming starts read-only from its merged namespace and writes only after direct `/autoname settings` interaction.

## Themes

The Package includes `catppuccin-latte`, `catppuccin-frappe`, `catppuccin-macchiato`, and `catppuccin-mocha`.
Select one in Pi's `/settings` theme menu or set `"theme"` to its name in `settings.json`. Pi renders truecolor when
available and performs its native lower-color fallback; the Package does not override terminal or user theme settings.

## Local installation

From the repository root:

```bash
pi install ./packages/pi-stuff
```

The Package never edits Pi settings itself.
