---
status: accepted
---

# Add Fast Resume

## Context

Pi's native `/resume` selector builds complete searchable metadata before showing the current project's Session list.
In the measured local corpus, 75 Sessions occupied about 432 MB and the native selector needed a median 1.7 seconds to
become usable after the Session layout had already been partitioned by cwd. Loading Pi Stuff did not explain the
structural delay: the Host still parsed complete JSONL histories before applying the Current Folder filter.

`pi-fast-resume@1.4.9` demonstrated the adequate loading strategy. It discovered files by metadata and read bounded
header and tail regions, making the same corpus interactive in tens of milliseconds. Installing that Package beside Pi
Stuff would create a second independently configured Extension. Registering only another slash command would not make
ordinary `/resume` fast.

The first Pi Stuff implementation reproduced the external project's selector as a custom Command Dialog. Acceptance
then clarified a stronger visible requirement: taking over `/resume` must not replace, approximate, or extend Pi's
native UI.

## Decision

Add Fast Resume as a Repository-owned Capability Module in the single Pi Stuff Package. Take over `/resume` in process,
but instantiate Pi's exported `SessionSelectorComponent` unchanged. Pi Stuff supplies only lightweight Current
Folder and All Sessions loader callbacks, the selected-Session callback, and Pi's rename callback. The Host component
remains the sole owner of rendering, search and sort behavior, keyboard handling, responsive layout, rename, confirmation, delete,
refresh, and error presentation.

Fast Resume bounds transcript parsing rather than Session-name lookup. It discovers candidates from Pi's active Session
directory and reads at most 1 MiB from each file front while parsing only complete JSONL lines. Files that fit the
window are parsed in full; oversized files stop transcript parsing once the Session header and first non-empty user
message are known. One scope-wide byte scan then finds valid `session_info` lines across the complete oversized files,
so the latest Session name is authoritative regardless of its position. The certified Ubuntu host uses
`/usr/bin/grep` for this scan; Pi's public complete-history loader preserves correctness when that executable fails
or its bounded output is exceeded. Fast Resume does not build a full-text index, retain transcript bodies, or write a
cache.
Files are processed in batches of 50 and report progress through the native loader contract. Current Folder is loaded
first; All Sessions is loaded only when the native component requests that scope.

The returned `SessionInfo` values intentionally contain only bounded searchable text. Search covers Session ID, the
authoritative resolved name, cwd, and all visible user and Assistant text when a file fits the forward window. For
oversized files, later messages can be absent, message counts can be lower than complete-history counts, and filesystem
modification time stands in for unavailable last-message activity. A later metadata-only append can therefore affect
ordering. The native component does not receive extra labels or controls for these limits, because exact visual
behavior is the accepted contract. Users who need complete-history search or exact message counts and activity can
disable interception and use Pi's original loader.

Pi remains the Session lifecycle owner. Fast Resume hands selection to `switchSession`; Pi owns validation, loading,
transcript replay, cwd change, and terminal behavior. Rename and confirmed deletion are native component behavior.
Delete protects the active Session, tries the platform trash command, and permanently unlinks the Session file when
trash is unavailable or fails, matching the explicit product decision.

Fast Resume takes over `/resume` by default through a narrow certified Host adapter that replaces
`InteractiveMode.showSessionSelector` only in process memory. Pi's installed files are never changed. The adapter
retains the original method, delegates to it when no current command context is available, restores it on cleanup only
when it still owns the slot, and reports a Diagnostic Record when the certified seam is absent. When interception is
disabled or cannot install, Pi Stuff registers `/fast-resume`; an optional configured Host key ID opens the same native
component with lightweight loaders. This private adapter is an explicit compatibility exception, not general
permission to override built-in commands.

Each selector open receives a child owner from the shared Effect Foundation. Loader invocations run as owned operations;
closing the native surface shuts down that owner and interrupts outstanding work. The native component's own scope and
sequence checks remain authoritative for late results. Synchronous filesystem calls and the bounded-output metadata
scan remain in a native adapter because the Host opens the selector synchronously and Effect cannot preempt native
operations that do not cooperate.

The `fastResume` namespace in `<agentDir>/pi-stuff.json` retains the upstream meanings: `hijackResume` defaults to
`true`, and optional `shortcut` is a Pi key ID. Startup reads only and never creates, migrates, or rewrites settings.
Malformed namespace values fail closed to defaults and emit a bounded Diagnostic Record.

The loading design is derived from `monotykamary/pi-fast-resume` version 1.4.9 at commit
`aa7a4dbe1be9f9c74b1110f6b797fa1e45a61572`. Its MIT declaration and attribution remain in the Module's third-party
notice. The adapted Source receives no provenance-based quality exception.

## Considered options

- **Install `pi-fast-resume` as another Package:** rejected because it would duplicate Package, configuration,
  lifecycle, UI, and release ownership.
- **Keep the custom Pi Stuff selector:** rejected after ablation. It duplicated the Host's rendering, search, sort,
  navigation, rename, delete, and responsive behavior and could not guarantee native UI parity.
- **Register only `/fast-resume`:** rejected as the default because the requested everyday entry is `/resume`;
  retained as the public fallback when interception is disabled or unavailable.
- **Modify the installed Pi Host:** rejected because upgrades replace the artifact and Pi Stuff must not install or
  rewrite its Host.
- **Temporarily replace `SessionManager.list`:** rejected because it broadens mutation of Host internals beyond the
  selector call and introduces restoration races. Supplying loaders to the exported component is narrower.
- **Keep fixed head and tail reads only:** rejected after named Sessions with middle-file `session_info` records fell
  back to their first prompt while Pi's native loader displayed the authoritative name.
- **Add a persistent complete-history index:** rejected because the scope-wide metadata scan preserves exact names below
  the latency ceiling without adding privacy, invalidation, migration, or lifecycle state.
- **Keep deletion trash-only:** rejected by explicit product decision; confirmed permanent unlink remains native Host
  behavior.

## Consequences

Ordinary resume work uses Pi's actual selector while avoiding complete-history JSON parsing. The implementation adds no
custom selector state machine, search engine, mutation service, network, cache, database, standalone Package, or Host
file mutation.

The Capability depends on the certified private interception seam and the exported native selector contract. A future
Pi release can disable interception until both are recertified; native `/resume` and public `/fast-resume` remain
recovery routes. Exact native UI also means Fast Resume cannot add visual qualifiers for bounded metadata without a
separate product decision.
