# Themes

[Simplified Chinese](../i18n/zh-CN/docs/reference/themes.md)

Pi Stuff includes four Catppuccin themes for Pi. Each maps Pi's full semantic color contract to one flavor of the
official Catppuccin Palette 1.8.0.

## Available themes

| Flavor | Settings value | Character |
| --- | --- | --- |
| Catppuccin Latte | `catppuccin-latte` | Light, warm background with dark text |
| Catppuccin Frappé | `catppuccin-frappe` | Muted cool dark palette |
| Catppuccin Macchiato | `catppuccin-macchiato` | Balanced dark palette |
| Catppuccin Mocha | `catppuccin-mocha` | Deepest dark palette |

## Select a theme

Open Pi's `/settings` menu and choose the theme by its settings value. To set it directly, store the same value in the
Pi Host's `settings.json`:

```json
{
  "theme": "catppuccin-latte"
}
```

Pi applies live switching, truecolor output, and its native 256-color fallback.

## Semantic mapping

The themes cover Pi's text, emphasis, borders, status, Markdown, syntax, selection, and Tool-state colors. Tool
backgrounds use a 12% blend over the flavor's Base color:

| Tool state | Catppuccin accent |
| --- | --- |
| Pending or active | Mauve |
| Success | Green |
| Failure | Red |

The blends keep Tool state visible without replacing Pi's rendering path.

## Palette and license

The source palette is [Catppuccin Palette 1.8.0](https://github.com/catppuccin/palette/blob/v1.8.0/palette.json).
Palette terms are recorded in the adjacent
[theme license](../../packages/pi-stuff/themes/LICENSE); Suite licensing is covered by the repository
[MIT License](../../LICENSE).
