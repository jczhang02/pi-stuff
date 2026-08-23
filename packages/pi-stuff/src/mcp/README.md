# Pi Stuff MCP

Pi Stuff MCP reads standard MCP declarations such as project `.mcp.json` and
exposes one `mcp` gateway Tool. Servers connect on demand by default; a user may
persist automatic connection for an individual server. A failing optional
server does not prevent Pi or another server from working.

`/mcp` opens Pi Stuff's full-width non-floating server control dialog. Opening
it never connects to a server or writes configuration. Select a server with the
arrow keys and press Enter to see its available actions. Operational
subcommands such as `/mcp reconnect <server>` remain available for experienced
users.

The absorbed runtime omits direct per-server Tools, JavaScript batching, MCP
prompt discovery, MCP Apps browser/native windows, floating panels, and bundled Skills. The shared
Tool renderer keeps the transcript compact; the fork guards large MCP output
before it reaches model context. Discovery uses ranked literal terms; regex
search and its heavyweight execution backends are intentionally omitted.
Server-initiated sampling and elicitation are omitted, so MCP callbacks
cannot open native prompts behind the shared Command Dialog contract.

## Accepted `/mcp` control target

**Decision update:** 2026-08-20
**Status:** Implemented.

Bare `/mcp` is the default interactive route for status, setup, authentication,
reconnection, and enable/disable operations. It does not duplicate Tool
discovery or protocol inspection. The retained MCP runtime remains the sole
owner of connection, OAuth, setup, configuration, and reload behavior.

The server name is each row's primary identity. Use a real state icon plus the full state word:

```text
MCP · 1/4 connected · 14 tools · 3 resources

› ✓ filesystem · connected · 8 tools · 1 resource
  ! github · needs auth
  × browser · failed 12s ago
  ■ legacy · disabled
  ○ docs · cached · 6 tools · 2 resources

↑/↓ navigate · Enter manage · s setup · ? keys · Esc close
```

Use `✓` connected, `○` cached or not connected, `×` failed, `!` needs auth,
and `■` disabled. Keep the state word because cached, not connected, and
disabled are materially different even when a compact icon category is shared.
The connection denominator counts enabled servers; disabled rows remain visible
but are not expected to connect.

Rows stay in declaration order and update in place. Enter opens a focused action
list for the selected server. Reconnect, authenticate, and logout run inline;
recent failures show one bounded, redacted reason. `Ctrl+R` reconnects and
`Ctrl+A` authenticates the selected server directly.

The detail view shows whether connection is `automatic` or `on demand`.
Changing that policy requires confirmation, persists only the server's
`lifecycle` field in project-local `.pi/mcp.json`, and reloads Pi. Automatic
uses MCP's `keep-alive` lifecycle; on demand uses `lazy`.

Logout and enable/disable require a confirmation. Enable/disable writes
`.pi/mcp.json` through the retained runtime and reloads Pi after success. The
default confirmation choice is Cancel.

Pi's configured Up and Down actions move one row; Ctrl+P/Ctrl+N are aliases.
PageUp/PageDown and `b`/Space move one visible page only when the list
overflows, while Home/End jump to the first or last row. `?` opens the shared
key guide. Escape goes back from details or closes the server list.

Space never performs a persistent operation. In setup it may toggle an import's
temporary selection; Enter reviews the exact target and diff, and a second
confirmation performs the write. Press `s` from the server list, or Enter on an
empty list, to open setup inside the same Command Dialog. OAuth authentication
and logout are available from each eligible server's detail actions.

Setup uses the same continuous full-width top rule, two-cell content gutter,
bold Header, `◆` section headings, bounded list windows, and separate Escape
route as the other Suite Command Dialogs. Narrow layouts omit optional previews;
low-height layouts retain the Header, current choice, confirmation detail, and
way back before secondary discovery text.

The status snapshot excludes server URLs, executable commands, arguments,
environment values, OAuth data, and tokens. It adds only OAuth capability,
automatic-connection policy, and one sanitized, redacted, length-bounded recent
failure reason.
