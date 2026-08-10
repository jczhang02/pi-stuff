# Pi Stuff Codex

The Codex module contributes one `/codex` Command Dialog, Fast mode, Codex subscription usage, and the
selected `apply_patch`, `view_image`, and `imagegen` Tools to Pi Stuff. It does not replace Pi's provider, shell,
compaction, session, or TUI.

The Capability stays cold during import and startup. Usage performs network I/O only after `/codex` is opened, and
native helpers start only for an actual Tool call. Missing authentication, an unsupported model, or an unavailable
native helper becomes a bounded command or Tool error; ordinary Pi work remains available.

`imagegen` is enabled only for image-capable OpenAI Codex Responses models and always requests `gpt-image-2`.
The current certified native-helper target is Linux x64.

## Commands

- `/codex` opens the full-width, non-floating control surface and loads current usage.
- `/codex fast` toggles Fast mode. Enabled Codex requests carry the real `priority` service tier.
- `/codex usage` opens the same surface and refreshes usage.

## Tools

- `apply_patch` applies Codex patch envelopes without a shell wrapper.
- `view_image` loads a local image for image-capable Codex models.
- `imagegen` generates or edits images with `gpt-image-2` and saves results under `.pi/openai-codex-images/`.

All three Tools use the shared Pi Stuff Tool lifecycle renderer. Image Tools retain inline terminal media as a result
body below the shared lifecycle row.
