# Prefer host-managed API-key storage

[简体中文](../i18n/zh-CN/adr/0004-host-api-key-storage.md) · English is normative.

Pi Stuff prefers Pi's host-managed `auth.json` for persisted API keys, rather than adding secrets to ordinary `pi-stuff.json` settings or maintaining another credential file. This keeps ordinary configuration backups separate from secrets and reuses the host's authentication lifecycle. The maintainer accepted this trade-off in the [Exa authentication amendment](https://github.com/jczhang02/pi-stuff/issues/45#issuecomment-5644351201).

For Exa, follow the host helper's precedence: **saved credential before `EXA_API_KEY`**. Environment-only setup remains possible, but an authentication rejection must not silently retry another key. Register Exa for authentication only, without chat models or stream implementations; resolve required credentials through the host on subsequent searches, without `/reload`. OpenAI/Codex continue to use their existing host authentication; this decision does not impose a new universal precedence chain on them.

An environment-only design would move persistence into shell or launcher configuration; a key field in ordinary settings would complicate Git/cloud backups. A separate Pi Stuff store would duplicate host responsibilities. Reusing the host avoids those costs but inherits its limitations: `auth.json` is plaintext, owner-only permissions are not encryption or same-user isolation, and secrets still need exclusion from ordinary synchronization and separately protected backups. The [Web access guide](../web-access.md) documents login, logout and version-specific host limitations; Pi Stuff does not replace the host login UI.
