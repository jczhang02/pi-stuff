# Prototype acceptance record

## Outcome

The refined C structure is viable in Pi. `/rtk` replaces the editor area with
one root list, then opens exactly one detail page. It needs no modal overlay,
persistent side navigation or extension-owned status bar.

The structure keeps the first decision small: choose Settings, Usage or
Diagnostics. Settings and denser statistics appear only after that choice. A
compact title/status line, aligned values and one local help row reduce visual
noise without changing the interaction model. The native Pi footer remains
visible because it belongs to the host, not RTK.

## Environment

- Pi 0.85.1.
- RTK fixture version 0.45.0, matching the locally available version.
- `@kitlangton/terminal-control` 1.2.1.
- Pi `ctx.ui.custom` without `overlay: true`.
- Pi `SelectList`, `SettingsList`, `Input`, `DynamicBorder` and light theme.
- Capture font stack `JetBrainsMono Nerd Font Mono`, `Symbols Nerd Font Mono`
  and `LXGW WenKai Mono`, matching the maintainer's Ghostty configuration.

Terminal Control used a 100 by 30 terminal for the normal states, a 56 by 26
terminal for the minimum supported state and a 50 by 14 terminal for the
constrained state. The headless terminal palette was initialized to the
verified Ghostty foreground `#4c4f69` and background `#eff1f5`. The checked-in
SVG and text files are direct captures. PNG files are rasterized from those SVG
captures because the native PNG exporter omitted glyphs in this environment.
Every SVG explicitly records the capture font stack instead of using Terminal
Control's default list.

## Verified interaction trace

1. Type `/rtk`: the `RTK` root opens with Settings selected and `✓ v0.45.0`.
2. Press Enter: `RTK / Settings` opens with runtime state and three settings.
3. Toggle command rewrite: the value changes and Pi writes a success
   notification into the chat area.
4. Open Executable, choose Custom, enter `relative/rtk`: the input remains open
   and shows the absolute-path validation error.
5. Replace it with `/opt/rtk/bin/rtk`: the submenu closes, Settings reports
   `Resolved by custom`, and the setting shows `custom` instead of allowing a
   long absolute path to consume the row.
6. Press Escape: return to the root. Press Escape again: restore the Pi editor.
   Typing `focus-test` confirms editor focus is restored.
7. Run `/rtk gain`: `RTK / Usage` opens with the overview metrics.
8. Press `r`: a loading state appears, then returns to ready in the normal
   scenario.
9. Launch with `--rtk-prototype-state failure`, run `/rtk gain`, then press `r`:
   the retry passes through loading and returns to an inline timeout failure.
   Pi also leaves the failure notification in the chat area after the panel is
   closed.
10. Launch with `--rtk-prototype-state loading`, run `/rtk gain`, then press
    Escape: the pending operation is cancelled and the root is restored.
    Reopening Usage shows ready data instead of a stale loading state.
11. Run `/rtk diagnostics`: resolution, executable, last failure and read-only
    native RTK configuration are shown.
12. Resize to 50 by 14: the component collapses to a clear minimum-size notice.
    Escape still closes it.
13. Type `/rtk ` and press Tab: Pi's native completion list presents
    `integration`, `gain`, `diagnostics`, `refresh` and `help`.
14. At 56 by 26, the root, Settings, Executable input, Usage overview and
    compact period table remain fully operable. At 56 by 16, the component
    shows the minimum-size notice instead of clipping controls.
15. With temporary bindings `j`, `k`, `l` and `h` for select down, up, confirm
    and cancel, the root, Settings and Executable mode selector all
    follow the remapped keys.
16. Cycle Usage through Overview, Daily, Weekly, Monthly, History and
    Failures: each view keeps the same title/status grammar, aligned numeric
    edge and display controls.
17. Launch with `--rtk-prototype-state empty`: the root reports that no commands
    have been recorded, Usage explains the same first-run state and refresh
    remains available after returning to the root.

## Design findings

- Keep the root as a `SelectList`. It communicates hierarchy without inventing
  a new navigation grammar.
- Keep Settings as a `SettingsList`. The list already supplies selection,
  descriptions, cycling values and submenu behavior consistent with Pi.
- Use a second `SelectList` for the Executable mode and a dedicated `Input` only
  for the custom path. Selection inherits Pi keybindings, while inline
  validation keeps an invalid absolute path editable and prevents a false
  save.
- Keep Usage failure in the page body so retry remains discoverable, and also
  write it through Pi's error notification so the outcome survives closing the
  control center.
- Keep Diagnostics read-only and give it only an Escape hint. Editable native
  RTK configuration would blur ownership between Pi Stuff and RTK.
- Retain Pi's footer. The RTK surface adds no bottom status content.
- Borrow only the presentation principles that fit from
  [pi-context-view](https://pi.dev/packages/pi-context-view): compact
  title/status rows, dot leaders for label-value scanning, aligned numeric
  columns, restrained semantic color and a single help row. The context-map
  block visualization does not fit RTK settings or gain data and is not used.
- Keep full custom paths inside the editor. The settings row reports the mode as
  `custom`, avoiding a truncated path that cannot be distinguished from another
  executable.

## Reference provenance

The visual reference was the public `pi-context-view` package page and its
published screenshots. This refinement copied no source code, package assets or
screen layout. It translated only the presentation principles listed above
into Pi's existing `SelectList`, `SettingsList`, `Input` and theme components.

## Simulation boundary

This prototype does not execute RTK, resolve an executable, read `rtk gain`,
write configuration or persist settings. Values, delays and errors are fixtures
selected through `--rtk-prototype-state`. Production implementation is a
separate decision and requires its own tracked task.
