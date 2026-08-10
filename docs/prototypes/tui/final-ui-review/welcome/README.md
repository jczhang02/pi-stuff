# Welcome Header real-Pi prototype

> **REAL-PTY EVIDENCE — the production Welcome component with deterministic fixture data.**

This fixture answers one visual question: does the Claude Code 2.1.197-inspired Welcome Header remain complete inside
the real Pi Host at wide, narrow, and low-height terminal sizes?

`reference/claude-code-2.1.197-welcome-100x32.png` is a genuine Claude Code 2.1.197 PTY capture, not a reconstruction.
It is the geometry reference for the title embedded in the top border, the fixed 52-cell identity column, and the
right-hand guidance hierarchy. Pi Stuff keeps those relationships while using its own identity and inventory content.

It uses `ctx.ui.setHeader()`, so the Welcome surface is the first block in Pi's scrollable document rather than a
fixed widget or overlay. The fixture mounts the production `WelcomeHeaderController`; only model and inventory data are
fixed to keep screenshots deterministic. It runs offline in an isolated temporary Settings Layer without creating a
session or loading the installed Suite.

## Reproduce

From the repository root:

```bash
FREEZE_BIN=/tmp/pi-proto-bin/freeze \
  ./docs/prototypes/tui/final-ui-review/welcome/capture.sh
```

The command uses `/opt/bin/pi` by default. Override it with `PI_BIN=/path/to/pi` when needed. The harness validates the Host against the shared repository contract and also requires Bun `1.3.14`, `tmux`, and Charmbracelet Freeze.

## Captured contract

- `100 × 32`: eleven-row card with Claude's fixed 52-cell identity column and a responsive guidance column.
- `64 × 28`: thirteen-row single-column card; guidance and inventory are removed instead of wrapped.
- `32 × 18`: twelve-row low-height card; one blank rhythm row is removed so the top border stays visible.
- `64 × 28` scroll proof: after twenty deterministic transcript rows, Welcome is absent from the viewport while the editor remains available.
- The bordered card belongs to transcript scrollback; it is not a modal, overlay, or floating window.
- All color comes from Pi semantic theme tokens.

Open [`report.html`](./report.html) for the side-by-side reference and production review. Raw ANSI and plain-text
production captures are alongside each PNG under [`artifacts/`](./artifacts/).
