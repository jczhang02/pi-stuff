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

The bundled fork is pinned to signed release `pi-stuff-v0.33.1-2`. Exact source
and artifact provenance are recorded in [UPSTREAM.md](./UPSTREAM.md).
