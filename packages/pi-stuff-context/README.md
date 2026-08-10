# `@jczhang02/pi-stuff-context`

The Pi Stuff continuity boundary. It loads the exact official Magic Context
Package only when a user input or automatic Agent turn actually needs context,
keeps Pi's JSONL session as the raw authority, and falls back to Pi's native
context path when the derived local store is unavailable before Magic takes
ownership.

The Capability exposes no floating UI, statusline entry, migration prompt, or
second Todo authority. Magic Context's history, memory, search, notes, and
Historian remain available behind this boundary. BTW receives the exact frozen
Pi branch plus a bounded reference-only copy of project memory captured by the
normal Magic turn; fresh Agents receive project memory only, while
forked Agents may receive bounded parent history. Magic's own internal
Historian process is not represented as a Pi Stuff Agent.

The bundled engine is pinned to `@cortexkit/pi-magic-context@0.33.1`. The
adapter suppresses the upstream Todo, statusline, announcement, and auxiliary
UI surfaces while retaining the five Context tools and focused diagnostics.
It also supplies a compact provider-facing behavior contract before the
official engine handles `before_agent_start`. The engine therefore keeps its
own prompt-cache processing while skipping its much longer default guidance;
history semantics, retrieval, reduction, memory, notes, and fail-open behavior
remain unchanged.
On first lazy activation it writes a conservative user configuration only when
neither the current CortexKit path nor a legacy Pi path exists; it never
overwrites user configuration. Exact source and artifact provenance are
recorded in [UPSTREAM.md](./UPSTREAM.md).

The first-use profile selects Magic Context's official lexical search path and
does not load its local embedding runtime. This avoids a published 0.33.1
dynamic-import incompatibility in the certified single-file Pi Host while
keeping history and memory recall available. An existing user or project
embedding configuration remains authoritative and is never rewritten.

## Pi Host constraints

This boundary deliberately works within Pi's extension interface:

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
  model-specific tokenizer. Safety-critical Agent projections therefore use
  UTF-8 byte length as a tokenizer-independent upper bound, together with the
  resolved child and fallback model windows and conservative launch reserves;
  exact provider tokenization remains the provider's responsibility.
- A manual `/compact` while Magic is healthy records one extension-owned Pi
  compaction boundary with a positive managed-history result. Automatic
  threshold or overflow compaction remains owned by Magic and publishes one
  session-identity-bound in-process bypass event; Goal uses that event only to
  replace a continuation it suspended at `session_before_compact`. If Context
  is already degraded before a compaction attempt, Pi's native path remains
  available. If an active Magic compaction hook itself fails, the adapter
  cancels that attempt, reports the failure, and leaves the full JSONL intact
  rather than stacking a native summary after a partial Magic attempt.
- The official engine owns its durable message index. Context activation
  replays the already-observed `session_start` exactly once so fresh and resumed
  sessions enter that indexing lifecycle even though the engine loads lazily.
- Real Pi acceptance observes the final Provider request, requires the compact
  contract, rejects the upstream verbose guidance, and caps the direct-mode
  system prompt at 8,000 characters. This catches prompt regressions across
  dependency upgrades without coupling the adapter to private engine helpers.
