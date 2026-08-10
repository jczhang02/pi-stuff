---
status: accepted
---

# Wrap active Suite Tools in one local Code Mode envelope

When enabled, Pi Stuff will expose one model-facing `codemode({ code })` Tool and move the full active Aggregate Tool
catalog into an isolated local V8 Connector. This solves repeated schema cost rather than merely deferring schemas for
one turn: future provider requests continue to carry only the small envelope while locally activated Tools remain
available through `suite.*` on the next Code Mode execution. The initial rollout is disabled by default so installing
the update cannot change an existing workflow before the user opts in with `/codemode on`.

The implementation is an owned fork of the mature `@howaboua/pi-codex-conversion` Code Mode host integration and uses
Cloudflare Code Mode as the interface reference. It deliberately does not fork Pi, patch a provider payload, gate on a
model name, introduce a second CLI, or add Code Mode-specific transcript chrome.

## Consequences

- `suite` contains every currently active Tool registered through the Aggregate. Deferred Tools appear when active;
  inactive Tools are rejected; separately installed third-party Tools remain top-level because their private execute
  callbacks are not owned by the Aggregate.
- Full schemas and local search/describe data enter the V8 source only. The provider sees the outer Tool description
  and `{ code: string }` schema.
- The V8 sandbox has no direct filesystem, network, process, module, or credential access. All I/O re-enters the
  original Suite Tool.
- Nested execution must preserve Pi argument preparation and validation, Tool call/result hooks, lifecycle events,
  streaming updates, cancellation, errors, usage, dynamic Tool activation, and termination hints.
- "Tool hooks" here means handlers registered through the Aggregate boundary. Pi 0.84.1 has no public API for an
  Extension to redispatch a nested call through unrelated Extensions; their Tools and private interception remain
  top-level compatibility boundaries rather than relying on a private Host seam.
- The outer envelope is visually silent. Nested calls reuse the original Tool renderer and Activity Group state in
  compact, expanded, running, failed, cancelled, media, and resumed-session cases. Normal Pi JSONL remains the only
  session authority.
- Nested media is hoisted through the outer result for Pi's normal image normalization. At `tool_execution_end`, the
  normalized provider content moves into persisted presentation details and nested image blocks are removed from the
  outer TUI result. The original renderer receives each image and generated hint at its original content boundary;
  the public `context` hook restores the exact normalized content before provider calls. Each nested image payload is
  persisted once, so image-capable terminals, fallback terminals, and session reload cannot acquire envelope-specific
  media placement.
- Yielded cells are waited internally. Cancelling the outer Tool terminates an inaccessible yielded cell.
- One V8 execution fails explicitly after 768 nested calls as an emergency safety bound. It never truncates the
  persisted operation list, and it does not cap the Activity Group, which may continue across later Code Mode calls.
- The official OpenAI Codex V8 host is downloaded only on first use, through configured proxies, with a bounded
  timeout, pinned checksum, inter-process lock, and atomic installation. Startup remains free of writes, network, and
  subprocesses.
- `/codemode off` restores the exact virtual active Tool order; `/codemode on` reapplies the envelope. This is a
  runtime escape hatch for comparison and fallback, not a permanent parallel implementation.
- The implementation is an internal module of the single local Package, not a separately selectable Pi resource: a
  correct registry can exist only while the Suite owns registration.

## Acceptance

The change is accepted only if real Pi 0.84.1 tests prove that Code Mode on/off produces the same Tool Activity pixels
and full ANSI screen at 100×32 and 64×28 before and after session resume. The comparison normalizes only the truthful
context-usage number, which Code Mode is specifically intended to change; statusline structure and styling remain
exact. The real fixture includes mixed Read, Bash, Background Work, and Agent-management calls plus failure, a
deterministic cancellation-classified result, and interleaved real PNG/text/PNG reads through Pi's media normalization
and terminal fallback path. That fixture also verifies that normalized nested images are restored in provider context.
Unit tests cover outer cancellation independently of process-exit timing, as well as compact, expanded, rejection,
streaming settlement, and lifecycle equivalence. A Pi 0.84.1 `ToolExecutionComponent` test forces Kitty capabilities
and compares expanded multi-image output on/off after normalizing only random image IDs. The provider sees only
`codemode`; Magic Context remains in the active local catalog; and the live serialized schema is materially smaller
than the direct active Tool set. The initial certified fixture measures 31,188 characters across 22 direct Tools versus
1,251 characters for Code Mode, a 96.0% reduction.
