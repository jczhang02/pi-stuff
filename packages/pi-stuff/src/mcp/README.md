# MCP

[Simplified Chinese](../../../../docs/i18n/zh-CN/packages/pi-stuff/src/mcp/README.md)

Configured MCP servers behind one searchable, bounded gateway Tool.

## Quick start

Add a project `.mcp.json`, start Pi, then open:

```text
/mcp
```

Servers connect on demand by default. The dialog manages setup, authentication, reconnection, enablement, and automatic
or on-demand lifecycle.

## Highlights

- Discovers shared, Agent, Pi, and project server declarations.
- Supports stdio, HTTP, and trusted Unix socket transports.
- Searches and invokes prefixed server Tools through one `mcp` gateway.
- Restores cached metadata before optional startup connections.
- Stores OAuth credentials in the operating-system credential store.
- Bounds metadata discovery, Tool output, raw details, and diagnostics.

## Documentation

- [MCP guide](../../../../docs/capabilities/mcp.md)
- [Command reference](../../../../docs/reference/commands.md#mcp)
- [Troubleshooting](../../../../docs/troubleshooting.md#mcp)
- [Runtime contract](runtime/README.md)
- [Upstream references](UPSTREAM.md)

