# Upstream provenance

This directory is the internal Pi Stuff fork of `pi-mcp-adapter` `2.19.0`.

- Upstream repository: <https://github.com/nicobailon/pi-mcp-adapter>
- Upstream release: `v2.19.0`
- Upstream source commit: `cde58793327b15d65f86e59ec9025d649cb8c300`
- npm package: `pi-mcp-adapter@2.19.0`
- npm SHA-1: `44fe4388436b507b3abfc073e34f82d5d7b8ff37`
- npm integrity: `sha512-2FwyuQKFWJP9kO8nl83fAEl+d10MxENqw7TvMcINlJn0yLVCHb5WevN06jpKo19GBi7BBkD6Ri7Sq2rJyiYZiQ==`
- Imported fork commit: `2333b79429ea28f6a7d24ca7ad7a169e07b7cf7d`
- Former fork tag: `pi-stuff-v2.19.0-7`
- Former release asset SHA-256: `b0fbbcdcca56c28c49884b69002f1519504ab538afd1abf86e00247aeb441478`
- Canonical source: `jczhang02/pi-stuff`, `packages/pi-mcp-adapter`
- License: MIT

The internal `pi-stuff-suite` snapshot adds narrow embedding controls: optional startup
connection deferral, explicit MCP Apps UI opt-in, and a proxy-only Tool
surface. It also omits regex discovery and its heavyweight execution backends.
Pi Stuff uses these changes to keep startup pure, prevent browser/native
floating windows, and expose one bounded gateway while retaining the upstream
transport, discovery, cancellation, reconnection, OAuth, output-guard, and
lifecycle implementation.
