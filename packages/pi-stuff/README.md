# `@jczhang02/pi-stuff`

The single local Pi Package for the complete Pi Stuff Suite.

## Contract

- Loads through Pi's native Package system and exports one default Extension factory.
- Installs the internal modules listed in `suite.json` in one explicit order.
- Targets the certified Pi 0.84.1 Host profile documented by the repository.
- Fails fast when a required module cannot initialize.
- Performs no network access, file writes, subprocess launch, or Host-settings mutation during import.
- Is private and local-only; it has no npm publication contract.

## Included modules

- `conversation-ui`: Statusline, Welcome, live Thought, input presentation, `/ui`, and Command Dialog lifecycle.
- `tool-display`: compact presentation for Pi built-ins and participating Suite Tools.
- `context-management`: lazy official Magic Context integration with Pi JSONL as raw session authority.
- `rtk`: fail-open Bash rewriting and model-only Bash/Grep output projection.
- `codex`: `/codex`, Fast mode, subscription usage, `apply_patch`, `view_image`, and `imagegen`.
- `goal`: persistent objective, continuation, accounting, and evidence-gated completion/blocking.
- `web`: bounded search, public HTTP(S)/PDF reading, and continuation retrieval.
- `mcp`: lazy proxy gateway, explicit authentication, stdio/HTTP transports, and `/mcp` status.
- `background-work`: current-session Background Shell, Monitor, and `/tasks` management.
- `subagents`: current-session foreground/background Agents and their shared roster.
- `todo`: branch-replayable Task Tools and the compact checklist above Pi's editor.
- `btw`: one-shot side questions using effective conversation context without changing the main transcript.

These names are internal maintenance boundaries, not npm dependencies or independently installable Packages.

## Local installation

From the repository root:

```bash
pi install ./packages/pi-stuff
```

The Package never edits Pi settings itself.
