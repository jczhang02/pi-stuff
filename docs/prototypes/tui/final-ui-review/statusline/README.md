# Statusline visual evidence

> **HISTORICAL PROTOTYPE plus current production evidence.**

The original `artifacts/` and `capture.sh` record the dot-separated, iconless prototype that was accepted too early and
is no longer the production design. They remain only as regression history for the visual-parity defect.

Current production captures are written to `parity-artifacts/` by the real Host verifier:

```bash
PI_BIN=/opt/bin/pi \
PI_STUFF_UI_PTY_ARTIFACT_DIR=docs/prototypes/tui/final-ui-review/statusline/parity-artifacts \
bun scripts/verify-ui-pty.ts
```

These ANSI and plain-text captures load the production Aggregate and cover fresh `100 × 32`, `64 × 28`, `48 × 22`,
`32 × 18`, and `24 × 16` screens plus the complete metered `100 × 32` footer after a real streamed turn. They show the restored Powerline visual
grammar: one-cell padding, `|` separators, display-name and icon treatment, `think:<level>`, basename path,
`*unstaged +staged ?untracked`, detailed context/cache fields, and whole-segment responsive flow. The hardened renderer
also supports `!conflict`, `⇡ahead`, `⇣behind`, and explicit unknown Context such as `?/200k`. Pi semantic theme tokens,
no subscription `(sub)` label, responsive prompt bounds, and the selected Goal/MCP/Loadout status subset are intentional
Pi Stuff deviations. The metered frame also exercises the secondary extension-status row.

At narrow widths the current contract is semantic, not merely truncation-based: model and Context survive first, then
Git, cwd and Thinking, cost and cache, and extension statuses. Long identities shorten from the middle, while compact
Git uses `ΔN` and reserves its bounded row for conflict and divergence markers before branch text. Latest prompt uses at most two rows at 80 columns or
wider, at most one row at 48–79 columns, and no row below 48 columns. The same real-Host verifier checks all five widths and
the complete eight-row `/ui` inventory.

## Rejected prototype record

Question: does the accepted multi-row Statusline remain readable in real Pi `0.83.0` at wide and narrow widths, hide completely for temporary selector/autocomplete ownership, and restore without changing the editor?

Run from the repository root:

```bash
./docs/prototypes/tui/final-ui-review/statusline/capture.sh
```

The script prefers `/opt/bin/pi`, requires version `0.83.0`, and uses `/tmp/pi-proto-bin/freeze` by default. Override either path with `PI_BIN` or `FREEZE_BIN`. It creates an isolated temporary Pi agent directory and offline persisted sessions; it does not load or modify the user's Pi settings.

The eight PNG, ANSI, and plain-text captures under `artifacts/` cover:

- full metered fields at `100 × 32`;
- bounded truncation at `64 × 28`;
- subscription-model omission of both cost and `(sub)`;
- latest-prompt overflow onto exactly one additional row;
- complete Statusline removal and recovery around a native selector;
- complete Statusline removal and recovery around native autocomplete.

The rejected prototype order was model → thinking → abbreviated cwd → branch/Git counts → context → cache read →
metered cost → Goal/MCP/Loadout statuses. Theme colors came only from Pi semantic tokens. The fixture Git counts were
deterministic display data; branch, session usage, thinking, model, prompt, and extension statuses travelled through real
Pi public APIs.
