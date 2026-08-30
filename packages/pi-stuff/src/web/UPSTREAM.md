# Upstream provenance

Pi Stuff Web owns the product surface around an adapted `nicobailon/pi-web-access` source snapshot absorbed into
`packages/pi-stuff/src/web/runtime`.

- Original release: `0.18.0`
- Original source commit: `d2aab00dcf0547572276d9de4bc4a2a49d640e13`
- Original npm SHA-1: `ee2d325b247b0239eab0d20b6b27eea698a42df4`
- Original npm integrity: `sha512-UVLWaNBHrbbe2jnpYq+uVJdPgoExz8HevkI7r3VSboZ6AT/S7oxsxpJY/a72mUt9jAy41512ndVxfxh/CIuYqg==`
- Former fork repository: `jczhang02/pi-web-access`
- Absorbed fork commit: `8e11f1a41547a9415b6d36742a04e3ee2896bcea`
- Former fork tag: `pi-stuff-v0.18.0-4`
- Former release asset SHA-256: `7030811f8c4b0e75a1e5fc60f72916ebec2add2d9d615cf5a01fbde349eaa638`
- Canonical Pi Stuff source: `packages/pi-stuff/src/web/runtime`
- License: MIT

The former fork identity is retained only to prove the exact imported bytes. There is no second repository, Package,
or release lifecycle to maintain.

## Pi Stuff delta

- Exposes only search, HTTP(S)/PDF reading, and bounded continuation retrieval.
- Forces non-browser search and disables background full-page fan-out.
- Uses bounded GitHub API reads instead of repository cloning and removes YouTube/local-video specialization.
- Rejects non-HTTP(S), credential-bearing, and malformed URLs before extraction; the absorbed DNS/IP SSRF guard remains
  authoritative afterward.
- Detects system TUN fake-IP DNS only when a fetch begins and supplies a process-local default without writing settings.
- Runs retained providers as one Session-owned Effect operation while keeping fetches, credentials, browser cookies,
  uploads, and subprocess protocols in narrow provider-owned native adapters.
- Removes the upstream curator, source-check, page-answer, command, shortcut, and private Tool-rendering surfaces; the
  parent module owns the three retained Tools and their shared Suite presentation.
