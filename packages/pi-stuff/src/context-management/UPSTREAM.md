# Bundled context engine provenance

Pi Stuff integrates the official Magic Context Package through this adapter and does not vendor Magic Context Core.
The repository applies one temporary, audited dependency patch to the pinned Package for tokenizer compatibility and stable
message identity during Pi retry.

The exact published Package executes inside Pi Stuff's Context Engine Worker. The adapter produces one
activation-time in-memory bundle solely to make the official module graph resolvable from the certified standalone Pi
binary; it does not alter upstream source or persist a derived artifact.

- Upstream: `https://github.com/cortexkit/magic-context`
- Upstream release: `v0.41.1`
- Published source commit (`gitHead`): `cbfac49fa88b3eb86074b9499c38e993cc447f34`
- Package: `@cortexkit/pi-magic-context@0.41.1`
- npm integrity: `sha512-FYl1IH4KOCXkt4UOI6ZswwI/p3YO9+eP2hrfOtgjlsYjp8UHI+OM7fRY6Z6PGOcaf5+kn0PM1CeHY9j3mjL9TQ==`
- npm tarball SHA-1: `877ae8c6d055bc8af7e7fa5f1d180724c18d2dfb`
- Audited tarball SHA-256: `5a227889dd91ed952a7403390b463e3e1ac705f837b8f055ffba62eb659229de`
- License: MIT, as declared by the official Package manifest and upstream repository.

## Temporary tokenizer compatibility patch

- Patch: [`patches/@cortexkit%2Fpi-magic-context@0.41.1.patch`](../../../../patches/@cortexkit%252Fpi-magic-context@0.41.1.patch)
- Patch SHA-256: `4a9f5c7ce7119a03f4b96271268df2d0b1e31d9a855111e85fd49b45158df24d`
- Scope:
  - add the published module's `import.meta.url` ancestry and Bun isolated-linker `node_modules` root to the existing
    `ai-tokenizer` fallback search;
  - preload the tokenizer during engine initialization instead of the first submitted turn;
  - reuse an image draft's existing image-token estimate while hashing it, avoiding exact BPE work over base64 that is
    not part of the hash result.
- Behavior retained: a genuinely unavailable tokenizer still uses Magic Context's existing heuristic fallback. The
  patch does not suppress or intercept diagnostics.
- Evidence: a forced frozen-lockfile install applies the patch; direct `preloadTokenizer()` under the certified Pi Host
  resolves from an unrelated user project; the 4 MiB malformed-image PTY case remains responsive; and the real Context
  PTY gate rejects raw `[magic-context]` output.
- Removal trigger: replace the patch only after an exact official Magic Context artifact passes the same clean-install,
  first-input, malformed-image, schema, and real-Host checks.

### 2026-09-02 upstream audit and upgrade

The latest npm release at this audit is
[`v0.41.1`](https://github.com/cortexkit/magic-context/releases/tag/v0.41.1). The preceding
[`v0.41.0`](https://github.com/cortexkit/magic-context/releases/tag/v0.41.0) adds cache-stability repairs, Pi RPC and
multi-Session support, layout-tolerant Pi module resolution, and storage migration v82. The patch release fixes the
first-day historian, bundled-Pi subagent, optional ONNX, Todo rendering, and diagnostic regressions.

The official 0.41.1 artifact still lacks all three local tokenizer and image-hash behaviors: its tokenizer fallback
walk starts only from `process.argv[1]`, tokenizer preload remains outside factory initialization, and part hashing
cannot accept an already-computed token estimate. The removal trigger is therefore not met, so the equivalent audited
patch remains in place.

Schema v82 adds `memory_verifications.mapping_origin`. Certification creates a real v82 database, rolls it back to an
exact v81 shape, verifies automatic v81-to-v82 migration, and then starts a v81-fenced Worker against v82 storage. The
stale Worker exposes no commands or Tools and retains only `session_shutdown`, so it cannot write a newer store.

Upstream 0.41.1 also reads `pi.events` for child-subagent lifecycle notifications. Pi never initializes child
Extensions inside the Context Engine Worker, so that isolated adapter supplies a no-op EventBus: there is no in-Worker
publisher to forward, while foreground Pi and Agents retain their existing lifecycle ownership.

The Package declares Pi peers `^0.80.2`, which does not include the Suite's certified Pi 0.84.4 Host. Pi Stuff does not
infer compatibility from that range. Real Pi 0.84.4 PTY and Provider gates separately certify activation, cancellation
recovery, live Session replacement and restoration, cold resume, Magic-only compaction, project isolation, startup/degraded
fail-open behavior, and active Host-managed fail-closed Provider handling. See the [optimization report](../../../../docs/reports/magic-context-effect-optimization-2026-09-02.md).

## Pi Stuff adapter policy

- lazy direct-input activation starts after Host input acknowledgement while the first Agent boundary retains direct-user
  mutation authority; automatic-turn activation runs only when a recognized CortexKit config exists and no legacy
  location or flat user execution settings await the official factory's migration;
- native Pi fail-open behavior during startup or degraded operation only;
- active Host-managed `before_provider_request` handling is a local fail-closed adapter boundary with 95% final-payload
  validation; direct calls bypassing that hook are excluded;
- no upstream submission or dependency is introduced for the local adapter boundary;
- one bounded status/projection seam for BTW and Agents;
- exact official base Package plus the temporary audited tokenizer compatibility patch behind a replaceable Capability seam;
- the exact official engine isolated from Pi's UI thread behind immutable Host snapshots and bounded effects;
- a semantically transparent cancellation boundary: mirrored lifecycle events and signal-blind commands do not inherit
  the ambient Agent-turn signal; Tool invocations and the pinned signal-aware augmentation command retain their owned
  signals, and every upstream upgrade re-audits which official handlers consume a signal;
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

## Retained-summary retry identity correction

The Pi adapter now uses Magic's existing reference and unique-fingerprint resolver for message identities on every
Context projection. Equal message counts cannot prove positional alignment: Pi retains earlier compaction summaries
and removes a persisted failed Assistant response from active retry messages. Those differences can cancel and attach
drop records to the wrong messages. The unused positional alignment implementation is removed.

A regression uses actual Pi Session projection and the real Magic Worker, retains an older summary, persists a failed
response, then retries unchanged input. The projected messages and tags must remain identical. This correction is part
of ps-5r4 under ps-eck; it does not alone certify Magic-only overflow recovery. Remove this patch component when an
exact upstream artifact passes the same retained-summary/retry regression and real Host differential acceptance.
