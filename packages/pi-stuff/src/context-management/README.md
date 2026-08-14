# Context Management module

The Pi Stuff continuity boundary. When a Session already has a recognized
Magic Context configuration with no pending migration, it finishes the exact
official module, factory, database, and Session initialization before editor
readiness. Missing or legacy configuration remains dormant until direct use can
authorize creation or migration. Input interception only invalidates stale
projections and can start a fallback retry; it never waits for a synthetic UI
frame. Provider and compaction boundaries defensively join any pending retry
before they consume context. Pi's JSONL session remains the raw authority, and
the Module falls back to Pi's native context path when the derived local store
is unavailable before Magic takes ownership.

The Capability exposes no upstream floating UI, statusline entry, migration
prompt, or second Todo authority. Magic Context's history, memory, search,
notes, and Historian remain available behind this boundary. Pi Stuff owns one
`/ctx` command surface: its status and actions use the shared Command Dialog,
and maintenance progress persists as model-invisible Context Activity. BTW
receives the exact frozen
Pi branch plus a bounded reference-only copy of project memory captured by the
normal Magic turn; fresh Agents receive project memory only, while
forked Agents may receive bounded parent history. Magic's own internal
Historian process is not represented as a Pi Stuff Agent.

User-started work also carries one bounded provider-only task anchor across
normal turns and managed-history compaction. The anchor retains the current
request, latest authoritative correction, requested deliverable, material
constraints, and completion criteria without changing Pi's durable transcript.
It precedes the canonical projected conversation so Pi's Provider conversion
cannot replace the latest real user message with the anchor. An aggregate
convergence governor tracks provider turns, Tool calls, Agent
delegations, compactions, repeated child-failure categories, and distinct
evidence. It asks the model to synthesize before fixed aggregate limits and then
blocks further expansion with an actionable result. Non-mutating Tools count as
progress only when they return non-empty, distinct result content; changing
arguments or merely succeeding does not reset the boundary. Distinct evidence
receives a bounded allowance per provider turn, while task-wide fingerprints
prevent repeated output from resetting the no-progress boundary indefinitely.
At a hard provider-turn or compaction boundary, Suite-authored automatic
messages are still persisted for inspection but cannot trigger another model
request; direct user input remains available.

The external engine dependency is pinned to `@cortexkit/pi-magic-context@0.33.1`. The
adapter suppresses the upstream Todo, statusline, announcement, command, and
auxiliary UI surfaces while retaining the five maintenance handlers behind the
Suite-owned `/ctx` dispatcher. It also supplies a compact provider-facing behavior contract before the
official engine handles `before_agent_start`. The engine therefore keeps its
own prompt-cache processing while skipping its much longer default guidance;
history semantics, retrieval, reduction, memory, notes, and fail-open behavior
remain unchanged.
Suite-owned custom Agent messages use one shared delivery seam. That seam waits
for Context activation before the Host freezes the first request. Pi 0.84.1
does not emit `before_agent_start` for an idle `sendMessage` turn, so when such a
custom message is the first Agent turn, the normal Magic `context` transform
adds the same compact guidance to that provider request only. It is not written
to Pi's JSONL, and subsequent ordinary prompts return to the normal system
prompt injection path.
On first direct interactive/RPC activation (or an explicit Context projection)
it writes a conservative user configuration only when no recognized user or
project configuration exists; it never overwrites existing configuration. An
Extension-authored automatic turn may use an existing CortexKit user or project
config only when the official factory has no legacy user/project configuration
to migrate. Creation and migration always wait for direct use. Exact source and
artifact provenance are recorded in [UPSTREAM.md](./UPSTREAM.md).

User attribution and direct-use authority are intentionally different. A delayed
completion may remain attributed to the user's original Agent run for Statusline
and Git observation, but it activates Context as automatic work and cannot create
or migrate configuration. Only the current interactive/RPC prompt, Suite command,
or explicit Suite UI/RPC action carries the one-delivery direct-use marker.

The first-use profile selects Magic Context's official lexical search path and
does not load its local embedding runtime. This avoids a published 0.33.1
dynamic-import incompatibility in the certified single-file Pi Host while
keeping history and memory recall available. An existing user or project
embedding configuration remains authoritative and is never rewritten.

## Pi Host constraints

This boundary deliberately works within Pi's extension interface:

- Event, command, renderer, and tool registrations cannot be unregistered. Magic
  registrations are therefore staged until activation succeeds, and committed
  event handlers are guarded by the owning runtime generation. The continuity
  settlement observer is registered once even when reload or resume emits
  `session_start` again on the same runtime.
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
- Pi 0.84.1 also skips its pre-turn native compaction threshold check for an
  idle custom `sendMessage` turn. If Magic remains dormant or unavailable,
  Context reads Pi's exact current compaction settings and runs the public
  `ctx.compact` callback boundary before delivery only when the same threshold
  is already exceeded. Disabled native compaction stays disabled. Because the
  public API exposes only manual compaction, this safety preflight is reported
  by Pi as `manual`; Goal recognizes the in-process preflight marker and does
  not schedule a duplicate continuation.
- A manual `/compact` while Magic is healthy records one extension-owned Pi
  compaction boundary with a positive managed-history result. Automatic
  threshold or overflow compaction remains owned by Magic and publishes one
  session-identity-bound in-process bypass event; Goal uses that event only to
  replace a continuation it suspended at `session_before_compact`. If Context
  is already degraded before a compaction attempt, Pi's native path remains
  available. If an active Magic compaction hook itself fails, the adapter
  cancels that attempt, reports the failure, and leaves the full JSONL intact
  rather than stacking a native summary after a partial Magic attempt.
- The official engine owns its durable message index. Context activation replays
  the captured `session_start` exactly once so fresh and resumed sessions enter
  that indexing lifecycle. Recognized migration-free configurations do that
  before editor readiness; dormant or degraded retries do it transactionally
  before a replacement runtime commits.
- Real Pi acceptance observes the final Provider request, requires the compact
  contract, rejects the upstream verbose guidance, and caps the direct-mode
  system prompt at 8,000 characters. This catches prompt regressions across
  dependency upgrades without coupling the adapter to private engine helpers.
