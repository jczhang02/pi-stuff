# Upstream provenance

Pi Stuff Web is an adapter around an immutable release of the owned fork
`jczhang02/pi-web-access`.

- Original upstream: `nicobailon/pi-web-access`
- Original release: `0.18.0`
- Original source commit: `d2aab00dcf0547572276d9de4bc4a2a49d640e13`
- Original npm SHA-1: `ee2d325b247b0239eab0d20b6b27eea698a42df4`
- Original npm integrity: `sha512-UVLWaNBHrbbe2jnpYq+uVJdPgoExz8HevkI7r3VSboZ6AT/S7oxsxpJY/a72mUt9jAy41512ndVxfxh/CIuYqg==`
- Owned fork repository: `jczhang02/pi-web-access`
- Owned fork commit: `8e11f1a41547a9415b6d36742a04e3ee2896bcea`
- Owned fork tag: `pi-stuff-v0.18.0-4`
- Release asset SHA-256: `7030811f8c4b0e75a1e5fc60f72916ebec2add2d9d615cf5a01fbde349eaa638`
- License: MIT

## Pi Stuff delta

- Exposes only search, HTTP(S)/PDF reading, and bounded continuation retrieval.
- Forces non-browser search and disables background full-page fan-out.
- Uses the fork's embedding policy to prevent repository cloning and
  YouTube-specific browser, Gemini, and video extraction.
- Rejects non-HTTP(S), credential-bearing, and malformed URLs before upstream
  extraction; the fork's DNS/IP SSRF guard remains authoritative afterward.
- Detects system TUN fake-IP DNS only when a fetch begins, using both the
  requested hostname and a public canary. It enables the fork's process-local
  default without writing settings; explicit user SSRF configuration still
  wins, and literal IP URLs never cross the Suite boundary.
- Replaces every upstream Tool renderer with the Suite renderer and drops all
  upstream commands and shortcuts.
