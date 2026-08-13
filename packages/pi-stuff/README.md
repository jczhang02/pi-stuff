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

- `conversation-ui`: Statusline, Welcome, live Thought, input presentation, `/ui`, and Command Dialog lifecycle.
- `tool-display`: compact presentation for Pi built-ins and participating Suite Tools.
- `code-mode`: one provider-visible JavaScript Tool that composes active Suite Tools locally without changing Tool UI.
- `context-management`: configured official Magic Context integration, the `/ctx` control center, and Pi JSONL as raw
  session authority.
- `rtk`: fail-open Bash rewriting and model-only Bash/Grep output projection.
- `codex`: `/codex`, Fast mode, subscription usage, `apply_patch`, `view_image`, and `imagegen`.
- `goal`: persistent objective, continuation, accounting, and evidence-gated completion/blocking.
- `web`: bounded search, public HTTP(S)/PDF reading, and continuation retrieval.
- `mcp`: lazy proxy gateway, explicit authentication, stdio/HTTP transports, and `/mcp` status.
- `background-work`: current-session Background Shell, Monitor, and `/tasks` management.
- `subagents`: current-session foreground/background Agents and their shared roster.
- `todo`: branch-replayable Task Tools and the compact checklist above Pi's editor.
- `btw`: one-shot side questions using effective conversation context without changing the main transcript.
- `notification`: delayed terminal-native completion and failure alerts, with owned `/notifications` settings and test.

These names are internal maintenance boundaries, not npm dependencies or independently installable Packages.

## Context controls

Use `/ctx` to open the Pi Stuff Context dialog. Its actions share one dispatcher with `/ctx flush`, `/ctx wrapup [N]`,
`/ctx recomp [start-end]`, and `/ctx upgrade`. Operation progress is stored as model-invisible Pi Stuff Activity entries;
Magic Context's own global UI remains suppressed.

## Storage

Pi Stuff follows the Host for Pi-owned configuration and uses XDG directories only for data it owns:

| Data | Location |
| --- | --- |
| Pi-owned configuration (`settings.json`, `mcp.json`, `web-search.json`, UI, Goal, and Notification settings) | Pi `getAgentDir()` / `PI_CODING_AGENT_DIR` |
| Shared standard MCP configuration | `$XDG_CONFIG_HOME/mcp/mcp.json` |
| Pi Stuff state | `$XDG_STATE_HOME/pi-stuff` |
| Pi Stuff cache | `$XDG_CACHE_HOME/pi-stuff` |
| Ephemeral locks and Agent runtime files | `$XDG_RUNTIME_DIR/pi-stuff` |
| Session and project artifacts | Pi's Session directory or the owning project |

Only absolute XDG environment paths are accepted. Config, state, and cache fall back to `~/.config`,
`~/.local/state`, and `~/.cache`; when `XDG_RUNTIME_DIR` is unavailable, existing lock/temp fallbacks remain active.
Legacy MCP onboarding state is read from the Pi Agent directory only when the XDG state file is absent; subsequent
writes use XDG state without deleting the legacy file.

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
