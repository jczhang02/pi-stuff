---
"@jczhang02/pi-stuff": patch
"@jczhang02/pi-stuff-agents": patch
"@jczhang02/pi-stuff-context": patch
"@jczhang02/pi-stuff-tools": patch
"@jczhang02/pi-stuff-ui": patch
"@jczhang02/pi-stuff-work": patch
---

Certify Pi 0.84.1 and share Suite state through the Host event bus instead of per-extension event-facade identity. Preserve unified dialogs, Statusline restoration, Tool Activity metadata, Context ownership, Current Work sources, settings, and lifecycle deduplication across independently loaded extensions, and defer subagent steering until the child Agent turn is ready.
