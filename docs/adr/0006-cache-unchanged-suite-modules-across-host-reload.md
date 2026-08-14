---
status: accepted
---

# Cache unchanged Suite modules across Host reload

Pi 0.84.2 creates a new Jiti loader with its runtime module cache disabled for every `/reload`. That preserves source
editing semantics, but the Pi Stuff Package has a large TypeScript module graph: evaluating it again dominated an
otherwise short Host reload even though the Suite source had not changed. Shipping compiled JavaScript would reduce
that cost, but it would create the forbidden second `dist/` lane and make source and runtime artifacts diverge.

The generated Package entry will remain a small TypeScript wrapper. It fingerprints the complete `src/` tree and keeps
one imported Suite runtime namespace in a process-global, source-root-keyed cache. An unchanged `/reload` reuses only
that module namespace. It still runs the Suite factory and every Capability installer with the new `ExtensionAPI`, so
the Host receives fresh handlers, tools, commands, UI bindings, and lifecycle ownership.

Pi emits `session_shutdown` with reason `reload` before it invalidates the old Extension runner. Session-scoped Module
state must therefore be released by that event. Process-scoped caches that intentionally survive an unchanged reload
remain the responsibility of their owning Capability and must not retain a stale Host API or session UI context.

The source cache has these rules:

- normalize the Package source root with `realpath` and isolate entries by that root;
- fingerprint every file, directory, and symlink under `src/` using deterministic path and filesystem metadata;
- deduplicate concurrent loads;
- remove a rejected import so a later reload can recover;
- on an unchanged fingerprint, reuse the namespace and rerun all installers;
- on a changed fingerprint or failed prior import, create a fresh Jiti loader with `moduleCache` and `fsCache` disabled,
  so changed nested modules are re-evaluated without a startup write;
- use the Host-provided Pi module namespaces as Jiti virtual modules so the refresh path works in the certified Bun
  binary as well as the source checkout.

The generated ordered composition moves to `src/suite-runtime.ts`; `index.ts` remains the only Pi Extension entry. Both
files are generated from `suite.json`. The Package continues to ship TypeScript source only.

## Consequences

- Ordinary unchanged reloads avoid re-evaluating the heavy Module graph while preserving fresh Extension
  registrations.
- Editing any nested Suite source invalidates the cache and favors correct source behavior over reload latency.
- A source-changing refresh is deliberately slower because Pi Stuff does not write a private transpilation cache.
- The Package gains one exact runtime dependency on Jiti for the uncommon source-refresh path.
- Lifecycle acceptance must prove both paths: unchanged reload reuses the namespace, while a nested source edit is
  observed after reload.
- This cache does not replace Pi Package discovery, sessions, the Extension runner, or the Host's reload command.
