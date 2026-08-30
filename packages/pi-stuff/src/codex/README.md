# Pi Stuff Codex

The Codex module contributes one `/codex` Command Dialog, Fast mode, Codex subscription usage, and the
selected `apply_patch`, `view_image`, and `imagegen` Tools to Pi Stuff. It does not replace Pi's provider, shell,
compaction, session, or TUI.

The Capability stays cold during import and startup. Usage performs network I/O only after `/codex` is opened or a
user-driven interactive Codex Agent run reaches a genuinely idle settlement. Automatic work and non-Codex runs do not
refresh usage, overlapping post-run requests collapse into one trailing refresh, and failures retain the last observed
snapshot. Native helpers start only for an actual Tool call. Missing authentication, an unsupported model, or an
unavailable native helper becomes a bounded command or Tool error; ordinary Pi work remains available.

Each usage refresh runs as one Session-owned Effect operation. Effect owns its ten-second timeout and caller
cancellation, while the Capability adapter retains the native authenticated `fetch`. The Pi-facing adapter projects
typed failures back to the existing Command Dialog and notification outcomes; a completion from a replaced Session
cannot update the shared usage snapshot or Statusline.

Fast settings use the shared Effect settings path end to end. Startup performs one read-only load at the Pi-facing
adapter; each explicit change runs as a Session-owned operation, serializes under the shared settings lock, and keeps
sibling namespaces intact through atomic replacement. A failed write leaves the in-memory value unchanged and is
projected to the existing Command Dialog error path. Session shutdown drains the serialized settings gate before the
Suite closes its Effect Foundation.

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
body below the shared lifecycle row. For `imagegen`, Pi Stuff keeps the native structured result and textual generated
path, then best-effort inlines at most four readable regular files no larger than 25 MiB each. Pi 0.84.4's public
`detectSupportedImageMimeTypeFromFile()` identifies JPEG, PNG, GIF, WebP, and BMP from file bytes; unsupported,
missing, oversized, or unreadable files keep the text result without mislabeled media.

This media result does not by itself certify image display through tmux. Rendering remains owned by Pi and the active
terminal protocol, including any multiplexer passthrough requirements; Codex does not change terminal settings.
