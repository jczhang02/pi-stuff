# Context Management module

The Pi Stuff Magic Context adapter. When a Session already has a recognized
Magic Context configuration with no pending migration, it finishes the exact
official module, factory, database, and Session initialization before editor
readiness. The official derived-state engine runs in one internal Context Engine
Worker so projection can proceed without monopolizing Pi's UI thread; Pi still
owns input, transcript rendering, Sessions, model requests, and Agent lifecycle.
The adapter does not render or refresh submitted input itself. Missing or legacy
configuration remains dormant until direct use can authorize creation or
migration. Input interception only invalidates stale projections and can start a
fallback retry. Provider and compaction boundaries defensively join any pending
retry before they consume context. Pi's JSONL session remains the raw authority,
and the Module falls back to Pi's native context path when the derived local
store is unavailable before Magic takes ownership.

Magic Context 0.40 migrates flat user-level Historian and Dreamer execution
settings into per-harness blocks. Context detects that pending rewrite without
changing the file, defers mutation-free startup, and leaves the official
factory to perform the migration after direct use.

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

Context Management does not create task anchors, count general provider turns,
Tools, or Agent delegations, block Tools or Suite-authored messages, or decide
whether Pi, Goal, or Agents should pause, stop, complete, or fail. Each owning
Capability retains its own lifecycle policy.

`index.ts` is the Pi-facing wiring, public facade, and Effect runner for Host-side activation and projection;
`runtime.ts` remains the one lifecycle and activation authority.
`activity.ts` owns persistent Context Activity, `command-runtime.ts` owns `/ctx` dispatch, and
`tool-presentation.ts` owns Magic Tool presentation. `projection.ts` owns projection cache and in-flight work, while
`projection-format.ts` owns bounded native/Magic projection. `magic-runtime.ts` contains event schemas and the quiet
Host proxy. `magic-worker-client.ts` is the Pi-facing Worker adapter and owns Worker
registration, Session projection, and its scoped runner boundary; `magic-worker-host.ts` interprets the bounded Host
effects and synchronous compaction acknowledgement; `magic-worker-transport.ts` owns native Worker acquisition,
request correlation, cancellation, and release.

Activation, Session-start serialization, committed-engine cleanup, and projection flights use Effect primitives rather
than Promise-owned queues. One activation `Deferred` is shared by concurrent callers, and the stronger direct-use
trigger wins before a deferred automatic activation releases its joiners. Activation stages registrations, replays the
captured Session start, and commits only after the complete plan succeeds; failure runs staged shutdown handlers and
keeps Pi native Context authoritative. Projection callers share one generation-keyed `Deferred`; invalidation completes
its joiners with native fallback before clearing the published flight, and generation fences reject its late result. The
only fire-and-continue programs—direct input prewarming and committed fatal cleanup—are started by `index.ts` under the
current Pi Session signal; every other
Effect program is joined by the Pi callback or public facade that initiated it.

The external engine dependency is pinned to `@cortexkit/pi-magic-context@0.40.0`. The repository applies one
temporary audited dependency patch so the engine resolves and preloads its installed `ai-tokenizer` in standalone Pi,
and avoids retokenizing image payloads solely for content hashing; [UPSTREAM.md](./UPSTREAM.md) records the patch and its
removal trigger. The
adapter suppresses the upstream Todo, statusline, announcement, command, and
auxiliary UI surfaces while retaining the five maintenance handlers behind the
Suite-owned `/ctx` dispatcher. It also supplies a compact provider-facing behavior contract before the
official engine handles `before_agent_start`. The engine therefore keeps its
own prompt-cache processing while skipping its much longer default guidance;
history semantics, retrieval, reduction, memory, notes, and fail-open behavior
remain unchanged.

Context also owns the ordered system-prompt contribution seam used by other
Capabilities. Contributions are marker-delimited and reconciled idempotently:
the Host/base prompt comes first, Magic Context follows, and registered
Capability instructions come last. A provider-request fallback covers
continuations that Pi starts without `before_agent_start` by rewriting the
known Anthropic, OpenAI, Google, Bedrock, and Mistral system-prompt payload
shapes. Unsupported payloads fail open with one silent diagnostic rather than
mutating an unknown request shape. Ponytail registers at the final ordered
position: its Code Mode Skill catalog, when required, precedes its current-mode
instructions. Ponytail's standing contribution is measured and bounded
separately from Context's 8,000-character direct-mode contract.

