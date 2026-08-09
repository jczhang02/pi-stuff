# Fleetview visual evidence

The checked-in screenshots are recorded production evidence from real Pi `0.83.0`, not HTML terminal mockups. The
verifier now resolves the repository-certified Pi Host and reproduces the same contract: it loads the complete Pi Stuff
Aggregate, launches a background Agent through the public `Agent` tool, and exercises both the passive and
keyboard-managed Fleetview states at `100 × 32` and `64 × 28`.

Reproduce them from the repository root:

```bash
PI_BIN=/opt/bin/pi \
PI_STUFF_AGENTS_PTY_ARTIFACT_DIR=docs/prototypes/tui/final-ui-review/fleetview/artifacts \
bun scripts/verify-agents-pty.ts
```

The verifier proves the accepted bottom order on fresh and resumed sessions:

1. one-line Statusline;
2. optional one-line latest Prompt;
3. Fleetview help slot;
4. `main`;
5. child Agent rows.

The help slot is exactly blank while Fleetview is passive. Entering management mode replaces that same row with
`↑/↓ select · Enter view · x stop · Esc return` at wide widths or
`↑/↓ select · Enter · x stop · Esc` at narrow widths. It never renders `↓ to manage`, never mounts a second copy above
the editor, and never lets a truncated task fuse with the right-aligned state.
