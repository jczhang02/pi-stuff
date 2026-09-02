---
status: accepted
---

# Add Fast Resume

## Context

Pi's native `/resume` selector builds complete searchable metadata before showing the current project's Session list.
In the measured local corpus, 75 Sessions occupied about 432 MB and the native selector needed a median 1.7 seconds to
become usable after the Session layout had already been partitioned by cwd. Loading Pi Stuff did not explain the
structural delay: the Host still parsed complete JSONL histories before applying the Current Folder filter.

`pi-fast-resume@1.4.9` demonstrated the adequate alternative. It discovered files by metadata, read bounded header
and tail regions, and presented a progressive list in about 44 ms to first interaction on the same corpus. It also
established the requested functional surface: Current and All scopes, flat and directory views, three search modes,
sorting, Named-only filtering, refresh, rename, confirmed deletion, configurable shortcut, progressive loading, and
in-process interception of Pi's native selector.

Installing that Package beside Pi Stuff would create a second independently configured Extension and duplicate visual,
settings, lifecycle, and compatibility authorities. Registering only another slash command would avoid private Host
integration but would not satisfy the requirement that ordinary `/resume` use the fast selector.

## Decision

Add Fast Resume as a Repository-owned Capability Module in the single Pi Stuff Package. Preserve the observable
`pi-fast-resume@1.4.9` interaction and configuration contract while adapting ownership to Pi Stuff's Command Dialog,
merged settings, diagnostics, Effect scopes, tests, and Suite composition.

Fast Resume reads only bounded Session regions. It discovers candidates from Pi's active Session directory, sorts by
filesystem modification time, reads complete JSONL lines from the front until the Session header and first user
message are known, and examines a bounded tail window for the latest name metadata. It does not build a full-text
index, retain transcript bodies, or write a cache. The newest 30 Current Folder candidates form the first paint;
remaining Current Folder work completes before All Sessions begin, and All Sessions stream in bounded batches.

The selector provides Current Folder and All scopes, a Threaded directory presentation, flat Recent and Fuzzy presentations, Named-only filtering, fuzzy search, fully quoted exact search, `re:<pattern>` regular-expression search, manual refresh, rename, and confirmed deletion. Search is limited to Session ID, resolved name, cwd, and first
user message. Names outside the bounded tail window may be absent and message counts remain partial-read estimates. These are
visible speed-for-completeness boundaries, not hidden claims of parity with Pi's complete-history index.

Pi remains the Session lifecycle owner. Fast Resume hands selection to `switchSession`, and Pi owns validation,
loading, transcript replay, cwd change, and terminal behavior. Rename uses Pi's Session metadata writer. Delete protects
the active Session, asks for confirmation, tries the platform trash command with a deadline, and permanently unlinks
the Session file when trash is unavailable or fails, matching the accepted upstream behavior.

Fast Resume takes over `/resume` by default through a narrow certified Host adapter that replaces
`InteractiveMode.showSessionSelector` only in process memory. Pi's installed files are never changed. The adapter
retains the original method, delegates to it when no current command context is available, restores it on cleanup only
when it still owns the slot, and reports a Diagnostic Record when the certified seam is absent. When interception is
disabled or cannot install, Pi Stuff registers `/fast-resume`; an optional configured Host key ID opens the same
selector. This private adapter is an explicit compatibility exception, not a general permission to override built-in
commands.

The shared Command Dialog owns the visible state. It preserves editor draft and Suite chrome, uses Pi theme roles and
cell-width fitting, keeps focus by Session path as progressive updates arrive, and places search, scope, view, sort,
filter, loading, rename, confirmation, and error state in one surface. Control characters and unsafe path text are
normalized before display.

Effect owns capability and Dialog lifetimes, scoped background batches, debounce timing, interruption intent,
generation fences, filesystem/process failure projection, and cleanup. Bounded synchronous filesystem and subprocess
calls remain behind Fast Resume native adapters because the Host's selector opens synchronously and Effect interruption
cannot preempt a native operation that does not cooperate. Each operation is therefore kept small or time-bounded;
new batches check generation before publication. Session replacement, reload, Dialog close, refresh, and Host shutdown
cancel obsolete work and prevent late UI updates.

The `fastResume` namespace in `<agentDir>/pi-stuff.json` retains the upstream meanings: `hijackResume` defaults to
`true`, and optional `shortcut` is a Pi key ID. Startup reads only and never creates, migrates, or rewrites settings.
Malformed namespace values fail closed to defaults and emit a bounded Diagnostic Record.

The imported design is derived from `monotykamary/pi-fast-resume` version 1.4.9 at commit
`aa7a4dbe1be9f9c74b1110f6b797fa1e45a61572`. Its MIT declaration and attribution remain in the Module's third-party
notice. The adapted Source receives no provenance-based quality exception.

## Considered options

- **Install `pi-fast-resume` as another Package:** rejected because it would duplicate Package, configuration,
  lifecycle, UI, and release ownership.
- **Register only `/fast-resume`:** rejected as the default because the requested everyday entry is `/resume`;
  retained as the public fallback when interception is disabled or unavailable.
- **Modify the installed Pi Host:** rejected because upgrades replace the artifact and Pi Stuff must not install or
  rewrite its Host.
- **Add a persistent complete-history index:** rejected because bounded reads already meet the latency goal and an
  index would add data lifecycle, privacy, invalidation, and migration work not required by the accepted behavior.
- **Make bounded metadata exact:** rejected because exact names, counts, and complete-history search require more I/O
  or persistent indexing. The selector states the approximation and preserves native resume as the complete path.
- **Keep deletion trash-only:** rejected by explicit product decision; the confirmed permanent-unlink fallback is part
  of the accepted behavior.

## Consequences

Ordinary resume work becomes interactive before complete Session histories could be parsed, while the Host continues
to own the selected Session. The implementation adds no network, cache, database, standalone Package, or Host file
mutation.

The Capability depends on a certified private Host seam. A future Pi release can disable interception until the adapter
is recertified; native `/resume` and public `/fast-resume` remain recovery routes. Bounded reads also mean users must
choose native resume when exact complete-history search or metadata is more important than latency.
