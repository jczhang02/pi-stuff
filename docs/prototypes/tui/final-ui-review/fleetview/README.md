# Fleetview visual evidence — Design Revision 2

The `0.83` screenshots are retained as historical evidence from before Design Revision 2. The verifier resolves the
repository-certified Pi Host, loads the complete Pi Stuff Package, launches a background Agent through the public
`subagent` Tool, and exercises passive, main-selected, live-child-selected, terminal-child-selected, resized, dialog,
and resumed Fleetview states at `100 × 32` and `64 × 28`.

Reproduce them from the repository root:

```bash
PI_BIN=/opt/bin/pi \
PI_STUFF_AGENTS_PTY_ARTIFACT_DIR=docs/prototypes/tui/final-ui-review/fleetview/artifacts \
bun scripts/verify-agents-pty.ts
```

The verifier proves the accepted bottom order on fresh and resumed sessions. While idle:

1. one-line Statusline;
2. optional one-line latest Prompt;
3. `main`;
4. child Agent rows.

Entering management replaces Footer row 2 with contextual controls while leaving the roster in place, then restores
the exact Prompt row on Escape. Main has no `x` action, a live child says `x stop`, and a terminal child says
`x dismiss`; narrow mode removes optional words. Statusline icons, Prompt icon, controls, markers, and overflow all
start at terminal cell 1. Fleetview never renders an idle blank row, leading inset, `↓ to manage`, title, border,
selection arrow, second copy above the editor, or a truncated task fused with the right-aligned state.
