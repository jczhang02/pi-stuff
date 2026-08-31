# MCP

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/mcp.md)

MCP discovers configured servers and exposes their Tools through one bounded gateway.

## Quick start

Add a project `.mcp.json`:

```json
{
  "mcpServers": {
    "demo": {
      "command": "node",
      "args": ["./demo-server.mjs"]
    }
  }
}
```

Start Pi and open:

```text
/mcp
```

Servers connect on demand by default. The dialog lists discovered servers and opens connection, authentication,
lifecycle, enablement, and setup actions.

## Gateway Tool

The `mcp` Tool lists and searches cached server Tools, describes a Tool schema, connects a server, and invokes a
returned prefixed Tool name.

```json
{ "search": "read file", "limit": 10 }
{ "connect": "demo" }
{ "describe": "demo__read_file" }
{ "tool": "demo__read_file", "args": { "path": "README.md" } }
```

Use `server` to list or filter one server. Search accepts offsets, a result limit up to 20, and optional parameter
schemas. Tool arguments may be an object or a JSON string up to 64 KiB.

## Configuration

Pi Stuff reads shared, Agent, Pi, and project MCP sources. The main project files are:

- `.mcp.json` for shared project declarations;
- `.pi/mcp.json` for Pi-specific project overrides.

Higher-precedence definitions replace lower-precedence definitions by server name. A server declares exactly one
transport:

| Field | Transport |
| --- | --- |
| `command` | stdio process |
| `url` | HTTP or Streamable HTTP |
| `socket` | trusted Unix socket |

Server entries can also set lifecycle, disabled state, Tool and resource filters, approval, authentication, debug, and
trace options.

Changing a server URL removes inherited URL-bound headers, bearer values, and OAuth state so credentials cannot follow
an endpoint change.

## Commands

| Command | Action |
| --- | --- |
| `/mcp` or `/mcp status` | Open server status |
| `/mcp setup` | Review imports, presets, or starter configuration before writing |
| `/mcp auth <server>` | Authenticate an eligible server |
| `/mcp reconnect <server>` | Reconnect and refresh metadata |
| `/mcp logout <server>` | Remove authentication |
| `/mcp disable <server>` | Disable through the project override |
| `/mcp enable <server>` | Enable through the project override |
| `/mcp auto-connect <server>` | Store `keep-alive` lifecycle |
| `/mcp on-demand <server>` | Store `lazy` lifecycle |

Setup and persistent changes write only after interactive confirmation and reload Pi when required. Opening the bare
dialog performs no connection and writes no configuration.

## Connection lifecycle

`lazy` is the default. A gateway call connects the requested server when metadata is missing, can start an eligible
authentication flow, refreshes metadata, and retries the operation. Failed servers use reconnect backoff without
blocking other servers or ordinary Pi work.

`keep-alive` and `eager` servers may connect at startup after cached metadata is restored.

Tool and Resource metadata is bounded to 100 pages or 10,000 entries for each list. Change notifications use the same
ceiling.

## Authentication

HTTP servers support bearer and OAuth authentication. `/mcp auth <server>` shows the callback URL and completes a local
callback automatically when possible.

OAuth credentials are stored in the operating-system credential store. If secure storage is unavailable, OAuth fails
closed. Legacy plaintext credentials are read but move to secure storage only after an explicit OAuth write.

`!command` secrets execute only at connection or authentication time with no stdin or stderr, a 10-second timeout, and
a 1 MiB stdout cap.

## Output and diagnostics

Text results are bounded to 50 KiB or 2,000 lines by default. Oversized text and raw details above 16 KiB spill to
mode-`0600` temporary files; image blocks remain on Pi's native image path. Spill files may contain sensitive server
output and require user-managed cleanup.

Status snapshots omit server URLs, commands, arguments, environment values, OAuth data, and tokens. Diagnostics keep
bounded stdio stderr tails and sanitized HTTP failure classification.

## See also

- [MCP Module README](../../packages/pi-stuff/src/mcp/README.md)
- [Command reference](../reference/commands.md#mcp)
- [Troubleshooting](../troubleshooting.md#mcp)
- [Runtime contract](../../packages/pi-stuff/src/mcp/runtime/README.md)

