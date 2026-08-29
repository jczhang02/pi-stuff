# Context submission concurrency research

Date: 2026-08-14
Status: historical research; the initial implementation was later superseded by ADR 0019

> **Current disposition (2026-08-29):** the render-order findings below remain useful, but the conclusion that Magic
> Context could not safely cross a Worker boundary is no longer current. Later implementation evidence established the
> narrow in-memory bundle, immutable snapshot, and bounded Host-effect bridge recorded in
> [ADR 0019](../adr/0019-isolate-context-engine-work-from-the-host-ui-thread.md). Current behavior belongs to that ADR
> and the [Context Management README](../../packages/pi-stuff/src/context-management/README.md); this report preserves
> the earlier evidence and rejected intermediate design.

## Question

Can Pi Stuff clear and repaint the editor while Magic Context transforms a long
session, instead of inserting a fixed delay before the transform? Can the
transform itself safely run asynchronously or concurrently without changing
Magic Context or Pi Host?

## Observed boundary

Pi receives Enter quickly. The visible stall happens afterward: Pi Stuff's
Context handler starts transforming the provider message list before the
terminal has visibly painted the submitted state. On a long resumed session,
the synchronous transform can occupy the JavaScript thread long enough for the
submitted text to remain visible in the editor.

This is not a keyboard-input problem. It is the interaction of two separate
operations:

1. schedule or perform a terminal render;
2. synchronously prepare the message list that the provider must receive.

## Primary-source findings

### Pi serializes Context transformation before provider invocation

Pi's extension runner awaits each `context` handler and passes the resulting
message list forward. The provider therefore cannot safely start in parallel
with an unfinished Context transform: it would receive the wrong message list.

Source: [Pi extension runner](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/runner.ts)

### Pi has two materially different render operations

Pi TUI exposes both:

- `requestRender(force?)`, which schedules rendering through the event loop;
- `renderNow(force?)`, which renders synchronously.

`requestRender(true)` removes the normal render throttle, but it is still a
scheduled operation. Pi's TUI source uses `process.nextTick`, and ordinary
render requests may additionally be constrained by a 16 ms minimum interval.
There is no public promise that resolves when the terminal emulator has painted
the frame.

