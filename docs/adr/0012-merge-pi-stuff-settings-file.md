---
status: accepted
amended_by: 0013-unify-web-configuration
---

# Consolidate Pi Stuff settings into one merged JSON file

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

At the time of this decision, `web-search.json` was excluded from consolidation. ADR 0013 later amended that exception
and made the `web` namespace in `pi-stuff.json` canonical.

## Decision

Consolidate the six settings files into a single JSON document at `<agentDir>/pi-stuff.json`. The new global Code Mode
default from ADR 0011 also uses this document, without introducing a legacy file. Each Capability owns one
top-level **namespace** (a JSON object key) inside that file and reads and writes only its own section. Sibling
namespaces are preserved across writes, so a Capability never edits another Capability's section.

### Shared I/O layer

A new `packages/pi-stuff/src/shared/settings-io/` module owns all persistence concerns:

- `paths.ts` — pure path helpers (`mergedSettingsPath`, `resolveSettingsLockPath`, `MERGED_SETTINGS_FILE`). This file
  imports no runtime capabilities, so it is safe to load in Node-only module graphs (compiled Goal upstream tests run
  under Node).
- `file.ts` — `readSettingsFile`/`writeSettingsFile` (async) and `readSettingsFileSync`/`writeSettingsFileSync` (sync,
  for Goal's hot-path load) plus `readNamespace`/`mergeNamespaceRecord` (and sync variants). Reads and writes use
  plain JSON (`JSON.parse` / `JSON.stringify`); the file is a plain `pi-stuff.json` with no comment support.
  Writers emit tab-indented JSON for deterministic machine output.
- `lock.ts` — the `flock`-based exclusive lock and locked merge/migration helpers, factored from the legacy
  per-Capability locks. It imports `bun:ffi`, so it is **not** re-exported through the `index.js` barrel. Bun-based
  Capability writers import it directly; Goal reaches it only through a dynamic production adapter. This keeps
  `bun:ffi` out of Node-only module graphs; Capability modules included in Goal's upstream Node profile load it only
  from Bun-only write and migration paths.
- `store.ts` — `NamespacedSettingsStore<T>`, an optional higher-level store (used by codex) that wires together the
  namespace reader, writer, lock (injected, not statically imported), subscription, and one-time legacy migration.

### Single-file lock

All settings namespaces share **one** `flock` lock over `pi-stuff.json` (or `pi-stuff.json.lock` beside it, under
`$XDG_RUNTIME_DIR/pi-stuff/` when available). Concurrent writes from different Capabilities serialize through that one
lease instead of one lock per file. This is acceptable because settings writes are low-frequency, user-triggered
operations; serialization overhead is negligible.

### Format

The file is plain JSON (`JSON.parse` / `JSON.stringify`, no comments). Both reads and writes are plain JSON — there
is no JSONC support. Per the project decision, jsonc as the written format was rejected: writes stay plain JSON, and
the reader is plain JSON as well (no comment tolerance).

### Legacy migration

Each Capability that had a pre-existing per-file config performs a **one-time lift**: on first load, if the merged
file has no entry for that namespace but the legacy file exists, the legacy content is parsed and seeded into the
namespace, then persisted, and the legacy file is **deleted**. There is no `.bak` retention (per the project decision).

### Original exclusion: `web-search.json`

This section records the superseded part of the original decision. See ADR 0013 for the current Web configuration and
on-demand secret-resolution contract.

## Consequences

- The Pi Stuff settings footprint in `~/.config/pi/` drops from six files to one (`pi-stuff.json`). Existing legacy
  files are migrated transparently on first load and deleted afterward.
- A Capability module no longer reimplements read/write/lock/atomic-rename; it calls into `shared/settings-io`.
  Adding a new Capability-owned setting adds a namespace, not a new file.
- The whole file is one locked, atomically-replaced document. A write from one Capability briefly serializes behind
  the same lock as a write from another, but this is a low-frequency path and the cost is negligible.
- `bun:ffi` (the flock lock) is isolated to `lock.ts` and is not pulled into the barrel export, so compiled Goal
  upstream tests that run under Node do not load it.
- `schemaVersion` remains per-namespace (each Capability owns its own versioning and migration logic). There is no
  top-level file schema version; the file is a plain container of independent namespaces.

## References

- ADR 0009 — Code Mode project-scoped opt-in (amended by ADR 0011 for the global namespace).
- ADR 0011 — Code Mode global default (one namespace occupant of this merged file).
