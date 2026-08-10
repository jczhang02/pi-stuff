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