Sources: [Pi TUI implementation](https://github.com/earendil-works/pi/blob/main/packages/tui/src/tui.ts),
[Pi TUI documentation](https://pi.dev/docs/latest/tui), and
[Pi TUI README](https://github.com/badlogic/pi-mono/blob/main/packages/tui/README.md)

Pi Stuff already owns the actual `TUI` object inside its conversation UI
presentation. Context currently reaches it indirectly through Pi Stuff's shared
render-request event. That internal seam can be extended without changing Pi
Host or Magic Context.

More importantly, Pi TUI already calls its private `requestImmediateRender()`
after handling every keyboard input. A Context adapter does not need to request
a second render. It only needs to yield before synchronous transformation so
that Pi's already-scheduled input render can run.

### An event-loop yield helps painting, but does not make CPU work concurrent

JavaScript callbacks that perform substantial synchronous work block other
event-loop work. `setImmediate` yields until a later event-loop phase; it is a
better ordering primitive than an arbitrary sleep, but neither one makes the
Context transform run on another CPU thread.

Sources: [Node.js event-loop guidance](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop),
[Node.js timers](https://nodejs.org/api/timers.html), and
[Bun `setImmediate`](https://bun.sh/reference/globals)

### A Worker is real concurrency, but not a safe wrapper around Magic Context

Bun Workers run a separate JavaScript instance on another thread and exchange
structured-cloned messages. The current Context handler, however, depends on
Host objects, functions, session state, module-scoped caches, and a synchronous
SQLite-backed runtime. Those objects and that runtime cannot simply be moved to
a Worker. Recreating them there would amount to building and synchronizing a
second Magic Context integration.

Bun also documents Worker support as experimental, especially termination.
`bun:sqlite` is synchronous. Node's Worker documentation likewise recommends a
pool for CPU-bound JavaScript rather than creating a Worker for each call.

Sources: [Bun Workers](https://bun.sh/docs/runtime/workers),
[Bun SQLite](https://bun.sh/docs/runtime/sqlite), and
[Node.js worker threads](https://nodejs.org/api/worker_threads.html)

### Magic Context does not expose a safe split-phase or prewarm API

Magic Context's Pi handler receives the full provider-facing message list and
performs tagging, history injection, filtering, and related processing as one
Context pipeline. Its documented integration does not expose a public operation
that Pi Stuff can use to precompute only the expensive pure portion and later
commit the result.

The upstream source inspected during this research is newer than the project's
pinned version, so it is architectural corroboration rather than exact evidence
for every implementation detail. The locally installed pinned source remains
authoritative for the measured behavior.

Sources: [Magic Context Pi plugin README](https://github.com/cortexkit/magic-context/blob/master/packages/pi-plugin/README.md)
and [Magic Context handler](https://github.com/cortexkit/magic-context/blob/master/packages/pi-plugin/src/context-handler.ts)

### Terminal output has no portable pixel-painted acknowledgement

A stream write or drain callback can describe buffer progress, and tmux control
mode describes tmux protocol flow control. Neither proves that a terminal
emulator has physically repainted pixels. The strongest Pi Stuff can guarantee
without a Host/terminal protocol change is that it generated the submitted
frame and yielded execution before starting the synchronous transform.

Sources: [Node.js streams](https://nodejs.org/api/stream.html) and
[tmux control mode](https://github.com/tmux/tmux/wiki/Control-Mode)

## Historical architecture decision: an interactive input render barrier

The mature seam is not a timer and not direct Context access to `TUI`. It is an
ordering rule inside the Context adapter:

```ts
await yieldToHostUi()
```

Its interface guarantees only what Pi Stuff can honestly guarantee:

- apply only after Pi reports an `interactive` input source;
- allow Pi's already-scheduled keyboard-input render and one Host event-loop
  turn to run;
- introduce no fixed-duration sleep and no additional render request;
- never make UI ordering failure block provider processing.

The implementation is one `setImmediate` turn. Pi's TUI schedules the native
keyboard-input render with `process.nextTick` after invoking the focused input
handler. On the certified Bun 1.3.14 runtime, `process.nextTick` executes before
`setImmediate`.

Context owns one coalescing dirty flag: whether Pi has reported interactive
input since the last Context event. The input seam cannot yet know whether a
later Extension input handler will accept or handle that input, so this is not
modeled as one token per accepted submission. The authoritative `context`
handler consumes the flag and yields one Host turn before calling Magic
Context. Several rapid inputs require only one paint opportunity. RPC and
extension-authored submissions do not set the flag. A programmatic SDK caller
that explicitly labels input as `interactive` may receive one harmless Host
turn even when no TUI is present.

```text
interactive input
  -> Pi handles the editor input
  -> Pi schedules its native immediate render on process.nextTick
  -> Context boundary yields one Host event-loop turn
  -> Pi TUI performs the already-scheduled render
  -> one Host event-loop turn completes
  -> unchanged Magic Context transform
  -> provider invocation
```

This keeps state ownership local:

| State or action | Owner |
| --- | --- |
| Editor and immediate input-render scheduling | Pi TUI |
| Coalesced interactive-input render marker | Context runtime generation |
| Provider-message transformation | Magic Context through Pi's `context` seam |
| Provider invocation order | Pi Host |

Calling `renderNow()` from Context is rejected because it bypasses the TUI
scheduler and introduces re-entrant rendering. Calling `requestRender(true)`
is also rejected: Pi's main-screen and alternate-screen implementations reset
their previous-render caches for a forced request, which turns the next render
into a full redraw. The native keyboard path already schedules the required
immediate render without resetting those caches.

## Effect v4 feasibility

As of this report date, the official releases page lists
`effect@4.0.0-rc.109` as a pre-release. The npm dist-tags still select Effect
v3 as `latest` and expose v4 through an explicit `rc` tag. The v4 migration
guide still describes the line as beta and warns that APIs may change, so the
release documentation is visibly in transition.

Sources: [Effect releases](https://github.com/Effect-TS/effect/releases),
[npm Effect package](https://www.npmjs.com/package/effect?activeTab=versions),
and [Effect v4 migration guide](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md)

Effect v4 can represent this protocol:

- `Deferred` can represent a one-shot paint barrier;
- fibers can express structured concurrency and interruption;
- `Scope` can attach finalizers to a Session lifetime;
- `Effect.yieldNow` can yield to other Effect fibers.

Sources: [Effect core model and `yieldNow`](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Effect.ts),
[Effect `Deferred`](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Deferred.ts),
and [Effect `Scope`](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Scope.ts)

It does not improve this implementation:

1. `Effect.yieldNow` yields to the Effect runtime, not specifically to Pi's
   already-scheduled `process.nextTick` render or the terminal transport. The
   Host scheduling primitive is still required.
2. A `Deferred` would replace one native Promise without adding a second waiter,
   backpressure, or reusable coordination behavior.
3. Fiber interruption cannot stop the opaque Magic Context handler, whose
   factory exposes neither an abort signal nor a disposer.
4. Effect fibers do not move synchronous JavaScript to another CPU thread.
   Worker integration would retain the state-transfer problems described above.
5. Pi Stuff currently has no Effect dependency. Adding a pre-release effect
   runtime for one bounded ordering operation adds dependency, scheduler,
   archive-certification, and migration cost while leaving the essential Host
   primitive unchanged.

Therefore Effect v4 is technically feasible but architecturally rejected for
this fix. The paint-barrier interface is deliberately Effect-agnostic. A future
Suite-wide Effect adoption can implement the same interface after v4 is stable,
but only if several Capability Modules need shared structured cancellation and
resource scoping for operations that are actually interruptible.

## Options

| Option | What changes | User-visible result | Cost and risk | Decision |
| --- | --- | --- | --- | --- |
| Host-native input render barrier | For direct interactive input, yield one `setImmediate` before Context transformation | Pi's existing immediate input render runs before synchronous Context work | No extra render, no fixed sleep, and no cross-Capability TUI access | **Adopt** |
| Forced scheduled render | Call `requestRender(true)` before yielding | Submitted state renders before Context | Resets TUI render caches and can force a full document/screen redraw | Reject |
| Direct synchronous render | Context causes `tui.renderNow()` through a new handshake | Terminal output is generated synchronously | Bypasses scheduling and risks re-entrant cross-Capability rendering | Reject unless the scheduled barrier fails PTY acceptance |
| Fixed one-frame sleep | Request render, wait approximately 17 ms, then run Context | Usually lets one frame paint | Heuristic latency and no actual repaint guarantee | Do not use as the final design unless the two options above fail |
| Prewarm at session startup | Run equivalent Context work before first input | Faster first submission if prewarm stays valid | Moves the same delay into resume, lacks a safe upstream API, and may duplicate stateful work | Reject |
| Run provider before Context finishes | Do not await Context | Provider starts earlier | Incorrect provider messages; violates Pi's Context contract | Reject |
| Run the complete handler in a Worker | Recreate Context in another thread | True CPU concurrency in theory | Requires serializing Host state and duplicating/synchronizing Magic Context and SQLite state | Reject within Pi Stuff-only scope |
| Partition Magic Context with periodic yields | Change its loops to yield between chunks | Responsive UI during transformation | Requires upstream/fork changes and careful state-machine work | Out of scope |
| Effect v4 paint pipeline | Model the same barrier with fibers and `Deferred` | Same result as native Promise | Adds a pre-release runtime but still needs the same Host scheduling primitive | Reject for this fix |

## Historical recommendation

Do not treat the current fixed 17 ms experiment as final.

Implement the smallest stronger Pi Stuff-only boundary:

1. Interactive input marks one coalescing pending-render flag without waiting
   or requesting another render.
2. Pi TUI schedules its normal immediate keyboard-input render.
3. The Context handler consumes the marker, yields one Host event-loop turn,
   then starts the unchanged Magic Context handler.
4. A real tmux PTY test pauses Pi with `SIGSTOP` immediately after the Magic
   Context transform timing marker appears, proves that the submitted text has
   already left the editor, then resumes Pi with `SIGCONT`.

Keep no fixed sleep, extra render request, direct `renderNow()` call, Worker,
second scheduler, or Effect runtime in this path.

This fixes perceived submission freezing without changing either upstream
project. It does **not** reduce the time until the provider starts: Pi must await
the transformed messages. Reducing that computation time itself would require
an upstream incremental/prewarm API or changes inside Magic Context, neither of
which Pi Stuff can safely emulate with a small wrapper.

## Historical acceptance criteria

- The direct-interactive editor clears before Context transformation starts in
  a real tmux PTY capture.
- RPC and extension-authored input do not receive an artificial paint wait.
- The Context handler still runs exactly once and is awaited before provider
  invocation.
- Resume time is not increased by moving Context work to startup.
- No fixed-duration sleep remains in the final path.
- Context has no direct `TUI` reference and issues no render request.
- A normal submission emits no Package render request; Pi performs only its
  native keyboard-input paint.
- Rapid interactive inputs coalesce into one pending marker, and each Context
  event consumes that marker at most once.
- Session shutdown/reload cannot leave a pending marker attached to an old
  Context runtime generation.
- Focused tests verify ordering, and the existing fast repository check passes.
