# MCP Runtime

[Simplified Chinese](../../../../../docs/i18n/zh-CN/packages/pi-stuff/src/mcp/runtime/README.md)

Configuration, transport, authentication, lifecycle, discovery, and output handling behind the Pi Stuff MCP gateway.

## Quick start

Use the parent [MCP guide](../../../../../docs/capabilities/mcp.md) and `/mcp` surface. The runtime activates for
configured servers as their lifecycle or gateway use requires.

## Highlights

- Merges bounded global and project configuration with conflict reporting.
- Runs stdio, HTTP, and trusted shared-socket transports.
- Resolves `!command` secrets only at connection or authentication time.
- Requires operating-system credential storage for OAuth.
- Bounds Tool and Resource discovery to 100 pages or 10,000 entries each.
- Validates advertised `structuredContent` schemas before returning results.
- Replaces stale runtime ownership and performs bounded transport cleanup.

## Documentation

- [MCP guide](../../../../../docs/capabilities/mcp.md)
- [MCP Module README](../README.md)
- [Upstream references](UPSTREAM.md)

