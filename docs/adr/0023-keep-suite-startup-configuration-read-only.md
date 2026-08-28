---
status: accepted
amends: 0012-merge-pi-stuff-settings-file
---

# Keep Suite startup configuration read-only

## Context

ADR 0012 consolidated Capability settings into `<agentDir>/pi-stuff.json` and migrated older per-Capability files on
first load. That migration acquired a lock, wrote the merged file, and deleted the legacy file while the Extension was
starting. This conflicts with the Package boundary that startup may inspect configuration but must not create,
rewrite, or migrate it before direct interactive or RPC input.

## Decision

The merged namespace remains canonical. When that namespace is absent, UI, Tools, RTK, Codex, Notification, and Goal
may read their valid legacy file as an in-memory compatibility fallback. Startup does not lock, persist, rename, or
delete either file. A later explicit settings change writes the canonical namespace through its existing owner and
leaves the legacy file untouched; the canonical namespace takes precedence on later loads.

The shared `NamespacedSettingsStore` exposes this behavior as a `legacyReader`, not a migrator. Custom settings stores
follow the same read-only load contract. Web retains ADR 0013's separate rule: its legacy lift happens only during a
direct configuration update, never during startup.

## Consequences

- Loading the Suite cannot mutate user configuration solely because an older settings file exists.
- Existing preferences remain effective until the user changes them explicitly.
- A legacy file may remain beside `pi-stuff.json`; it is inert once the canonical namespace exists and can be removed
  manually.
- Explicit writes still preserve sibling namespaces and use the shared lock and atomic-write path.
