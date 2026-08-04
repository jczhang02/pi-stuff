# Changelog

## 0.2.3

### Patch Changes

- Updated dependencies [bd6ae2d]
  - @jczhang02/pi-stuff-ui@0.2.3
  - @jczhang02/pi-stuff-tools@0.1.4

## 0.2.2

### Patch Changes

- Updated dependencies
  - @jczhang02/pi-stuff-tools@0.1.3
  - @jczhang02/pi-stuff-ui@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [e44dfe7]
  - @jczhang02/pi-stuff-tools@0.1.2
  - @jczhang02/pi-stuff-ui@0.2.1

## 0.2.0

### Minor Changes

- 14396c9: Add bounded Web reading/search and a lazy proxy-only MCP gateway to the default Suite, including shared Tool rendering, non-floating status UI, owned immutable forks, and real Pi 0.83 transport verification.

### Patch Changes

- Updated dependencies [563d427]
- Updated dependencies [14396c9]
- Updated dependencies [dcc49da]
- Updated dependencies [60ba544]
- Updated dependencies [f7037f1]
  - @jczhang02/pi-stuff-ui@0.2.0
  - @jczhang02/pi-stuff-tools@0.1.1

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
