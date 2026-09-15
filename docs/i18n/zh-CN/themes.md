# 主题

[English](../../themes.md) · 以英文为准.

Pi Stuff 随包提供十款静态 Pi 主题. 加载包会将它们加入 Pi 主题选择器, 并保留当前选择. 不安装额外主题依赖或 Pi Stuff 主题命令.

## 加载与选择

在已安装[开发依赖](CONTRIBUTING.md#验证变更)的检出中, 加载包目录:

```sh
pi -e /absolute/path/to/pi-stuff
```

在 `/settings` 中选择 **Theme**. 要保存包供后续会话使用, 执行 `pi install /absolute/path/to/pi-stuff`. 只加载扩展入口不会加载包内主题资源. Pi 正常应用并保存主动选择, 安装不会代你选择主题.

| 主题名称               | 外观 | 官方变体      |
| ---------------------- | ---- | ------------- |
| `catppuccin-latte`     | 浅色 | Latte         |
| `catppuccin-frappe`    | 深色 | Frappé        |
| `catppuccin-macchiato` | 深色 | Macchiato     |
| `catppuccin-mocha`     | 深色 | Mocha         |
| `tokyonight-day`       | 浅色 | Day           |
| `tokyonight-night`     | 深色 | Night         |
| `gruvbox-light-medium` | 浅色 | Medium 对比度 |
| `gruvbox-dark-medium`  | 深色 | Medium 对比度 |
| `rose-pine-dawn`       | 浅色 | Dawn          |
| `rose-pine`            | 深色 | Main          |

名称按约定不加 Pi Stuff 前缀. 同名时 Pi 保留一个资源并报告冲突, 其他已安装包的同名主题不一定成为独立选项. 可通过 Pi 资源配置禁用不想使用的来源. Pi Stuff 不改变资源优先级.

## 自动明暗

Pi 0.85.1 主题选择器有 **Automatic** 入口, 可分别选择浅色和深色主题. 推荐配对:

| 浅色                   | 深色                  |
| ---------------------- | --------------------- |
| `catppuccin-latte`     | `catppuccin-mocha`    |
| `tokyonight-day`       | `tokyonight-night`    |
| `gruvbox-light-medium` | `gruvbox-dark-medium` |
| `rose-pine-dawn`       | `rose-pine`           |

这些是建议, 不是安装时设定的默认值. 可用 Frappé 或 Macchiato 替代 Mocha 自行配对. 单次启动使用配对但不修改已保存设置:

```sh
pi -e /absolute/path/to/pi-stuff --use-theme catppuccin-latte/catppuccin-mocha
```

Pi 跟随终端报告的外观. 实时变化依赖终端提供相应通知, Pi Stuff 不新增检测器.

## 终端背景与导出

Pi 主题改变文字和支持的组件背景, 不改变终端整屏底色. 浅色主题配浅色终端, 深色主题配深色终端. 每个资源的 `vars.base` 为系列基础背景, `vars.text` 为前景色, 可用于自行配置终端匹配配色. Pi Stuff 不修改终端设置.

`/export` 使用主题显式指定的页面、卡片和信息区背景. 这些 HTML 字段不设置 TUI 背景. 主要目标是真彩色; 256 色终端沿用 Pi 的近似转换, 效果可能不同.

[验证记录](themes-verification.md)包含原生截图和编译宿主导出要求.

## 色板来源与映射

这些是 Pi Stuff 对官方色板的映射, 不是主题作者认可的官方移植. 每款显式提供 Pi 0.85.1 已知的 56 个颜色字段, 包括可选滚动条、搜索和最高思考等级颜色, 以及 HTML 导出配色. 使用 Pi 自带加载器和校验器.

| 系列        | 固定色板来源                                                                                                                                                                                                                                                            | 保留许可                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Catppuccin  | [色板表, d09787d](https://github.com/catppuccin/catppuccin/blob/d09787dd98ca6fba08af5ef2ae94a7e09f17daca/README.md)                                                                                                                                                     | [MIT](../../../themes/licenses/catppuccin.txt)             |
| Tokyo Night | [Day](https://github.com/folke/tokyonight.nvim/blob/cdc07ac78467a233fd62c493de29a17e0cf2b2b6/extras/lua/tokyonight_day.lua) 和 [Night](https://github.com/folke/tokyonight.nvim/blob/cdc07ac78467a233fd62c493de29a17e0cf2b2b6/extras/lua/tokyonight_night.lua), cdc07ac | [Apache-2.0](../../../themes/licenses/tokyonight.txt)      |
| Gruvbox     | [色板定义, 5d15b27](https://github.com/morhetz/gruvbox/blob/5d15b2765f59754d7ac263c88a0f6e3e58124951/colors/gruvbox.vim)                                                                                                                                                | [MIT/X11 与来源署名](../../../themes/licenses/gruvbox.txt) |
| Rosé Pine   | [色板定义, ff48305](https://github.com/rose-pine/neovim/blob/ff483051a47e27d84bdef47703538df1ed9f4a47/lua/rose-pine/palette.lua)                                                                                                                                        | [MIT](../../../themes/licenses/rose-pine.txt)              |

官方颜色以 Pi 映射所需的命名变量保留. JSON 文件记录最终映射和值:

- Catppuccin 使用 mauve 强调色、blue 链接、subtext 次要文字和 surface 消息/选中背景.
  Latte 的警告/类型及数字文字使用官方 maroon, 原 yellow 和 peach 对基础背景的对比度仅约 2.3:1 和 2.6:1.
- Tokyo Night 使用上游导出的 Day/Night 色板及各自背景和选中颜色. Day 的次要文字使用主前景色, 避开很淡的上游注释色.
- Gruvbox 保留 Medium 基础背景, 使用另一模式的前景色, 深色配 bright 强调色, 浅色配 faded 强调色.
- Rosé Pine Main 使用 iris/foam, Dawn 主要强调色使用 pine. Dawn 的成功、警告和类型文字也使用 pine, 避免浅底上的亮 gold/leaf 难以阅读. 状态文字仍区分成功与警告.

只有 `successBg`、`errorBg`、`infoBg` 是新增混色: 各 RGB 通道由 88% `base` 与 12% 的 `green`、`red` 或 `yellow` 相加, 四舍五入到整数. 这是 sRGB 通道混合, 不是运行时透明度. 导出页面用 `base`, 卡片用 `surface`, 信息区用 `infoBg`. 其他值均来自官方色板.

[Pi Community Themes](https://github.com/hasit/pi-community-themes/tree/a6d7731fd46db4721654bf45161fb2cd1e8cbc1e)供变体命名参考, [Pi Catppuccin](https://github.com/otahontas/pi-coding-agent-catppuccin/tree/9a716a630c911a4d29d9520a8d5f87e3b8867f93#design-notes)供低饱和度状态背景思路参考. 两者的主题文件都不是运行时依赖. Pi Stuff 的语义映射在本仓库编写, 未整套导入其映射. 包内保留的上游许可声明覆盖色板材料; 后续色板修改应更新来源版本, 并重新检查明暗输出.
