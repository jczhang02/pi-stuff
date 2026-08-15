# Upstream provenance

Pi Stuff Code Mode is an owned in-monorepo fork derived from the Code Mode implementation in
`@howaboua/pi-codex-conversion`.

- Upstream repository: `https://github.com/IgorWarzocha/howaboua-pi-stuff`
- Upstream package directory: `packages/pi-codex-conversion/src/tools/code-mode`
- Audited upstream commit: `b3591d996efbf6df293e426dea2bb2dd17fcbfe6`
- Upstream license: MIT; its copyright notice is preserved in `LICENSE`.
- Interface reference: Cloudflare Code Mode, `https://blog.cloudflare.com/code-mode/`
- V8 host: OpenAI Codex release `rust-v0.145.0`, `https://github.com/openai/codex`
- V8 host license: Apache-2.0; the license text is included under `LICENSES/Apache-2.0.txt`.
- Cloudflare compatibility source: `@cloudflare/codemode` `0.5.1`, tag commit
  `f089c5b6a13f98ad728f9c9cb9d729469b945233`, npm SHA-1
  `9f9386ce676f77e7e651731103e8bd090a04c8f8`, npm integrity
  `sha512-PcX5+qAvupi8p1bMLKhqvPHziZpDubbrxDIvVH+iuuNUaFyOxxWNS9HplfFqIULqUzDPdFf1w7IiSCKHp7GDgg==`.
- Cloudflare license: MIT; its notice is preserved in `LICENSES/Cloudflare-MIT.txt`.

## Pi Stuff delta

- Make Code Mode Suite-wide and model/provider agnostic rather than replacing an OpenAI transport.
- Present one ordinary Pi function Tool, `codemode({ code })`; no provider payload rewriting and no model-name
  compatibility table.
- Project every active Pi Stuff Package-owned Tool into the local V8 Connector. Separately installed third-party Tools
  stay direct because the Package does not own their private invocation path.
- Keep programmatic Tool schemas, search, and descriptions local to V8. The provider receives the small execute/search
  pair plus any unowned third-party Tools; there is no per-Tool caller-routing policy.
- Auto-wait yielded cells inside the Tool so no provider-facing `wait` schema or stranded continuation is required.
- Re-enter the original Tool preparation, validation, Package-owned lifecycle/result hooks, dynamic Tool activation,
  termination, cancellation, and usage accounting for nested calls without binding to Pi private dispatch APIs.
- Render the original Pi Stuff Tool components directly and keep the Code Mode envelope visually silent. Persist
  nested traces in normal session details so live execution and reload share one projection.
- Install the pinned official host lazily with proxy support, cancellation, checksum verification, an inter-process
  lock, and atomic staging. No native binary is copied into this repository.
- Exclude upstream provider replacement, Responses Lite transport, model gating, custom PATH/TOML Tools, native
  compaction, prompt replacement, voice, background-shell UI, and Code Mode-specific visual chrome.
- Reuse Cloudflare's runtime-neutral source normalization, connector search/describe, name sanitation,
  schema-to-TypeScript conversion, snippets, binary/BigInt codec, and deterministic replay serialization locally. The
  vendored files differ only in ESM import suffixes, formatting, and guards required by Pi Stuff's stricter TypeScript
  checks; the Workers-only executor and Durable Object storage are not imported.
- Store approval, replay, rejection, expiry, rollback, and lifecycle state in Pi Session entries while continuing to
  use OpenAI's Codex V8 Runtime instead of Cloudflare's Workers-only executor.
