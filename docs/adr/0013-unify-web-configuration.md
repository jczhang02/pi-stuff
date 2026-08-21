---
status: accepted
amends: 0012-merge-pi-stuff-settings-file
---

# Unify Web configuration and resolve secret references on demand

## Decision

This amends ADR 0012 only where it excluded `web-search.json` from the merged settings file. Web owns the `web`
top-level namespace in `<agentDir>/pi-stuff.json`. Its existing field names and nested shapes remain unchanged. The Web Module reads the canonical namespace first and falls back to the legacy `<agentDir>/web-search.json` only when the namespace is absent. A direct Web configuration update lifts the complete legacy object under the shared settings lock, preserves sibling namespaces, and deletes the legacy file only after the canonical write succeeds.

The merged file remains plain JSON with mode `0600`. Web configuration reads never create or migrate files during Extension import or Session startup.

Credential fields may contain literal values, environment references, legacy explicit command sources, or 1Password secret references beginning with `op://`. A secret reference remains inert configuration data until a provider request calls the existing credential-resolution seam. That seam invokes `op read` with an argument vector, never a shell, forwards only the documented minimal environment, bounds waiting and output, honors cancellation, and never includes the reference, stderr, command arguments, or resolved value in diagnostics. Resolved values are not persisted or retained beyond the provider operation.

## Consequences

All provider configuration observes one canonical document and explicit updates become coherent immediately. The shared parser must keep syntax errors secret-safe because the merged document may contain literal credentials. Users who want interactive 1Password authorization receive it only when the selected provider first needs the reference; cancellation or failure ends that Web operation without affecting the rest of Pi Stuff.
