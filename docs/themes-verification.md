# Theme verification

[简体中文](i18n/zh-CN/themes-verification.md) · English is normative.

This record covers the ten themes in [issue #95](https://github.com/jczhang02/pi-stuff/issues/95).
The usage and source revisions are in the [theme guide](themes.md).

## Host and method

Verification uses Pi 0.85.1, Bun 1.4.0 and the repository's pinned Terminal
Control 1.2.1. The system tests load the real package directory with `-e`, using
isolated settings and a deterministic local provider. They exercise package
registration, native selection and persistence, all four recommended automatic
pairs, and native HTML export under all ten themes.

Automatic-mode tests send the terminal's native `ESC[?997;2n` light and
`ESC[?997;1n` dark reports. Terminal Control's default appearance is dark and
its query response takes precedence over `COLORFGBG`; changing only that
variable did not exercise the light side. These reports simulate terminal
notifications and do not establish live Ghostty appearance switching.

The first package-discovery test failed before the resource change, showing
only Pi's built-in `dark` and `light`, then passed with all ten bundled names.
The later selection, appearance and export tests were added after the resources.

```sh
bun test tests/system/theme-host.test.ts
PI_TEST_HOST=/absolute/path/to/pi bun test tests/system/theme-host.test.ts
bun run check
bun run test
git diff --check
```

At `c2321f6`, after integrating current main, `bun run check` and
`git diff --check` passed. The full offline suite passed 124 tests with
973 assertions. The compiled-host theme suite passed
7 tests with 63 assertions using the asset setup below. Existing regular and
fullscreen host tests passed in the full suite.

## Compiled-host export assets

The installed compiled Pi initially failed `/export` because its adjacent
`export-html` directory lacked `template.css` and `template.js`. This is a host
installation failure, not a theme-validation failure. The executable was kept
unchanged. For export verification, `PI_PACKAGE_DIR` pointed to an isolated
asset tree using the installed host assets plus the complete export templates
from the matching Pi 0.85.1 package. No system files were changed.

All ten native exports from that executable were opened in a browser. The
replayed sample conversation requests a bounded cache, shows TypeScript and an
edit diff, and includes custom, failed and pending tool messages. Page and card
backgrounds, secondary/thinking text, code and state colors remained readable.
The replay verifies rendering; its displayed tool calls were not executed.
A compiled installation needs its matching export assets to reproduce this.

## Native display evidence

The following files are actual Ghostty 1.3.1 captures at 1280×900, not Terminal
Control renders. The compiled Pi runs inside Xvfb with Mutter, a private D-Bus,
an isolated runtime and neutral working/settings directories. `WAYLAND_DISPLAY`
is unset and Ghostty single-instance reuse is disabled. The font stack is
JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono and LXGW WenKai Mono at
12 points. Each terminal uses the selected theme's base and foreground colors.

The state frames use regular mode; prose, search and selection use
fullscreen mode. Each variant was inspected for readable prose/thinking,
Markdown/TypeScript, user/custom messages, successful edit diffs, error output,
an unmatched pending tool call, visible search matches and selection, borders
and Pi's scrollbar. The frames replay realistic task content without executing
the displayed tool calls or claiming live streaming behavior.

For the fullscreen captures, isolated Pi settings set `fullscreenScrollbar` to
`always` and map `tui.altScreen.search` to `ctrl+f`, avoiding Ghostty's own search
shortcut. Search for `cache`, then close search and open `/settings` > Theme to
inspect the current highlighted choice. These fixture settings are not package
defaults. Earlier Ghostty-search overlays and a completed-tool fixture were
rejected and replaced with the actual Pi controls and pending-call rendering.

Keyboard and pointer input targeted the private X11 display. In the final
capture batches, host X11 focus, pointer coordinates and clipboard
hash matched before, during and after capture and teardown. This establishes
that bounded batch's result, not a universal Wayland focus guarantee. All owned
terminal, compositor, Xvfb and private D-Bus sessions were stopped. The available
X11 tools supplied native captures; CUA accessibility-tree inspection was not
available.

| Theme                | Prose / code / diff                                                  | Tool states                                                         | Pi search                                                         | Theme selection                                                            |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Catppuccin Latte     | [Prose / code / diff](assets/themes/catppuccin-latte-native.png)     | [Tool states](assets/themes/catppuccin-latte-states-native.png)     | [Pi search](assets/themes/catppuccin-latte-search-native.png)     | [Theme selection](assets/themes/catppuccin-latte-selection-native.png)     |
| Catppuccin Frappé    | [Prose / code / diff](assets/themes/catppuccin-frappe-native.png)    | [Tool states](assets/themes/catppuccin-frappe-states-native.png)    | [Pi search](assets/themes/catppuccin-frappe-search-native.png)    | [Theme selection](assets/themes/catppuccin-frappe-selection-native.png)    |
| Catppuccin Macchiato | [Prose / code / diff](assets/themes/catppuccin-macchiato-native.png) | [Tool states](assets/themes/catppuccin-macchiato-states-native.png) | [Pi search](assets/themes/catppuccin-macchiato-search-native.png) | [Theme selection](assets/themes/catppuccin-macchiato-selection-native.png) |
| Catppuccin Mocha     | [Prose / code / diff](assets/themes/catppuccin-mocha-native.png)     | [Tool states](assets/themes/catppuccin-mocha-states-native.png)     | [Pi search](assets/themes/catppuccin-mocha-search-native.png)     | [Theme selection](assets/themes/catppuccin-mocha-selection-native.png)     |
| Tokyo Night Day      | [Prose / code / diff](assets/themes/tokyonight-day-native.png)       | [Tool states](assets/themes/tokyonight-day-states-native.png)       | [Pi search](assets/themes/tokyonight-day-search-native.png)       | [Theme selection](assets/themes/tokyonight-day-selection-native.png)       |
| Tokyo Night Night    | [Prose / code / diff](assets/themes/tokyonight-night-native.png)     | [Tool states](assets/themes/tokyonight-night-states-native.png)     | [Pi search](assets/themes/tokyonight-night-search-native.png)     | [Theme selection](assets/themes/tokyonight-night-selection-native.png)     |
| Gruvbox Light Medium | [Prose / code / diff](assets/themes/gruvbox-light-medium-native.png) | [Tool states](assets/themes/gruvbox-light-medium-states-native.png) | [Pi search](assets/themes/gruvbox-light-medium-search-native.png) | [Theme selection](assets/themes/gruvbox-light-medium-selection-native.png) |
| Gruvbox Dark Medium  | [Prose / code / diff](assets/themes/gruvbox-dark-medium-native.png)  | [Tool states](assets/themes/gruvbox-dark-medium-states-native.png)  | [Pi search](assets/themes/gruvbox-dark-medium-search-native.png)  | [Theme selection](assets/themes/gruvbox-dark-medium-selection-native.png)  |
| Rosé Pine Dawn       | [Prose / code / diff](assets/themes/rose-pine-dawn-native.png)       | [Tool states](assets/themes/rose-pine-dawn-states-native.png)       | [Pi search](assets/themes/rose-pine-dawn-search-native.png)       | [Theme selection](assets/themes/rose-pine-dawn-selection-native.png)       |
| Rosé Pine Main       | [Prose / code / diff](assets/themes/rose-pine-native.png)            | [Tool states](assets/themes/rose-pine-states-native.png)            | [Pi search](assets/themes/rose-pine-search-native.png)            | [Theme selection](assets/themes/rose-pine-selection-native.png)            |

Truecolor is the verified target. Pi's 256-color approximation is inherited;
identical rendering and untested terminal environments are not claimed.
