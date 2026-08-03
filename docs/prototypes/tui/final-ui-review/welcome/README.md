# Welcome Header real-Pi prototype

> **PROTOTYPE — throwaway UI evidence, not production Capability code.**

This fixture answers one visual question: does the selected Welcome Header remain useful and quiet inside the real Pi Host at wide, narrow, and ultra-narrow terminal widths?

It uses `ctx.ui.setHeader()`, so the Welcome surface is the first block in Pi's scrollable document rather than a fixed widget or overlay. The extension contains fixed model, path, and inventory data solely to keep screenshots deterministic. It runs offline, in an isolated temporary Settings Layer, without creating a session or loading the installed Suite.

## Reproduce

From the repository root:

```bash
FREEZE_BIN=/tmp/pi-proto-bin/freeze \
  ./docs/prototypes/tui/final-ui-review/welcome/capture.sh
```

The command uses `/opt/bin/pi` by default. Override it with `PI_BIN=/path/to/pi` when needed. The harness requires a Host that reports `0.83.0`, Bun `1.3.14`, `tmux`, and Charmbracelet Freeze.

## Captured contract

- `100 × 32`: six-row, two-column identity / Loaded / Tips composition.
- `64 × 28`: five-row compact composition retaining path, inventory, and all three tips.
- `32 × 18`: one content row between subtle dividers; the Welcome identity never disappears.
- `64 × 28` scroll proof: after twenty deterministic transcript rows, Welcome is absent from the viewport while the editor remains available.
- No version, recent sessions, side borders, card, or floating window.
- All color comes from Pi semantic theme tokens.

Open [`report.html`](./report.html) for the review sheet. Raw ANSI and plain-text captures are alongside each PNG under [`artifacts/`](./artifacts/).
