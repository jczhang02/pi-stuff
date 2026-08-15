# Third-party notices

The TypeScript Code Mode host integration is derived from `@howaboua/pi-codex-conversion` at
`b3591d996efbf6df293e426dea2bb2dd17fcbfe6`, copyright © 2026 Igor Warzocha and licensed under MIT. The preserved
notice is in `LICENSE`.

The lazily downloaded `codex-code-mode-host` executable is distributed by OpenAI as part of Codex release
`rust-v0.145.0`. OpenAI Codex is licensed under Apache-2.0; the license text is included at
`LICENSES/Apache-2.0.txt`. Pi Stuff pins each platform asset by SHA-256 and does not redistribute the binary in the
npm package.

The runtime-neutral source normalization, connector search/describe, name sanitation, schema-to-TypeScript, snippet,
binary/BigInt codec, and deterministic replay serialization files under `cloudflare/` are derived from
`@cloudflare/codemode` `0.5.1` at commit
`f089c5b6a13f98ad728f9c9cb9d729469b945233`, copyright © 2025 Cloudflare, Inc. and licensed under MIT. The preserved
notice is in `LICENSES/Cloudflare-MIT.txt`. Pi Stuff does not import Cloudflare's Workers-only executor or Durable
Object runtime.
