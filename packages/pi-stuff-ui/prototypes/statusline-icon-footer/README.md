# Icon footer Statusline prototype

> Disposable prototype. This branch is visual evidence; it is not the production implementation.

The prototype runs a deterministic offline session in the real Pi 0.83 Host, fixes the terminal geometry with `tmux`, and rasterizes the captured ANSI cells with Freeze. The HTML report only arranges those genuine TUI captures for comparison.

Run from the repository root:

```sh
./packages/pi-stuff-ui/prototypes/statusline-icon-footer/capture.sh
```

Open `report.html?variant=a`. Use the bottom switcher or the left/right arrow keys to compare all three treatments.

The accepted information architecture is held constant:

- one Statusline row;
- one optional previous-prompt row with a small blue filled-circle marker;
- raw `provider/model` identity;
- conditional `⚡ Fast`;
- cwd, Git branch and diff, context %, cache-hit %, and weekly-remaining %;
- narrow terminals drop complete low-priority segments instead of wrapping.

Variant A is the recommended pi-footer-faithful treatment. Variants B and C exist only to validate icon weight, grouping, and color restraint before production work begins.
