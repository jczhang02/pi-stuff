# `@jczhang02/pi-stuff-context`

The Pi Stuff continuity boundary. It loads the owned Magic Context fork only
when a user input or automatic Agent turn actually needs context, keeps Pi's
JSONL session as the raw authority, and falls back to Pi's native context path
when the derived local store is unavailable.

The Capability exposes no floating UI, statusline entry, migration prompt, or
second Todo authority. Magic Context's history, memory, search, notes, and
Historian remain available behind this boundary. BTW receives a bounded
reference-only projection; fresh Agents receive project memory only, while
forked Agents may receive bounded parent history. Magic's own internal
Historian process is not represented as a Pi Stuff Agent.

The bundled fork is pinned to signed release `pi-stuff-v0.33.1-3`. Exact source
and artifact provenance are recorded in [UPSTREAM.md](./UPSTREAM.md).

## Pi 0.83 host constraints

This boundary deliberately works within Pi 0.83's extension interface:

- Event, command, renderer, and tool registrations cannot be unregistered. Magic
  registrations are therefore staged until activation succeeds, and committed
  event handlers are guarded by the owning runtime generation.
- Pi exposes no active-tool policy change event or mutation provenance. Context
  never adds a name to the current active set during activation; it may only
  preserve the set or remove an unavailable handoff. A handoff disabled after a
  failed activation remains disabled until an external policy or session reload
  explicitly enables it.
- Extension contexts expose no Host identifier. Capabilities are routed by the
  `sessionManager` object observed at `session_start`; an unbound context always
  receives native Pi behavior rather than a process-global fallback.
- The Magic factory provides neither an abort signal nor a returned disposer.
  Reload invalidates late continuations and runs any staged shutdown handler,
  but Pi Stuff cannot cancel a hung third-party factory or reverse side effects
  performed before that handler is registered.
- Pi's public token estimate is a generic four-code-unit heuristic, not a
  model-specific tokenizer. Agent projections use the resolved child and
  fallback model windows plus conservative prompt and fork reserves; exact
  provider tokenization remains the provider's responsibility.
- A manual `/compact` while Magic is healthy records one extension-owned Pi
  compaction boundary with a positive managed-history result. Automatic
  threshold or overflow compaction remains owned by Magic and publishes one
  session-identity-bound in-process bypass event; Goal uses that event only to
  replace a continuation it suspended at `session_before_compact`. If the
  Magic hook fails or Context is already degraded, Pi's native compaction runs.
- Explicit `ctx_search` synchronizes its derived message index from the active
  Pi JSONL branch before searching. After compaction and cold resume it can
  recall hidden early turns immediately, while the visible live tail remains
  excluded from duplicate search results.
