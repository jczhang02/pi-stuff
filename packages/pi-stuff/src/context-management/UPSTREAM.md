# Bundled context engine provenance

Pi Stuff integrates the official Magic Context Package through this adapter and does not vendor Magic Context Core.
The repository applies one temporary, audited dependency patch to the pinned Package while the upstream tokenizer
path does not satisfy standalone Pi's module-resolution and first-turn latency contracts.

The exact published package executes inside Pi Stuff's Context Engine Worker.
The adapter produces one activation-time in-memory bundle solely to make the
official module graph resolvable from the certified standalone Pi binary; it
does not alter upstream source or persist a derived artifact.

- Upstream: `https://github.com/cortexkit/magic-context`
- Upstream release: `v0.40.0`
- Published source commit (`gitHead`): `002c2c292eef51573ebe950237d586f9310bbece`
- Package: `@cortexkit/pi-magic-context@0.40.0`
- npm integrity: `sha512-nlrC4QKcUWsdWnmoXhWRhRinOrZwrkrkIz3SmEdu2Fe78DS4BFNmyv4vIRR58yqv+iSBvkUzko5fOb4F9z6oxA==`
- npm tarball SHA-1: `8697ea2bc658f325faefd1308b39b82594910b38`
- Audited tarball SHA-256: `968c34cc384252302ef77eec1c0235ecf1cd5ca96d6abccdd4ef4630fdf48f1b`
- License: MIT, as declared by the official Package manifest and upstream repository.

## Temporary tokenizer compatibility patch

- Patch: [`patches/@cortexkit%2Fpi-magic-context@0.40.0.patch`](../../../../patches/@cortexkit%252Fpi-magic-context@0.40.0.patch)
- Patch SHA-256: `809e9705edad15cc8f5cfc6122b4c50c62ed6c6d49a2fa00f36353b433a88388`
- Scope:
  - add the published module's `import.meta.url` ancestry and Bun isolated-linker `node_modules` root to the existing
    `ai-tokenizer` fallback search;
  - preload the tokenizer during engine initialization instead of the first submitted turn;
  - reuse an image draft's existing image-token estimate while hashing it, avoiding exact BPE work over base64 that is
    not part of the hash result.
- Behavior retained: a genuinely unavailable tokenizer still uses Magic Context's existing heuristic fallback. The
  patch does not suppress or intercept diagnostics.
- Evidence: direct `preloadTokenizer()` under the certified standalone Pi Host changes from `false` to `true` when the
  Host runs from an unrelated user project; the long malformed-image PTY fixture remains responsive; and the real
  Context PTY gate rejects raw `[magic-context]` output.
- Removal trigger: replace the patch only after an exact official Magic Context artifact passes the same clean-install,
  first-input, malformed-image, and real-Host checks.

### 2026-08-30 upstream audit

The latest official Package release at the time of this audit is
[`v0.40.1`](https://github.com/cortexkit/magic-context/releases/tag/v0.40.1), published from
[`a239835e161efc730f0da8472786fe372626e66b`](https://github.com/cortexkit/magic-context/commit/a239835e161efc730f0da8472786fe372626e66b).
That release commit changes only the three Package versions, and its release notes cover database opening, musl local
embeddings, task visibility, and reminder rendering rather than tokenizer loading or image hashing.

The exact official [`@cortexkit/pi-magic-context@0.40.1` npm
artifact](https://www.npmjs.com/package/@cortexkit/pi-magic-context/v/0.40.1) has SHA-1
`86c182b8fe0785f38ec3ff35c2a2196b356cab82` and still lacks every local patch behavior:

- `tokenizerPackageRoots()` searches the working directory, OpenCode cache, and `process.argv[1]` ancestry, but not the
  published module's `import.meta.url` ancestry or Bun isolated-linker `node_modules` root;
- `preloadTokenizer()` still runs from `before_agent_start`, not during engine initialization; and
- `memoizedContent(kind, content)` still performs `estimateTokens(content)` without accepting the image draft's known
  token estimate.

The removal trigger is therefore not met. Pi Stuff keeps the exact `0.40.0` dependency and its audited patch; any later
upgrade must preserve an equivalent patch until a new official artifact passes the clean-install, first-input,
malformed-image, and real-Host gates.

The Package declares Pi peers `^0.80.2`, which does not include the Suite's
certified Pi 0.84.4 Host. Pi Stuff therefore does not infer compatibility from
the peer range: its real-Host PTY gate separately certifies this exact artifact
against the pinned Pi 0.84.4 source profile.

## Pi Stuff adapter policy

- lazy direct-input activation, with automatic-turn activation only when a recognized CortexKit config exists and no
  legacy location or flat user execution settings await the official factory's migration;
- native Pi fail-open behavior;
- one bounded status/projection seam for BTW and Agents;
- exact official base Package plus the temporary audited tokenizer compatibility patch behind a replaceable Capability seam;
- the exact official engine isolated from Pi's UI thread behind immutable Host snapshots and bounded effects;
- no competing Todo, statusline, announcement, Dreamer, or Sidekick UI;
- only the five Context tools plus focused status, flush, recomposition,
  wrap-up, and session-upgrade commands are exposed;
- one explicit compaction authority: native fallback is allowed before Magic
  takeover, never stacked after an active Magic attempt;
- bounded reference-only projections for BTW and Agents;
- a first-use configuration bootstrap that mirrors upstream's absolute-XDG and JSON/JSONC path rules, ignores custom
  Pi agent directories that upstream does not read, and creates a user config only when no recognized user or project
  config exists;
- a lexical-only first-use search profile, keeping initial activation independent
  of the optional local embedding runtime. Explicit user embedding configuration
  is preserved.
