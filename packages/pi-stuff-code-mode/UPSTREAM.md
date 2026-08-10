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

## Pi Stuff delta

- Make Code Mode Suite-wide and model/provider agnostic rather than replacing an OpenAI transport.
- Present one ordinary Pi function Tool, `codemode({ code })`; no provider payload rewriting and no model-name
  compatibility table.
- Project every currently active Aggregate-owned Tool into the local V8 Connector, including deferred Tools once they
  actually become active. There is no fixed 25-Tool list.
- Keep search, descriptions, and full nested schemas local to V8. Only the small outer schema enters provider context.
- Auto-wait yielded cells inside the Tool so no provider-facing `wait` schema or stranded continuation is required.
- Re-enter the original Tool preparation, validation, Aggregate-owned lifecycle/result hooks, dynamic Tool activation,
  termination, cancellation, and usage accounting for nested calls without binding to Pi private dispatch APIs.
- Render the original Pi Stuff Tool components directly and keep the Code Mode envelope visually silent. Persist
  nested traces in normal session details so live execution and reload share one projection.
- Install the pinned official host lazily with proxy support, cancellation, checksum verification, an inter-process
  lock, and atomic staging. No native binary is copied into this repository.
- Exclude upstream provider replacement, Responses Lite transport, model gating, custom PATH/TOML Tools, native
  compaction, prompt replacement, voice, background-shell UI, and Code Mode-specific visual chrome.
