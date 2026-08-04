# Upstream provenance

Pi Stuff MCP is an adapter around an immutable release of the owned fork
`jczhang02/pi-mcp-adapter`.

- Original upstream: `nicobailon/pi-mcp-adapter`
- Original release: `2.19.0`
- Original source commit: `cde58793327b15d65f86e59ec9025d649cb8c300`
- Original npm SHA-1: `44fe4388436b507b3abfc073e34f82d5d7b8ff37`
- Original npm integrity: `sha512-2FwyuQKFWJP9kO8nl83fAEl+d10MxENqw7TvMcINlJn0yLVCHb5WevN06jpKo19GBi7BBkD6Ri7Sq2rJyiYZiQ==`
- Owned fork repository: `jczhang02/pi-mcp-adapter`
- Owned fork commit: `2333b79429ea28f6a7d24ca7ad7a169e07b7cf7d`
- Owned fork tag: `pi-stuff-v2.19.0-7`
- Release asset SHA-256: `b0fbbcdcca56c28c49884b69002f1519504ab538afd1abf86e00247aeb441478`
- License: MIT

## Pi Stuff delta

- Uses fork-level pure-lazy, non-interactive, proxy-only embedding controls,
  including disabled MCP sampling and elicitation prompts.
- Exposes one bounded Tool with literal ranked discovery and drops regex,
  direct, script, prompt-command, and MCP Apps surfaces.
- Replaces floating status/setup/auth panels with a shared Command Dialog and
  explicit text guidance for standard `.mcp.json` declarations.
- Suppresses the fork footer; `/mcp` is the sole authority for persistent MCP
  connection status.
- Terminates Streamable HTTP probe and live sessions before closing their SDK
  clients.
- Removes the redundant Zod peer declaration from the self-contained fork so
  Bun 1.3.14 emits one valid nested lock entry.
