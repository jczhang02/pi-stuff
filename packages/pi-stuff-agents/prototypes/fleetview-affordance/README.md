# Fleetview affordance prototype

Throwaway visual evidence for one question: what should replace the permanent
`↓ to manage` row above Fleetview?

The prototype keeps the accepted two-line Statusline and Agent data fixed, then
compares three structures in both passive and management states:

- A: no passive hint; show a contextual controls row only while managing;
- B: keep a stable neutral header and replace its content while managing;
- C: keep every hint inside the row it affects.

## Visual verdict

Variant A is the recommended translation. Claude Code keeps its passive
`↓ to manage` affordance in the Host footer, not in the roster itself, then
shows a contextual controls row after management begins. Pi Stuff already uses
that footer area for its two-line Statusline, so its passive Fleetview should
start directly at `● main`; the controls row should exist only while navigation
is active. `/agents` remains the explicit discoverability path.

Open [`report.html`](./report.html) and switch between A/B/C. Every terminal image
is a genuine Pi 0.83.0 fullscreen PTY capture, not an HTML reconstruction.

Regenerate all twelve frames with:

```sh
./packages/pi-stuff-agents/prototypes/fleetview-affordance/capture.sh
```

The script requires Pi 0.83.0, Bun 1.3.14, tmux, ImageMagick, and Freeze. It runs
offline with isolated temporary Pi settings and does not write sessions.
