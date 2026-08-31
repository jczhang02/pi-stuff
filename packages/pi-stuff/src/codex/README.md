# Codex

[Simplified Chinese](../../../../docs/i18n/zh-CN/packages/pi-stuff/src/codex/README.md)

Fast mode, usage visibility, and native Tools for supported OpenAI Codex Responses models.

## Quick start

```text
/login openai-codex
/codex
```

Use `/codex fast` to toggle priority service and `/codex usage` to refresh current allowance.

## Highlights

- Activates only for supported `openai-codex` Responses models.
- Persists Fast mode in the merged Pi Stuff settings.
- Shows weekly and five-hour remaining allowance when available.
- Keeps Codex usage refresh process-local and bounded.
- Exposes `apply_patch` and, for image-capable models, `view_image` and `imagegen`.
- Adds Fast and weekly remaining state to the shared Statusline.

## Documentation

- [Codex guide](../../../../docs/capabilities/codex.md)
- [Command reference](../../../../docs/reference/commands.md#codex-and-rtk)
- [Settings reference](../../../../docs/reference/settings.md#codex)
- [Troubleshooting](../../../../docs/troubleshooting.md#codex-and-code-mode)

