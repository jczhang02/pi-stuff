---
status: accepted
---

# Initialize configured Context before editor readiness

When a Session already has a recognized Magic Context configuration with no pending file migration, Pi Stuff completes the official module load, factory initialization, SQLite setup, and `session_start` handling before the editor is reported ready. This deliberately trades slower process startup for native-like message submission: no module, database, or synthetic frame wait remains on the normal Enter-to-provider path.

A missing configuration or legacy configuration still leaves Context dormant until a direct user action authorizes creation or migration. Startup may initialize rebuildable derived Context state, but it must not create, rewrite, or migrate user configuration; failure remains fail-open to Pi native context and can retry on later accepted work.
