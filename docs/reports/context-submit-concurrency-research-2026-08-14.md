# Context submission concurrency research

Date: 2026-08-14  
Status: historical research

This report keeps the render-order facts from the first submission-latency investigation. Its proposed event-loop
barrier and its rejection of a Worker are historical. Current behavior is recorded in
[ADR 0019](../adr/0019-isolate-context-engine-work-from-the-host-ui-thread.md) and the
[Context Management guide](../capabilities/context-management.md).

## Question

Could Pi paint a submitted prompt before a long Context transformation, and could that transformation run without
blocking the Host UI thread?

## Retained findings

- Pi receives Enter before the visible stall. The stall begins when synchronous Context work occupies the JavaScript
  thread before the submitted state reaches the terminal.
- Pi awaits each `context` handler before invoking the Provider. Starting the Provider early would send the wrong
  message list.
- `requestRender(force?)` schedules work; `renderNow(force?)` renders synchronously. Neither exposes a portable signal
  that the terminal emulator has painted the frame.
- An event-loop yield can let an already scheduled input render run first. It changes ordering, not CPU concurrency.
- The Magic Context integration inspected for this study exposed no public split-phase or prewarm operation that could
  separate expensive pure work from the final Context commit.
- Stream drain and tmux flow control describe buffered transport, not physical pixel paint.

The primary implementation references were Pi's
[extension runner](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/runner.ts)
and [TUI](https://github.com/earendil-works/pi/blob/main/packages/tui/src/tui.ts), the
[Magic Context handler](https://github.com/cortexkit/magic-context/blob/master/packages/pi-plugin/src/context-handler.ts),
and the Node and Bun event-loop documentation.

## Current disposition

Context projection now runs in one Context Engine Worker:

- The exact pinned engine and Worker entry are bundled into one in-memory Bun artifact and started from a Blob URL.
- Pi still owns input, Transcript rendering, Sessions, Provider requests, and Agent lifecycle.
- The first bind and a branch discontinuity send an immutable Session snapshot. Ordinary projection sends only the
  new leaf.
- Worker effects are limited to `appendEntry`, `sendMessage`, `sendUserMessage`, `notify`, and `setStatus`.
  `appendCompaction` uses one bounded synchronous response while blocking only the Worker.
- A failed effect, mirror mismatch, or fatal Worker error returns the request to Pi's native Context path. Shutdown
  waits for one bounded grace period and then terminates the Worker.

The Context runtime may still yield for input ordering. That yield is not the concurrency boundary; the Worker keeps
the expensive engine work off the Host UI thread.

## Discarded intermediate design

The first implementation used one `setImmediate` turn before synchronous transformation. It replaced an experimental
17 ms delay and avoided direct `renderNow()` or forced-render calls, but it could not prevent CPU-heavy Context work
from blocking later frames.

The study also considered early Provider invocation, startup prewarm, direct rendering, fixed sleeps, periodic yields,
and Effect v4. They either violated Pi's Context ordering, duplicated state, changed only scheduling, or added a runtime
without moving the work off-thread. The former conclusion that a Worker required a second Magic Context integration
was superseded once the bounded snapshot and Host-effect bridge was implemented.

## Acceptance boundary

Current acceptance uses a real Pi TUI and a long resumed Session, bounds prompt paint and Working-frame stalls, checks
the Provider projection, and exercises a Context Tool with a supported model. The current contract lives in the
[Context Management Module README](../../packages/pi-stuff/src/context-management/README.md); this report is not an
implementation checklist.
