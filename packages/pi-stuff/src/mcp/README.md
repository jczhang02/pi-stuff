# Pi Stuff MCP

Pi Stuff MCP reads standard MCP declarations such as project `.mcp.json` and
exposes one `mcp` gateway Tool. Servers stay disconnected until the agent asks
to connect, search, describe, or invoke a Tool. A failing optional server does
not prevent Pi or another server from working.

`/mcp` opens Pi Stuff's full-width non-floating status dialog. Operational
subcommands such as `/mcp reconnect <server>`, `/mcp disable <server>`, and
`/mcp enable <server>` remain available. Add or edit declarations directly in
`.mcp.json`, then run `/reload`. OAuth is started only by explicit
`/mcp-auth <server>` use.

The package never exposes direct per-server Tools, JavaScript batching, MCP
Apps browser/native windows, floating panels, or bundled Skills. The shared
Tool renderer keeps the transcript compact; the fork guards large MCP output
before it reaches model context. Discovery uses ranked literal terms; regex
search and its heavyweight execution backends are intentionally omitted.
Server-initiated sampling and elicitation are not advertised, so MCP callbacks
cannot open native prompts behind the shared Command Dialog contract.

## Accepted `/mcp` readability target

**Decision update:** 2026-08-17
**Status:** Implemented on 2026-08-18.

Bare `/mcp` remains a read-only server status overview. It does not add a selectable detail mode or duplicate setup,
OAuth, Tool discovery, or protocol inspection. Operational subcommands, `/mcp-auth`, `.mcp.json`, `/reload`, and the
single gateway Tool retain their existing authority.

The server name is each row's primary identity. Use a real state icon plus the full state word:

```text
MCP · 2/3 connected · 14 tools · 3 resources

✓ filesystem · connected          8 tools · 1 resource
! github · needs auth             run /mcp-auth github
× browser · failed 12s ago        run /mcp reconnect browser
■ legacy · disabled
○ docs · cached                    6 tools · 2 resources

PgUp/PgDn page · ? keys · Esc close · configure in .mcp.json
```

Use `✓` connected, `○` cached or not connected, `×` failed, `!` needs auth, and `■` disabled. Initial loading uses
`● initializing`. Keep the state word because cached, not connected, and disabled are materially different even when a
compact icon category is shared.

Rows stay in `.mcp.json` declaration order and update in place; a connection change must not reorder the server list.
For `needs auth`, show the explicit `/mcp-auth <server>` next step. For a recent failure, show
`/mcp reconnect <server>`. Actions are guidance text, not inline controls. Disabled and ordinary lazy-disconnected
servers need no warning action.

Show per-server and aggregate resource counts when reported, in addition to Tool counts. At narrow widths preserve
state icon, server name, and state word; then preserve the actionable command for auth or failure before capability
counts. Omit zero or unavailable capability counts rather than adding placeholders.

Pi's configured Up and Down actions scroll one line; Ctrl+P/Ctrl+N are read-only aliases. PageUp/PageDown and
`b`/Space scroll one visible page only when the list overflows, while Home/End jump to the top or bottom. Keep the
configuration hint, `?` help, and Escape path. Enter and Space do not close the status surface. An empty page says
`No MCP servers configured.` followed by `Add .mcp.json, then run /reload.`

The status snapshot and Dialog continue to exclude server URLs, executable commands, arguments, environment values,
OAuth data, tokens, detailed failure messages, and other configuration secrets. Detailed operational failures belong
in bounded `/diagnostics`; Tool call protocol belongs in `/tools`.

The implementation now uses distinct state icons, includes resource counts, shows status-specific next steps, provides
the two-line empty state, and routes Pi's configured page actions plus `b`/Space through one paging path. Focused tests cover live
updates, declaration order, narrow fitting, empty state, sensitive-data exclusion, and page aliases; the real PTY
verifier covers Host rendering.
