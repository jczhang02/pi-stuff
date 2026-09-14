# Inline RTK control-center prototype

This throwaway prototype refines the selected C structure from issue #82 under
issue #83. It runs as a real Pi extension and replaces the editor area through
`ctx.ui.custom`. It does not use an overlay, add a status bar or modify Pi Stuff
production code.

The visual pass takes limited cues from
[pi-context-view](https://pi.dev/packages/pi-context-view): compact title and
status lines, aligned numeric data, restrained semantic color and one help row.
No source code or assets were copied, and the context-map metaphor was not
carried into the RTK information architecture.

## Shared foreground run

From the repository worktree:

```sh
bun run tui run rtk-inline-prototype --host opentui --cols 100 --rows 30 --cwd "$PWD" -- /opt/bin/pi --offline --no-session --no-tools --no-extensions --no-context-files --no-skills --no-prompt-templates --use-theme light --tui-mode fullscreen --extension ./prototype/rtk-inline-control-center.ts
```

Type `/rtk` and press Enter. The root list opens one section at a time. Escape
returns from a detail page to the root, then restores the normal Pi editor.

Direct entry points are `/rtk integration`, `/rtk gain` and
`/rtk diagnostics`. `/rtk refresh` opens Savings and refreshes its data.

## Simulated states

Pass one of these flags after the extension path:

- `--rtk-prototype-state loading` keeps Savings in a cancellable loading state.
- `--rtk-prototype-state empty` shows the first-run state before any rewritten
  commands have been recorded.
- `--rtk-prototype-state failure` shows a failed `rtk gain` read. Press `r` to
  retry and observe loading before it fails again.

The displayed RTK version, executable path, savings values, failure and config
save are fixtures. Pi itself provides the host, component rendering, input,
theme, focus and command dispatch.

## Captures

- [Root control center](./screenshots/root.png)
- [Command completions](./screenshots/command-panel.png)
- [Savings detail](./screenshots/savings.png)
- [Daily comparison](./screenshots/daily.png)
- [Empty savings](./screenshots/empty.png)
- [Savings failure](./screenshots/failure.png)

Each PNG is rendered from the matching Terminal Control SVG capture. The plain
text screen capture is retained beside it for exact inspection.

Use the maintainer's Ghostty font stack for every image export. Do not rely on
Terminal Control's default font list:

```sh
capture_font="JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono"
bun run tui save rtk-inline-prototype --format svg --format txt \
  --out prototype/screenshots/root --hide-cursor \
  --font-family "$capture_font"
magick prototype/screenshots/root.svg prototype/screenshots/root.png
```

See [acceptance.md](./acceptance.md) for the interaction trace, findings and
simulation boundary.