The adapter bundles the pinned engine into an in-memory Worker artifact during
activation because the certified standalone Pi binary cannot resolve its external
Worker module graph. No bundle is written to disk. Host events, Tools, and
commands remain registered in Pi and cross the boundary as immutable, field-scoped
snapshots. The Worker receives one full Session snapshot when it first binds the
Session, after a detected branch discontinuity, and for explicit history-rebuild
commands. Ordinary Context projection and persistence send at most one new leaf,
so long Sessions are not cloned again on every prompt. The current Session's
Effect Capability Scope owns Worker acquisition and initialization, and one
operation Scope owns each event, Tool, or command request. Interruption removes the pending request and emits the native
cancellation message; Bun bundling, Worker messaging, Worker-side
`AbortController`, synchronous shared-memory effects, and termination remain the
narrow native adapter. Fatal Worker errors return the Capability to native Context
immediately. Host shutdown gives the official handler one bounded grace period
before the Suite's final Effect hook interrupts remaining requests, terminates the
Worker exactly once even when its serialized queue is stuck, and revokes the
in-memory URL. The Host references the Worker only while a request is pending, so
an idle engine cannot prevent print or RPC processes from reaching their normal
exit path.
The narrowly enumerated Host effects and lifecycle contract are recorded in
[ADR 0019](../../../../docs/adr/0019-isolate-context-engine-work-from-the-host-ui-thread.md).

The accepted `/ctx` readability target is recorded in
[`docs/adr/0008-own-the-context-command-surface.md`](../../../../docs/adr/0008-own-the-context-command-surface.md).
Its 2026-08-17 update was implemented on 2026-08-18. The shipped single-column Dialog now leads with usage, uses
`◆` sections and semantic status icons, hides known no-op actions, and explains Context vocabulary. Its action lists
and text fields keep Pi's native SelectList and Input keyboard behavior rather than intercepting the read-only Dialog
aliases.
Suite-owned custom Agent messages use one shared delivery seam. That seam waits
for Context activation before the Host freezes the first request. Pi 0.84.4
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
does not load its optional local embedding runtime, keeping initial activation
small while history and memory recall remain available. An existing user or
project embedding configuration remains authoritative and is never rewritten.

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
- Pi 0.84.4 performs its native threshold check after Tool results and before
  the next Assistant request. Context does not duplicate that Host path.
- Pi 0.84.4 still skips its pre-turn native compaction threshold check for an
  idle custom `sendMessage` turn. If Magic remains dormant or unavailable,
  Context reads Pi's exact current compaction settings and runs the public
  `ctx.compact` callback boundary before delivery only when the same threshold
  is already exceeded. Disabled native compaction stays disabled. Because the
  public API exposes only manual compaction, this safety preflight is reported
  by Pi as `manual`; Goal recognizes the in-process preflight marker and does
  not schedule a duplicate continuation. Concurrent callers share one Effect
  `Deferred`; Host shutdown joins that preflight within the same bounded
  shutdown grace used for other Context work.
- A manual `/compact` while Magic is healthy records one extension-owned Pi
  compaction boundary with a positive managed-history result. Automatic
  threshold or overflow compaction remains owned by Magic and cancels Pi's
  native summary. Pi 0.84.4 reports that cancellation through its native
  `session_compact_failed` event; Goal uses a matching pending Session event
  only to replace the continuation it suspended at `session_before_compact`.
  `session_compact` remains the sole success path. If Context is already
  degraded before an attempt, Pi's native path remains available. If an active
  Magic compaction hook itself fails, the adapter cancels that attempt, reports
  the failure, and leaves the full JSONL intact rather than stacking a native
  summary after a partial Magic attempt.
- The official engine owns its durable message index. Context activation replays
  the captured `session_start` exactly once so fresh and resumed sessions enter
  that indexing lifecycle. Recognized migration-free configurations do that
  before editor readiness; dormant or degraded retries do it transactionally
  before a replacement runtime commits.
- Real Pi acceptance observes the final Provider request, requires the compact
  contract, rejects the upstream verbose guidance, and caps the direct-mode
  system prompt at 8,000 characters. This catches prompt regressions across
  dependency upgrades without coupling the adapter to private engine helpers.
