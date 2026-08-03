# `/ui` SettingsList evidence

> **HISTORICAL PROTOTYPE plus current production contract.**

The checked-in screenshots answer the original question: can Pi Stuff use a
flat, full-width, non-overlay Pi `SettingsList`? They preserve the initial
five-row prototype and are not the current settings inventory.

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
interaction grammar. Current eight-row behavior is certified by
`scripts/verify-ui-pty.ts`; no claim about the current inventory should be
inferred from the older images.

## Reproduce

From the repository root:

```bash
docs/prototypes/tui/final-ui-review/settings/capture.sh
```

The default capture uses the real enhanced host at `/opt/bin/pi`, isolated
temporary Pi settings, fullscreen mode, no model calls, no network, and no
production Pi Stuff packages. A clearly invalid prototype-only Anthropic key
only makes Pi's built-in model available to the editor; the script never
submits a model prompt. Override `PI_BIN` or `FREEZE_BIN` only when reproducing
on another machine.

The script records raw ANSI plus PNG evidence for:

1. opening `/ui` at `100 × 32`;
2. opening `/ui` at `64 × 28`;
3. typing `timer` to search;
4. pressing Enter to change `Tool running timer` from `true` to `false`.

All generated evidence stays in [`artifacts/`](./artifacts/).

Open [`report.html`](./report.html) to review all four genuine PTY frames in
one page. The capture also verifies that Escape removes the SettingsList and
restores Pi's editor/footer, without adding a fifth redundant screenshot.

## Historical prototype result

- The surface is a real editor-replacement Command Dialog, not an overlay.
- The Host footer is absent while `/ui` owns the input region and is restored
  after Escape.
- All labels, descriptions, and native hints remain readable at 64 columns.
- Search reduces the prototype settings to the matching timer row.
- Enter changes the selected value from `true` to `false` in place.
- Native `SettingsList` correctly omits its counter when all visible rows fit.
