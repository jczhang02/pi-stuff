---
status: accepted
---

# Use one merged settings file with read-only startup

## Context

Before this ADR, Pi Stuff owned **six** separate per-Capability settings files in Pi's agent directory
(`getAgentDir()`), each with its own ad-hoc reader, writer, lock, and atomic-rename logic:

| File | Capability | Namespace |
| --- | --- | --- |
| `pi-stuff-ui.json` | conversation-ui | `ui` |
| `pi-stuff-tools.json` | tool-display | `tools` |
| `pi-stuff-rtk.json` | rtk | `rtk` |
| `pi-stuff-codex.json` | codex | `codex` |
| `pi-stuff-notification.json` | notification | `notification` |
| `pi-goal.json` | goal | `goal` |

Each module reimplemented: a path resolver, a `JSON.parse`-based reader, a temp-file-`rename` writer with `0o600`
permissions, a `flock`-based exclusive lock (where concurrency mattered), and a per-file diagnostic-on-corruption
fallback to defaults. The duplication was substantial, the file count was growing, and there was no shared place for
cross-Capability settings concerns.

Web originally used `web-search.json`, and the first consolidation implementation migrated other legacy files during
Suite startup. Both exceptions conflicted with the desired single-file shape or the pure startup boundary.

## Decision

Consolidate Pi Stuff settings into a single JSON document at `<agentDir>/pi-stuff.json`. The global Code Mode default
from ADR 0009 also uses this document, without introducing a legacy file. Each Capability owns one
top-level **namespace** (a JSON object key) inside that file and reads and writes only its own section. Sibling
namespaces are preserved across writes, so a Capability never edits another Capability's section.

### Shared I/O layer

A new `packages/pi-stuff/src/shared/settings-io/` module owns all persistence concerns:

- `paths.ts` — pure path helpers (`mergedSettingsPath`, `resolveSettingsLockPath`, `MERGED_SETTINGS_FILE`). This file
  imports no runtime capabilities, so it is safe to load in Node-only module graphs (compiled Goal upstream tests run
  under Node).
- `file.ts` — the narrow native filesystem adapter. Its Effect readers and atomic namespace merge wrap private
  asynchronous filesystem operations. Only the synchronous read/write primitives used by Goal's explicit legacy-state
  cleanup remain exported. Reads and writes use plain JSON (`JSON.parse` / `JSON.stringify`); the file is a plain
  `pi-stuff.json` with no comment support. Writers emit tab-indented JSON for deterministic machine output.
- `lock.ts` — the `flock`-based exclusive lock, factored from the legacy
  per-Capability locks. It imports `bun:ffi`, so it is **not** re-exported through the `index.js` barrel. Bun-based
  Capability writers import it directly; Goal reaches it only through a dynamic production adapter. This keeps
  `bun:ffi` out of Node-only module graphs; Capability modules included in Goal's upstream Node profile load it only
  from Bun-only write paths. The native lease primitive remains inside this adapter; its Effect resource keeps lock
  polling cancellable and always closes the acquired file handle when its Scope ends.
- `store.ts` — `EffectNamespacedSettingsStore<T>`, which owns serialized commits, namespace reads and writes,
  subscription, diagnostics, and read-only legacy fallback. Persistence is uninterruptible only for the short locked
  read/merge/atomic-rename critical section.

### Single-file lock

All settings namespaces share **one** `flock` lock over `pi-stuff.json` (or `pi-stuff.json.lock` beside it, under
`$XDG_RUNTIME_DIR/pi-stuff/` when available). Concurrent writes from different Capabilities serialize through that one
lease instead of one lock per file. This is acceptable because settings writes are low-frequency, user-triggered
operations; serialization overhead is negligible.

### Format

The file is plain JSON (`JSON.parse` / `JSON.stringify`, no comments). Both reads and writes are plain JSON — there
is no JSONC support. Per the project decision, jsonc as the written format was rejected: writes stay plain JSON, and
the reader is plain JSON as well (no comment tolerance).

### Read-only legacy compatibility

Suite import and Session startup never lock, create, rewrite, rename, migrate, or delete user configuration. When a
canonical namespace is absent, a Capability may read its valid legacy file as an in-memory fallback through
`legacyReader`. A later explicit settings action writes the canonical namespace through its owner, preserves sibling
namespaces, and leaves the legacy file untouched. The canonical namespace wins on later loads.

Web follows the same startup rule but has one explicit-update exception: when its canonical namespace is absent, a
direct Web configuration update may lift the complete legacy object under the shared lock and delete the legacy file
only after the canonical write succeeds.

### Web credentials

Web owns the `web` Settings Namespace and keeps its established field names and nested shapes. Credential fields may
contain literal values, environment references, legacy explicit command sources, or 1Password `op://` references.
A secret reference remains inert until the selected provider requests it. Resolution invokes `op read` with an
argument vector rather than a shell, forwards only the documented minimal environment, bounds waiting and output,
honors cancellation, and excludes the reference, arguments, stderr, and resolved value from diagnostics. Resolved
values are neither persisted nor retained beyond that provider operation.

## Consequences

- New settings persist in one `<agentDir>/pi-stuff.json` document. Existing legacy files remain read-only fallbacks
  until an explicit change creates the canonical namespace; they are not deleted automatically.
- A Capability module no longer reimplements read/write/lock/atomic-rename; it calls into `shared/settings-io`.
  Adding a new Capability-owned setting adds a namespace, not a new file.
- The whole file is one locked, atomically-replaced document. A write from one Capability briefly serializes behind
  the same lock as a write from another, but this is a low-frequency path and the cost is negligible.
- Effect-owned settings mutations queue through one store gate. A failed mutation leaves the live value unchanged,
  releases the file lock, and does not poison later mutations or the idle drain.
- The shared settings barrel exposes Effect operations rather than a Promise runner API; native Promises stay private
  to the filesystem and lock adapters.
- `bun:ffi` (the flock lock) is isolated to `lock.ts` and is not pulled into the barrel export, so compiled Goal
  upstream tests that run under Node do not load it.
- `schemaVersion` remains per-namespace (each Capability owns its own versioning and migration logic). There is no
  top-level file schema version; the file is a plain container of independent namespaces.
- Suite startup remains observational: loading the Package cannot mutate configuration merely because legacy state
  exists.
- Secret resolution is delayed until use and cannot leak the secret source or value through diagnostics or storage.

## Rejected alternatives

- **One settings file per Capability:** rejected because it duplicates parsing, locking, atomic writes, and diagnostics
  while providing no useful independent lifecycle.
- **JSONC output:** rejected because a machine-owned merged document can use deterministic plain JSON without a second
  parser or comment-preservation policy.
- **Automatic startup migration:** rejected because Package loading must not mutate user configuration before direct
  interactive or RPC input.

## Consolidation history

This ADR incorporates the Web namespace and on-demand secret decision formerly recorded in ADR 0013 and the read-only
startup rule formerly recorded in ADR 0023. Those files are removed because both decisions now define the same merged
settings boundary.

## References

- ADR 0009 — Code Mode project override, global default, and effective precedence.
