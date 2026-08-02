# `@jczhang02/pi-stuff-agents`

Current-session foreground and background Agents for Pi Stuff.

The Capability lets the main Pi Agent delegate isolated work, continue while background work runs, and receive compact
results without flooding the main conversation. It keeps one quiet roster below the editor and opens details in Pi
Stuff's shared full-width Command Dialog.

## Everyday behavior

- Delegation runs in the background unless the main Agent needs the result before it can continue.
- Independent tasks may run concurrently. The session-wide defaults are 20 running Agents, 200 total launches, and a
  maximum nesting depth of three.
- Each Agent has a stable identity, its own transcript, acknowledged steering, independent stop, and safe resume when
  its terminal state permits it.
- The main conversation receives only a compact result from each direct child. Nested work remains available in the
  Agent detail view.
- Destructive-command approval is inherited from `@jczhang02/pi-stuff-permissions` and routed to the root session.
- Per-Agent Git worktree isolation is optional. Changed or uncertain worktrees are preserved; only clean worktrees may
  be removed automatically.

With an empty editor, press Down to enter the roster, use Up or Down to select an Agent, and press Enter to inspect it.
The `/agents` command opens the same current-session view. The Capability creates no statusline or floating window.

## Scope

This Package owns ordinary subagents inside the current Pi session. It does not provide a cross-session Fleet or
Agent Teams, saved chains, scheduled work, a workflow language, memory, sharing, a private settings surface, a
statusline, watchdog review, LSP integration, or another TUI shell.

Pi Stuff owns this fork. See [UPSTREAM.md](./UPSTREAM.md) for the exact source and archive identities.
