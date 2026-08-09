---
"@jczhang02/pi-stuff": patch
"@jczhang02/pi-stuff-agents": patch
"@jczhang02/pi-stuff-codex": patch
"@jczhang02/pi-stuff-work": patch
---

Harden Agent and Background Work lifecycle ownership across concurrent launch, session shutdown, Host crash, steering acknowledgement, terminal persistence, and cold recovery without inventing completion or releasing live process authority. Use Bun's native subprocess transport so Codex native tools receive direct stdin reliably.
