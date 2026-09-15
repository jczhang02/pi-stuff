# 主题验证

[English](../../themes-verification.md) · 以英文为准.

本记录对应 [issue #95](https://github.com/jczhang02/pi-stuff/issues/95) 的十款主题. 用法与固定来源版本见[主题指南](themes.md).

## 宿主与方法

验证使用 Pi 0.85.1、Bun 1.4.0 和仓库固定的 Terminal Control 1.2.1. 系统测试通过 `-e` 加载真实包目录, 使用隔离设置和确定性的本地提供方. 覆盖包资源注册、原生选择与保存、四组推荐自动配对, 以及十款主题的原生 HTML 导出.

自动明暗测试发送终端原生外观报告: `ESC[?997;2n` 表示浅色, `ESC[?997;1n` 表示深色. Terminal Control 默认报告深色, 查询响应优先于 `COLORFGBG`, 单独修改该变量未能触发浅色路径. 这些输入模拟终端通知, 不证明 Ghostty 实时外观切换.

首个整包发现测试在资源加入前失败, 只能看到 Pi 内置的 `dark` 与 `light`; 加入后可发现十款主题. 后续选择、外观和导出测试是在资源实现后补充的.

```sh
bun test tests/system/theme-host.test.ts
PI_TEST_HOST=/absolute/path/to/pi bun test tests/system/theme-host.test.ts
bun run check
bun run test
git diff --check
```

在同步最新 main 的 `c2321f6` 上, `bun run check` 和 `git diff --check` 通过. 完整离线测试通过 124 项、973 条断言. 编译宿主主题专项使用下述资源配置, 通过 7 项、63 条断言. 完整测试中的原有普通/全屏宿主测试也通过.

## 编译宿主的导出资源

本机编译版 Pi 最初执行 `/export` 失败, 原因是相邻 `export-html` 目录缺少 `template.css` 和 `template.js`. 这是宿主安装资源缺失, 不是主题校验失败. 验证保留原可执行文件, 将 `PI_PACKAGE_DIR` 指向隔离资源树, 沿用宿主资源并补充同版本 Pi 0.85.1 包内完整导出模板. 没有修改系统文件.

该可执行文件生成的十份原生导出均已在浏览器打开检查. 回放样例围绕缓存容量修改, 包含 TypeScript、编辑 diff、自定义消息、失败和运行中的工具消息. 页面/卡片背景、次要/思考文字、代码和状态配色可读. 回放验证渲染, 展示的工具调用没有实际执行. 编译安装需要配套导出资源才能复现.

## 原生显示证据

以下是 Ghostty 1.3.1 的实际 1280×900 截图, 不是 Terminal Control 渲染图. 编译版 Pi 运行于 Xvfb/Mutter, 使用私有 D-Bus、隔离 runtime 和中性工作/设置目录. 清除 `WAYLAND_DISPLAY`, 禁止 Ghostty 单实例复用. 字体栈为 JetBrainsMono Nerd Font Mono、Symbols Nerd Font Mono、LXGW WenKai Mono, 字号 12. 各终端使用所选主题的基础背景与前景色.

工具状态截图使用普通模式; 正文、搜索和选择使用全屏模式. 每款均检查正文/思考文字、Markdown/TypeScript、用户/自定义消息、成功编辑 diff、错误输出、尚无结果的工具调用、搜索高亮和选择、边框及 Pi 滚动条. 截图回放真实风格的任务内容, 不执行展示的工具调用, 也不证明实时流式行为.

全屏截图在隔离 Pi 设置中将 `fullscreenScrollbar` 设为 `always`, 将 `tui.altScreen.search` 临时绑定到 `ctrl+f`, 避开 Ghostty 自身搜索快捷键. 搜索 `cache`, 关闭搜索后打开 `/settings` > Theme 检查当前高亮选项. 这些夹具设置不是包默认值. 早期 Ghostty 搜索框和已完成工具的样例被判为不合格, 已替换为真实 Pi 控件及尚无结果的工具渲染.

键盘与指针输入均指定私有 X11 显示. 最终截图批次的宿主 X11 焦点、指针坐标及剪贴板摘要在操作前、中、截图与清理后均一致. 该结果只覆盖此次有界批次, 不构成通用 Wayland 焦点保证. 自有终端、窗口管理器、Xvfb 与私有 D-Bus 会话均已停止. 原生截图通过可用 X11 工具取得, 未提供 CUA 可访问性树检查.

| 主题                 | 正文 / 代码 / diff                                                        | 工具状态                                                               | Pi 搜索                                                               | 主题选择                                                                  |
| -------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Catppuccin Latte     | [正文 / 代码 / diff](../../assets/themes/catppuccin-latte-native.png)     | [工具状态](../../assets/themes/catppuccin-latte-states-native.png)     | [Pi 搜索](../../assets/themes/catppuccin-latte-search-native.png)     | [主题选择](../../assets/themes/catppuccin-latte-selection-native.png)     |
| Catppuccin Frappé    | [正文 / 代码 / diff](../../assets/themes/catppuccin-frappe-native.png)    | [工具状态](../../assets/themes/catppuccin-frappe-states-native.png)    | [Pi 搜索](../../assets/themes/catppuccin-frappe-search-native.png)    | [主题选择](../../assets/themes/catppuccin-frappe-selection-native.png)    |
| Catppuccin Macchiato | [正文 / 代码 / diff](../../assets/themes/catppuccin-macchiato-native.png) | [工具状态](../../assets/themes/catppuccin-macchiato-states-native.png) | [Pi 搜索](../../assets/themes/catppuccin-macchiato-search-native.png) | [主题选择](../../assets/themes/catppuccin-macchiato-selection-native.png) |
| Catppuccin Mocha     | [正文 / 代码 / diff](../../assets/themes/catppuccin-mocha-native.png)     | [工具状态](../../assets/themes/catppuccin-mocha-states-native.png)     | [Pi 搜索](../../assets/themes/catppuccin-mocha-search-native.png)     | [主题选择](../../assets/themes/catppuccin-mocha-selection-native.png)     |
| Tokyo Night Day      | [正文 / 代码 / diff](../../assets/themes/tokyonight-day-native.png)       | [工具状态](../../assets/themes/tokyonight-day-states-native.png)       | [Pi 搜索](../../assets/themes/tokyonight-day-search-native.png)       | [主题选择](../../assets/themes/tokyonight-day-selection-native.png)       |
| Tokyo Night Night    | [正文 / 代码 / diff](../../assets/themes/tokyonight-night-native.png)     | [工具状态](../../assets/themes/tokyonight-night-states-native.png)     | [Pi 搜索](../../assets/themes/tokyonight-night-search-native.png)     | [主题选择](../../assets/themes/tokyonight-night-selection-native.png)     |
| Gruvbox Light Medium | [正文 / 代码 / diff](../../assets/themes/gruvbox-light-medium-native.png) | [工具状态](../../assets/themes/gruvbox-light-medium-states-native.png) | [Pi 搜索](../../assets/themes/gruvbox-light-medium-search-native.png) | [主题选择](../../assets/themes/gruvbox-light-medium-selection-native.png) |
| Gruvbox Dark Medium  | [正文 / 代码 / diff](../../assets/themes/gruvbox-dark-medium-native.png)  | [工具状态](../../assets/themes/gruvbox-dark-medium-states-native.png)  | [Pi 搜索](../../assets/themes/gruvbox-dark-medium-search-native.png)  | [主题选择](../../assets/themes/gruvbox-dark-medium-selection-native.png)  |
| Rosé Pine Dawn       | [正文 / 代码 / diff](../../assets/themes/rose-pine-dawn-native.png)       | [工具状态](../../assets/themes/rose-pine-dawn-states-native.png)       | [Pi 搜索](../../assets/themes/rose-pine-dawn-search-native.png)       | [主题选择](../../assets/themes/rose-pine-dawn-selection-native.png)       |
| Rosé Pine Main       | [正文 / 代码 / diff](../../assets/themes/rose-pine-native.png)            | [工具状态](../../assets/themes/rose-pine-states-native.png)            | [Pi 搜索](../../assets/themes/rose-pine-search-native.png)            | [主题选择](../../assets/themes/rose-pine-selection-native.png)            |

验证目标是真彩色. 256 色沿用 Pi 近似转换, 不承诺效果一致或尚未测试的终端环境.
