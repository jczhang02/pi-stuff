<!-- translation-source: docs/reference/themes.md; translation-source-sha256: 866f736d416dc802bf3a149041cc9445dc5d7d16cddf27e6bce02f06535b13a6 -->

# 主题

[English](../../../../../docs/reference/themes.md)

Pi Stuff 为 Pi 提供四个 Catppuccin 主题。每个主题都把 Pi 的完整语义颜色契约映射到官方 Catppuccin
Palette 1.8.0 的一个 flavor。

## 可用主题

| Flavor | 设置值 | 风格 |
| --- | --- | --- |
| Catppuccin Latte | `catppuccin-latte` | 浅色暖调背景与深色文字 |
| Catppuccin Frappé | `catppuccin-frappe` | 低饱和冷调深色 |
| Catppuccin Macchiato | `catppuccin-macchiato` | 均衡深色 |
| Catppuccin Mocha | `catppuccin-mocha` | 最深的深色配色 |

## 选择主题

打开 Pi 的 `/settings` 菜单，按设置值选择主题。若要直接设置，请把同一值写入 Pi Host 的
`settings.json`：

```json
{
  "theme": "catppuccin-latte"
}
```

Pi 负责实时切换、truecolor 输出和原生 256 色降级。

## 语义映射

这些主题覆盖 Pi 的文字、强调、边框、状态、Markdown、语法、选择区域和 Tool 状态颜色。Tool 背景在 flavor
的 Base 颜色上使用 12% 混合：

| Tool 状态 | Catppuccin 强调色 |
| --- | --- |
| 等待或活动 | Mauve |
| 成功 | Green |
| 失败 | Red |

这种混合能让 Tool 状态保持清晰，同时继续使用 Pi 的渲染路径。

## 调色板与许可

源调色板为 [Catppuccin Palette 1.8.0](https://github.com/catppuccin/palette/blob/v1.8.0/palette.json)。
调色板条款记录在相邻的[主题许可证](../../../../../packages/pi-stuff/themes/LICENSE)中；Suite 许可见仓库的
[MIT License](../../../../../LICENSE)。
