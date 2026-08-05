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

The visual evidence has three authority levels under `reference/` and `parity-artifacts/`:

1. `user-statusline-reference.png` is the maintainer's accepted direction reference. It includes Fleetview above the
   footer and establishes the icon-led, compact, single-row direction.
2. `former-config-statusline-footer-100x32.png` is a black-box capture of the former local configuration. It confirms
   the migrated content and icons, but its dot separators are historical rather than authoritative.
3. `pi-0.83-statusline-parity-metered-100x32.png` and the responsive matrix are the current production result.

These ANSI, plain-text, and PNG captures load the production Aggregate and cover fresh `100 × 32`, `64 × 28`,
`48 × 22`, `32 × 18`, and `24 × 16` screens plus the complete metered `100 × 32` footer after a real streamed turn. They show the accepted icon-led visual
grammar: exactly one status row, middle-dot separators, an optional exactly one-row latest Prompt, display-name and
icon treatment, Thinking level, basename path, `*unstaged +staged ?untracked`, context/cache fields, and whole-segment
responsive removal. The hardened renderer
also supports `!conflict`, `⇡ahead`, `⇣behind`, and explicit unknown Context as `?`. Pi semantic theme tokens,
no subscription `(sub)` label, responsive prompt bounds, and capability activity staying out of the Statusline are
intentional Pi Stuff decisions. Fast appears between Thinking and cwd only when enabled; Codex weekly allowance replaces
cost after cache when real usage data is available.

At narrow widths the current contract is semantic, not merely truncation-based: model and Context survive first, then
cwd, branch, weekly/cost, Thinking, Fast, Git detail, and cache. Long identities shorten from the middle, while complete
low-priority segments leave before the row can wrap. Latest Prompt always uses at most one row and hides when even that
row would harm the minimum layout. The same real-Host verifier checks all five widths and
the complete eight-row `/ui` inventory. It also drives four real `TaskCreate` calls at both `100 × 32` and `64 × 28`
and checks the expanded Todo alignment; the resulting `/ui` and Todo frames are stored beside the Statusline captures.

## Rejected prototype record

Question: does the accepted one-row Statusline plus optional one-row Prompt remain readable in real Pi `0.83.0` at wide and narrow widths, hide completely for temporary selector/autocomplete ownership, and restore without changing the editor?

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
metered cost → capability statuses. Theme colors came only from Pi semantic tokens. The fixture Git counts were
deterministic display data; branch, session usage, thinking, model, prompt, and extension statuses travelled through real
Pi public APIs.
