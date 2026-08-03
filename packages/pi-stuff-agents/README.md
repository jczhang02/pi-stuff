# `@jczhang02/pi-stuff-agents`

Current-session foreground and background Agents for Pi Stuff.

The Capability lets the main Pi Agent delegate isolated work, continue while background work runs, and receive compact
results without flooding the main conversation. It keeps one quiet roster below the editor and opens details in Pi
Stuff's shared full-width Command Dialog.

The public `subagent` tool adopts `@jczhang02/pi-stuff-tools` so its running and terminal row follows the same compact
grammar as Host tools. Full Agent inspection and control remains in `/agents`.

## Everyday behavior

- Delegation runs in the background unless the main Agent needs the result before it can continue.
- Independent tasks may run concurrently. The session-wide defaults are 20 running Agents, 200 total launches, and a
  maximum nesting depth of three.
- Each Agent has a stable identity, its own transcript, acknowledged steering, independent stop, and safe resume when
  its terminal state permits it.
- Child Agents automatically reuse the exact standalone Pi Host that launched the session; no separate child-binary
  setting is required.
- The main conversation receives only a compact result from each direct child. Nested work remains available in the
  Agent detail view.
- The Agent detail transcript associates each child Tool call with its persisted call identity and renders a compact
  `● Tool … · outcome` row beside that Tool's bounded result. Mixed or out-of-order results remain attributable;
  identity-free legacy records are paired only when ownership is unambiguous.
- A background Agent completion asks the UI Capability to refresh its bounded Git snapshot. The Agents Capability does
  not render or own the Statusline.
- Destructive-command approval is inherited from `@jczhang02/pi-stuff-permissions` and routed to the root session.
- Per-Agent Git worktree isolation is optional. Changed or uncertain worktrees are preserved; only clean worktrees may
  be removed automatically.

With an empty editor, press Down to enter the roster, use Up or Down to select an Agent, and press Enter to inspect it.
The `/agents` command opens the same current-session view. The Capability creates no statusline or floating window.

The Agent Command Dialog uses the Suite's divider and two-cell gutter, with `›` marking the focused custom row.
Action hints wrap instead of dropping the close or back key: Escape closes the Agent list and returns one level from
details or a steer/resume composer.

## Scope

This Package owns ordinary subagents inside the current Pi session. It does not provide a cross-session Fleet or
Agent Teams, saved chains, scheduled work, a workflow language, memory, sharing, a private settings surface, a
statusline, watchdog review, LSP integration, or another TUI shell.

Pi Stuff owns this fork. See [UPSTREAM.md](./UPSTREAM.md) for the exact source and archive identities.
