# Acceptance record

Date: 2026-09-14. Related: [#69](https://github.com/jczhang02/pi-stuff/issues/69).
Rules baseline: `6b717b0`; prototype stays on an artifact branch outside main.

## Fresh-process result

The instruction changes are not proven sufficient for fully autonomous fidelity.
Three fresh Codex CLI processes used `gpt-5.6-luna` at `max`, with the same small
product request and no supplied font, theme or terminal-size answers. The CLI
was `0.154.0-alpha.6.2`. Initial session records contained both global and project
instructions; this was checked independently of the agent's completion claims.

| Trial                                     | Rule revision | Observed result                                                                                                                                                     |
| ----------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, `01a0a00c-2db4-7433-bb42-958a36a3f3b1` | `ea59008`     | Used a default 120x36 test target without discovering the user host. Failed.                                                                                        |
| 2, `01a0a011-14c0-7392-8de6-ec01dfffc716` | `27ebd32`     | Listed processes but launched the default test before terminal config and pane/client inspection. Failed.                                                           |
| 3, `01a0a018-0257-72a1-b32c-e84aa1e3c1a1` | `6b717b0`     | Found Ghostty config, tmux geometry and Pi config, and noted no user Pi instance was running. Still built a standalone imitation with fixed colors. Overall failed. |

The third session then received explicit review feedback in a resumed CLI turn.
It produced the actual Pi extension. The owner took over after code and evidence
production, fixed the remaining height boundary, and replaced default dark PNG
rendering with a capture profile based on observed terminal colors. These assisted
repairs are not counted as autonomous instruction compliance. Raw trial logs stay
local because they include unrelated host context.

## Corrected prototype checks

The owner ran the actual compiled Pi 0.85.1, using Bun 1.4.0 to run Tuistory 0.11.0,
isolated working/config directories, disabled unrelated resources and no submitted
model prompt. Production source, dependencies and tests were not changed.

- F12 opened the task list. Selection, RUNNING/DONE details and return worked.
- `Keep this draft unchanged.` survived list/detail navigation and cancel from
  the small-window notice in the actual Pi editor.
- The original 122x18 detail clipped the return hint. The owner changed the
  prototype minimum from 18 to 24 rows. At 72x24, complete detail and the footer
  are visible; at 72x23 and 122x18, the size notice and cancel hint are visible.
  Resizing back to 122x36 restores the detail. See the retained screenshots.
- In the CLI's isolated theme-probe session, Pi changed light to dark while the
  panel remained open. The owner verified dark selection text with the actual
  dark theme accent `#8abeb7` and inspected its capture. No user theme file changed.
- `bun run check` and `git diff --check` passed. Production tests were not rerun
  because this branch only adds an isolated prototype and documents evidence.

## Capture fidelity

The final owner captures target the currently observed 122x36 pane size, not the
older 122x37 observation or the configured startup size. Ghostty's parsed colors
were background `#eff1f5`, foreground `#4c4f69`. Its configured font is JetBrainsMono
Nerd Font Mono with symbol/CJK fallbacks, 12 pt. The capture uses the renderer's
bundled JetBrains font, 16 px (12 pt at 96 dpi), pixel ratio 1.25 and line height
1.2. The pixel ratio uses the primary display scale; line height is an explicit
approximation, not a measured Ghostty cell height. Padding is omitted because
these images represent the PTY content, not the native terminal window.

The screenshots are real Pi PTY renders. Native Ghostty rasterization, font
fallback/thickening, actual window zoom, monitor assignment and surrounding tmux
chrome are not pixel-verified. The stock isolated Pi host also omits the user's
Zentui editor/footer customization. Full customized-host visual acceptance remains
unverified. No claim of native screenshot parity is made.

## Review

A separate Astra review applied the mandatory code-quality skill to the complete
prototype. Its initial findings were standalone host ownership, fixed theme,
and silent draft loss in the self-managed Editor. The CLI's extension rewrite
removed those paths. A follow-up found the 18-row clipping issue, reproduced by
the owner in real Pi and fixed as described above. Final recheck is recorded in
the artifact PR. Agent review is not GitHub approval or permission to merge.
