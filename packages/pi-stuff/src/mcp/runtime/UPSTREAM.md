# Upstream provenance

This directory contains the adapted `pi-mcp-adapter` `2.19.0` source snapshot absorbed into Pi Stuff.

- Upstream repository: <https://github.com/nicobailon/pi-mcp-adapter>
- Upstream release: `v2.19.0`
- Upstream source commit: `cde58793327b15d65f86e59ec9025d649cb8c300`
- npm package: `pi-mcp-adapter@2.19.0`
- npm SHA-1: `44fe4388436b507b3abfc073e34f82d5d7b8ff37`
- npm integrity: `sha512-2FwyuQKFWJP9kO8nl83fAEl+d10MxENqw7TvMcINlJn0yLVCHb5WevN06jpKo19GBi7BBkD6Ri7Sq2rJyiYZiQ==`
- Imported fork commit: `2333b79429ea28f6a7d24ca7ad7a169e07b7cf7d`
- Former fork tag: `pi-stuff-v2.19.0-7`
- Former release asset SHA-256: `b0fbbcdcca56c28c49884b69002f1519504ab538afd1abf86e00247aeb441478`
- Canonical source: `jczhang02/pi-stuff`, `packages/pi-stuff/src/mcp/runtime`
- License: MIT

The fork identifiers prove which locally adapted snapshot was absorbed; they do not define a maintained secondary
repository or Package. The retained runtime contains dormant MCP Apps support behind an explicit opt-in, but Pi Stuff
does not expose or enable it. This implementation also adds optional startup deferral, a proxy-only Tool surface, and
reduced discovery while retaining transport, cancellation, reconnection, OAuth, output guarding, and lifecycle
behavior.
