# Changelog

## 0.1.0 - 2026-08-04

- Added one lazy MCP gateway Tool backed by the owned adapter fork.
- Added local stdio and remote HTTP transport support, bounded search and
  invocation results, OAuth-by-explicit-command, and per-server failure
  isolation.
- Added compact shared Tool rows and a non-floating `/mcp` status dialog.
- Suppressed the upstream footer so MCP state has one visible authority and
  never adds a Capability-specific Statusline segment.
- Removed direct/script Tools, MCP Apps windows, setup panels, and floating
  upstream status/auth panels from the Suite surface.
- Disabled server-initiated sampling/elicitation prompts, dropped undeclared
  gateway parameters, and sanitized server names before terminal rendering.
