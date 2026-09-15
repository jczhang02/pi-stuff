# Themes

[简体中文](i18n/zh-CN/themes.md) · English is normative.

Pi Stuff bundles ten static Pi themes. Loading the package adds them to Pi's
theme selector and preserves your current selection. No extra theme dependency
or Pi Stuff theme command is installed.

## Load and select

From a checkout with the [development dependencies](../CONTRIBUTING.md#verify-changes)
installed, load the package directory:

```sh
pi -e /absolute/path/to/pi-stuff
```

Select **Theme** in `/settings`. To save the package for later sessions, use
`pi install /absolute/path/to/pi-stuff`. Loading only the extension entrypoint
does not load the package's theme resources. Selecting a theme in Pi applies
and saves it normally; installation does not select one for you.

| Theme name             | Appearance | Official variant |
| ---------------------- | ---------- | ---------------- |
| `catppuccin-latte`     | Light      | Latte            |
| `catppuccin-frappe`    | Dark       | Frappé           |
| `catppuccin-macchiato` | Dark       | Macchiato        |
| `catppuccin-mocha`     | Dark       | Mocha            |
| `tokyonight-day`       | Light      | Day              |
| `tokyonight-night`     | Dark       | Night            |
| `gruvbox-light-medium` | Light      | Medium contrast  |
| `gruvbox-dark-medium`  | Dark       | Medium contrast  |
| `rose-pine-dawn`       | Light      | Dawn             |
| `rose-pine`            | Dark       | Main             |

Names intentionally have no Pi Stuff prefix. Pi retains one resource when names
collide and reports a collision; another installed package with the same name
will not necessarily appear as a separate choice. Use Pi's resource configuration
to disable the unwanted source. Pi Stuff does not change resource precedence.

## Automatic appearance

Pi 0.85.1 has an **Automatic** entry in the theme selector. Choose a light and
dark theme there. Recommended pairs are:

| Light                  | Dark                  |
| ---------------------- | --------------------- |
| `catppuccin-latte`     | `catppuccin-mocha`    |
| `tokyonight-day`       | `tokyonight-night`    |
| `gruvbox-light-medium` | `gruvbox-dark-medium` |
| `rose-pine-dawn`       | `rose-pine`           |

These are suggestions, not installed defaults. Frappé and Macchiato can replace
Mocha in your own pair. To choose a pair for one launch without changing the
saved setting:

```sh
pi -e /absolute/path/to/pi-stuff --use-theme catppuccin-latte/catppuccin-mocha
```

Pi follows the terminal's reported appearance. Live changes depend on the
terminal providing the corresponding notifications; Pi Stuff adds no detector.

## Terminal background and export

A Pi theme changes text and supported component backgrounds, not the terminal's
whole background. Use a light terminal for light themes and a dark terminal for
dark themes. Each resource's `vars.base` is the family's base background if you
want to match it in your terminal configuration; `vars.text` is its foreground.
Pi Stuff does not modify terminal settings.

`/export` uses the theme's explicit page, card and information-area backgrounds.
Those HTML fields do not set the TUI background. Truecolor is the primary target;
256-color terminals use Pi's approximation and can look different.

## Palette sources and mapping

These are Pi Stuff mappings of official palettes, not official ports endorsed
by the theme authors. All resources explicitly supply the 56 known Pi 0.85.1
color tokens, including its optional scrollbar, search and maximum-thinking
colors, plus HTML export colors. The package uses Pi's loader and validator.

| Family      | Fixed palette source                                                                                                                                                                                                                                                     | Retained license                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Catppuccin  | [Palette tables, d09787d](https://github.com/catppuccin/catppuccin/blob/d09787dd98ca6fba08af5ef2ae94a7e09f17daca/README.md)                                                                                                                                              | [MIT](../themes/licenses/catppuccin.txt)                         |
| Tokyo Night | [Day](https://github.com/folke/tokyonight.nvim/blob/cdc07ac78467a233fd62c493de29a17e0cf2b2b6/extras/lua/tokyonight_day.lua) and [Night](https://github.com/folke/tokyonight.nvim/blob/cdc07ac78467a233fd62c493de29a17e0cf2b2b6/extras/lua/tokyonight_night.lua), cdc07ac | [Apache-2.0](../themes/licenses/tokyonight.txt)                  |
| Gruvbox     | [Palette definitions, 5d15b27](https://github.com/morhetz/gruvbox/blob/5d15b2765f59754d7ac263c88a0f6e3e58124951/colors/gruvbox.vim)                                                                                                                                      | [MIT/X11 and source attribution](../themes/licenses/gruvbox.txt) |
| Rosé Pine   | [Palette definitions, ff48305](https://github.com/rose-pine/neovim/blob/ff483051a47e27d84bdef47703538df1ed9f4a47/lua/rose-pine/palette.lua)                                                                                                                              | [MIT](../themes/licenses/rose-pine.txt)                          |

The official palette values are retained as named variables relevant to the Pi
mapping. The JSON files contain the authoritative mapping and final values:

- Catppuccin uses mauve accents, blue links, subtext for secondary text, and
  surface colors for message/selection backgrounds.
  Latte uses the official maroon for warning/type and number text: its original
  yellow and peach have only about 2.3:1 and 2.6:1 contrast against the base.
- Tokyo Night uses the upstream exported Day/Night palettes, including their
  distinct backgrounds and visual selections. Day uses its main foreground for
  secondary text to avoid the very faint upstream comment shade.
- Gruvbox uses unmodified medium base colors, opposite-mode foregrounds, bright
  accents in dark mode and faded accents in light mode.
- Rosé Pine uses iris/foam in Main and pine for Dawn's main accents. Dawn also
  uses pine for success, warning and type text where brighter gold/leaf colors
  would be harder to read on a light background. State labels still distinguish
  success from warning.

Only `successBg`, `errorBg` and `infoBg` are new mixed colors: each RGB channel is
88% `base` plus 12% of `green`, `red` or `yellow`, respectively, rounded to the
nearest integer. This is an sRGB-channel mix, not an opacity applied at runtime.
The export page uses `base`, cards use `surface`, and information areas use
`infoBg`. Other values are official palette colors.

[Pi Community Themes](https://github.com/hasit/pi-community-themes/tree/a6d7731fd46db4721654bf45161fb2cd1e8cbc1e)
informed the variant naming and
[Pi Catppuccin](https://github.com/otahontas/pi-coding-agent-catppuccin/tree/9a716a630c911a4d29d9520a8d5f87e3b8867f93#design-notes)
informed the subdued state-background approach. Their theme files are not
runtime dependencies. Pi Stuff's semantic mappings were written here rather
than importing their complete mappings. The packaged upstream license notices
cover the palette material; future palette changes should update the source
revision and review both light and dark output.
