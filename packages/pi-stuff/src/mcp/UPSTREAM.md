# Upstream provenance

Pi Stuff MCP owns the product surface around an adapted `nicobailon/pi-mcp-adapter` source snapshot absorbed into
`packages/pi-stuff/src/mcp/runtime`.

- Original release: `2.19.0`
- Original source commit: `cde58793327b15d65f86e59ec9025d649cb8c300`
- Original npm SHA-1: `44fe4388436b507b3abfc073e34f82d5d7b8ff37`
- Original npm integrity: `sha512-2FwyuQKFWJP9kO8nl83fAEl+d10MxENqw7TvMcINlJn0yLVCHb5WevN06jpKo19GBi7BBkD6Ri7Sq2rJyiYZiQ==`
- Former fork repository: `jczhang02/pi-mcp-adapter`
- Absorbed fork commit: `2333b79429ea28f6a7d24ca7ad7a169e07b7cf7d`
- Former fork tag: `pi-stuff-v2.19.0-7`
- Former release asset SHA-256: `b0fbbcdcca56c28c49884b69002f1519504ab538afd1abf86e00247aeb441478`
- Canonical Pi Stuff source: `packages/pi-stuff/src/mcp/runtime`
- License: MIT

The former fork identity is retained only to prove the exact imported bytes. There is no second repository, Package,
or release lifecycle to maintain.

## Pi Stuff delta

- Uses pure-lazy, non-interactive, proxy-only embedding controls with MCP sampling and elicitation disabled.
- Exposes one bounded Tool with literal ranked discovery and omits regex, direct, script, prompt-command, and MCP Apps
  surfaces.
- Replaces floating status/setup/auth panels with the shared Command Dialog and explicit `.mcp.json` guidance.
- Makes `/mcp` the sole persistent MCP status authority and suppresses the absorbed footer.
- Closes Streamable HTTP probes and live sessions before their SDK clients.
- Declares Zod once in the single Package dependency set.
