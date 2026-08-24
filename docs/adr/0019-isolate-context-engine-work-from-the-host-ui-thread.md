---
status: accepted
---

# Isolate Context engine work from the Host UI thread

Magic Context projection executes inside one Context Engine Worker. Pi remains the Host and continues to own input,
Conversation Transcript rendering, Sessions, model requests, and Agent lifecycle. Context Management does not render a
second copy of submitted input or call a synthetic refresh API.

The adapter lazily bundles the exact pinned Magic Context package and its worker entry into one in-memory Bun artifact,
then starts it from a Blob URL. This happens during the configured Context initialization already governed by ADR 0007.
The artifact is not written to disk, published, or installed, and the upstream package is neither forked nor patched.
The bundle preserves the upstream package's original `import.meta.url` so package-relative resources and version
identity keep their official semantics.

Pi event, Tool, and command registrations remain in the Host. Each invocation sends an immutable Context snapshot to
the worker. The complete Session branch crosses the boundary only for Context projection, fork initialization, and the
three explicit history-rebuild commands; ordinary lifecycle events, status/flush commands, and Tools do not copy it.
After Pi persists a message, the adapter sends only the new leaf entry so the engine's delayed index keeps a current
read-only branch. Worker-to-Host effects are explicitly limited. The one SessionManager operation that the pinned
upstream API requires synchronously, `appendCompaction`, uses a bounded shared-memory response while blocking only the
worker. Shutdown terminates the worker and revokes its in-memory URL.

## Alternatives rejected

- Rendering or refreshing the submitted prompt from the adapter creates a second visible authority and caused full-frame
  refresh and stuck-Working regressions.
- Deferring the same Magic Context call with a timer still lets CPU-heavy projection monopolize Pi's UI thread.
- Loading an external module graph directly from a worker is not reliable in the certified standalone Pi binary: bare
  imports do not resolve there, while absolute external entry URLs crashed the standalone Bun worker path. The single
  in-memory bundle is the smallest deterministic loader at this boundary.
- Forking Magic Context would duplicate upstream ownership without changing the Pi-facing seam.

## Consequences

Configured startup pays one worker build/start cost before editor readiness and one worker's memory while Context is
active. In return, a healthy Magic Context projection can run concurrently with Pi's native input paint and Working
animation. Acceptance must use a real Pi TUI with a long resumed Session containing malformed image history, require the
submitted prompt in the Conversation Transcript within 150 ms, observe advancing Working frames, and confirm that the
Provider request still contains the Magic Context projection. A real supported model smoke test must also exercise a
Magic Context Tool successfully.
