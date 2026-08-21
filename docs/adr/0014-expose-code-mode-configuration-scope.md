---
status: accepted
amends: 0011-add-global-code-mode-default
---

# Expose Code Mode configuration scope in its dialog

## Decision

This extends ADR 0011 without changing its precedence or command contract. The `/codemode` Command Dialog displays the effective value and its source, a project value with `inherit`, `off`, and `on`, and the global default with `off` and `on`. Project inheritance removes only the owned `enabled` field and preserves other project settings. `/codemode on|off` remains project-scoped and `/codemode global on|off` remains available.

Untrusted projects cannot change the project row. A frozen child displays the frozen effective source and cannot mutate project or global settings. Persistence completes before the runtime projection changes; failure leaves the last durable snapshot visible. The dialog continues to use Pi's native SettingsList and the shared Command Dialog focus, Escape, draft, and restoration contract.
