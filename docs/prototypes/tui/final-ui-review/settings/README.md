# `/ui` SettingsList evidence

> **HISTORICAL PROTOTYPE plus current production contract.**

The historical screenshots answer the original question: can Pi Stuff use a
flat, full-width, non-overlay Pi `SettingsList`? Current production screenshots
are stored under `../statusline/parity-artifacts/` because the same real
Aggregate verifier captures Statusline, `/ui`, and Todo together.

Current production `/ui` contains eight rows:

- Statusline
- Statusline density (`auto`, `full`, or `compact`)
- Latest prompt
- Statusline icons (`auto`, `nerd`, or `ascii`)
- Welcome header
- Input highlighting
- Inline slash autocomplete
- Tool running timer

The production verifier opens the real Aggregate, confirms all eight labels,
changes both boolean and enum values, restarts Pi, and confirms persistence.
The selected row still uses Pi's native description, typing filters the list,
Enter or Space changes a value, and Escape closes the Command Dialog. Welcome
continues to apply on the next launch; the other seven rows apply immediately.

The historical five-row captures remain useful evidence for the native
interaction grammar. Current eight-row behavior and 100/64-column PNGs are
certified by `scripts/verify-ui-pty.ts`; no claim about the current inventory
should be inferred from the older images.

## Reproduce current production evidence

From the repository root:

```bash
PI_STUFF_UI_PTY_ARTIFACT_DIR=docs/prototypes/tui/final-ui-review/statusline/parity-artifacts \
bun scripts/verify-ui-pty.ts
```

The verifier uses the real enhanced host at `/opt/bin/pi`, isolated temporary
settings, the complete production Aggregate, a deterministic offline Provider,
and no network. It writes the current `/ui` ANSI and text frames beside the
Statusline and Todo evidence; the checked-in PNGs are Freeze renders of those
same ANSI files.

The current run verifies:

1. opening `/ui` at `100 × 32`;
2. opening `/ui` at `64 × 28`;
3. all eight rows and absence of RTK behavior settings;
4. search, boolean and enum changes, restart persistence, and Escape restore.

Open [`report.html`](./report.html) for the two production frames.

## Reproduce historical prototype

Run `docs/prototypes/tui/final-ui-review/settings/capture.sh` to regenerate the
four original five-row prototype frames under [`artifacts/`](./artifacts/).

## Historical prototype result

- The surface is a real editor-replacement Command Dialog, not an overlay.
- The Host footer is absent while `/ui` owns the input region and is restored
  after Escape.
- All labels, descriptions, and native hints remain readable at 64 columns.
- Search reduces the prototype settings to the matching timer row.
- Enter changes the selected value from `true` to `false` in place.
- Native `SettingsList` correctly omits its counter when all visible rows fit.
