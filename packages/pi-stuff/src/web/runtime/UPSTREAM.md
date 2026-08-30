# Upstream provenance

This directory contains the adapted `pi-web-access` `0.18.0` source snapshot absorbed into Pi Stuff.

- Upstream repository: <https://github.com/nicobailon/pi-web-access>
- Upstream release: `v0.18.0`
- Upstream source commit: `d2aab00dcf0547572276d9de4bc4a2a49d640e13`
- npm package: `pi-web-access@0.18.0`
- npm SHA-1: `ee2d325b247b0239eab0d20b6b27eea698a42df4`
- npm integrity: `sha512-UVLWaNBHrbbe2jnpYq+uVJdPgoExz8HevkI7r3VSboZ6AT/S7oxsxpJY/a72mUt9jAy41512ndVxfxh/CIuYqg==`
- Imported fork commit: `8e11f1a41547a9415b6d36742a04e3ee2896bcea`
- Former fork tag: `pi-stuff-v0.18.0-4`
- Former release asset SHA-256: `7030811f8c4b0e75a1e5fc60f72916ebec2add2d9d615cf5a01fbde349eaa638`
- Canonical source: `jczhang02/pi-stuff`, `packages/pi-stuff/src/web/runtime`
- License: MIT

The fork identifiers prove which locally adapted snapshot was absorbed; they do not define a maintained secondary
repository or Package. This implementation keeps provider search, ordinary HTTP/image/PDF extraction, bounded GitHub
API reads, validated process-local SSRF defaults, storage, and continuation. Curator, source-check, page-answer,
repository-clone, YouTube/local-video, command, shortcut, and private Tool-rendering code has been removed. Explicit
user SSRF configuration remains authoritative. Pi Stuff also replaces the snapshot's repeated provider config parsers
with the Package-owned Web settings reader and derives dispatch, availability, labels, and safe automatic routing from
one typed provider registry. Content retrieval now runs as a Session-owned Effect operation with native timeout,
interruption, bounded stream finalization, stable three-way URL concurrency, interruptible GitHub subprocesses, and
Effect-owned PDF parsing and persistence. Standard stateless provider search, per-request timeout, selected-provider
fan-out, partial-success aggregation, and fallback also run as one Session-owned Effect operation. Provider fetches
remain narrow native adapters, while deterministic request shaping, codecs, ranking, filtering, URL, parsing, and
rendering helpers remain ordinary TypeScript; the parent Web adapter remains the sole runner and commits results only
for the current Session.
