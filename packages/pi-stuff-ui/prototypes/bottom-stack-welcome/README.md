# Bottom stack + official Pi mark prototype

Throwaway visual evidence for two independent Pi Stuff UI decisions:

- how Statusline hands off to the bottommost Fleetview;
- how the official Pi Primary mark is reconstructed in terminal cells.

Open [`report.html`](./report.html) and switch between A/B/C. Every image in the
report is a genuine Pi 0.83.0 fullscreen PTY capture, not an HTML terminal mock.
The choices may be mixed across categories.

Regenerate all twelve frames with:

```sh
./packages/pi-stuff-ui/prototypes/bottom-stack-welcome/capture.sh
```

The script requires Pi 0.83.0, Bun 1.3.14, tmux, ImageMagick, and Freeze. It
runs offline with isolated temporary Pi settings and does not write sessions.

The `claude-code-2.1.220-statusline-*` artifacts are real Claude Code Host
captures after configuring `kcchien/claude-code-statusline`. A deterministic
local Messages API returned only `ready`; it did not simulate or replace any
Claude Code layout. The upstream script required a local GNU/Linux portability
fix for its Git-cache `stat` call before it could render.
