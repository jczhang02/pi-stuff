# Upstream provenance

This directory is the internal Pi Stuff fork of `pi-web-access` `0.18.0`.

- Upstream repository: <https://github.com/nicobailon/pi-web-access>
- Upstream release: `v0.18.0`
- Upstream source commit: `d2aab00dcf0547572276d9de4bc4a2a49d640e13`
- npm package: `pi-web-access@0.18.0`
- npm SHA-1: `ee2d325b247b0239eab0d20b6b27eea698a42df4`
- npm integrity: `sha512-UVLWaNBHrbbe2jnpYq+uVJdPgoExz8HevkI7r3VSboZ6AT/S7oxsxpJY/a72mUt9jAy41512ndVxfxh/CIuYqg==`
- Imported fork commit: `8e11f1a41547a9415b6d36742a04e3ee2896bcea`
- Former fork tag: `pi-stuff-v0.18.0-4`
- Former release asset SHA-256: `7030811f8c4b0e75a1e5fc60f72916ebec2add2d9d615cf5a01fbde349eaa638`
- Canonical source: `jczhang02/pi-stuff`, `packages/pi-web-access`
- License: MIT

The internal `pi-stuff-suite` snapshot owns distribution identity and dependency
determinism. It also exposes a narrow embedding factory so Pi Stuff can keep
GitHub reads API/HTTP-only and bypass YouTube-specific browser, Gemini, and
video paths. It exposes validated process-local SSRF defaults so Pi Stuff can
adapt to a detected TUN fake-IP resolver without mutating user configuration;
explicit configuration still wins. Default installation preserves upstream
behavior. Pi Stuff owns the product-facing adapter that selects the bounded
search and document-reading surface, performs proxy detection, disables browser
curation, and supplies the shared Tool presentation.
