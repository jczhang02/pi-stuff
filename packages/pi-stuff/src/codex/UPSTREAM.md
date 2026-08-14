# Upstream provenance

Pi Stuff Codex contains source derived from the pinned `@howaboua/pi-codex-conversion` `3.0.7` snapshot.

- Historical package URL: `https://github.com/howaboua/pi-codex-conversion`
- Current upstream repository: `https://github.com/IgorWarzocha/howaboua-pi-stuff`
- Upstream package directory: `packages/pi-codex-conversion`
- Upstream tag: `@howaboua/pi-codex-conversion@3.0.7`
- Audited upstream commit: `b3591d996efbf6df293e426dea2bb2dd17fcbfe6`
- Owned fork: `https://github.com/jczhang02/pi-codex-conversion`
- Owned fork branch: `pi-stuff-suite`
- Upstream license: MIT; the preserved notice is in `LICENSE`.
- Native helper source provenance: `openai/codex@b545c94041017d000e2c8b2f6272705d21b85dfb`.

## Pi Stuff delta

- Keep only `/codex`, Fast mode, subscription usage, `apply_patch`, `view_image`, and confirmed `gpt-image-2`
  generation.
- Remove the upstream provider replacement, prompt replacement, `exec_command`, `write_stdin`, web search, native
  compaction, Code Mode, voice, background-shell widget, status entry, and upstream settings UI.
- Route every retained Tool through the internal Tool Display contract and every focused surface through the shared,
  non-floating Command Dialog.
- Keep import and startup free of network calls, file writes, subprocesses, and settings mutation.
- Persist Fast only after an explicit `/codex` action; fetch usage only from that action or after a user-driven
  interactive Codex Agent run reaches an idle settlement. Never poll or fetch during import or startup.
- Execute native helpers directly without a shell wrapper, including patches that contain shell `case`/`esac` text.
- Bundle only the certified Linux x64 helper binaries; unsupported platforms fail as Tool errors without disabling Pi.

The source and certified helpers are absorbed into Pi Stuff and have no independent Package or release lifecycle.
