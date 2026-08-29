<!-- translation-source: docs/research/pi-tmux-kitty-images-feasibility-20260815.md; translation-source-sha256: dfd54ed6812e7c500534d0934cf2cd7b9b4d89eb3cb72050d413914c2e9d2a47 -->
# tmux 中的 Pi 图像

日期：2026-08-15

## 问题

Pi Stuff 能否适配
[`pi-warp-kitty-images`](https://github.com/monotykamary/pi-warp-kitty-images)，使 Pi 在 tmux
中运行时渲染行内图像？

## 结论

**可以，但不能复制所引用的 Extension。** 它是能力覆盖，而不是图像传输。Pi 的认证 Host
已经负责图像规范化、布局、缓存、重绘、回退和清理。在 tmux 下，它会有意报告
`images: null`，而其 Kitty 编码器会发出裸 APC 图形序列。只有当应用程序将应用程序定义的序列
包装进 tmux 的 DCS 直通封装，并且用户启用了 `allow-passthrough` 时，tmux 才会转发该序列。

最小且可靠的设计属于 Pi TUI，而不是新的 Pi Stuff Capability Module：

1. 在 tmux 内运行时，检测支持 Kitty 图形的外层终端。
2. 要求启用 tmux 直通，并包装图形上传、查询和删除序列。
3. 对实现 Kitty Unicode 占位符的终端，创建虚拟放置，并将 `U+10EEEE`
   占位符作为普通 TUI 单元格渲染。这样 tmux 可以移动和重绘这些单元格，而无需理解图像。
4. 当任一能力检查失败时，保留 Pi 现有的文本回退。

Pi Stuff 的 `view_image` 和 `imagegen` Tools 不需要改变传输方式：它们已经返回原生 Pi
`image` 内容。

这里有一个重要的终端特定分支：

- Kitty 明确为 tmux 等 Host 应用记录了 Unicode 占位符。这是 Kitty 及支持该功能的兼容实现的首选路径。
- Warp 当前源码会解析 `U=1`，但将其拒绝为不支持。直接 DCS 直通放置在 Warp 中最初可能显示，
  但 tmux 不拥有该图像状态，在重绘、窗格变化、滚动或调整大小期间可能覆盖或遗留它。这适合
  概念验证，不适合认证的 Pi Stuff 路径。

## 所引用仓库实际做了什么

在固定的 HEAD `ff25e514e1f89950b79b944c3cb74c4580fff94d` 中，整个实现只有一个
`session_start` 处理器。当 `TERM_PROGRAM=warpterminal` 且 Pi 当前报告没有图像协议时，
它调用 `setCapabilities()`，设置 `images: "kitty"`、真彩色和超链接：

- [`extensions/index.ts` lines 1-21](https://github.com/monotykamary/pi-warp-kitty-images/blob/ff25e514e1f89950b79b944c3cb74c4580fff94d/extensions/index.ts#L1-L21)
- [`README.md` lines 18-63](https://github.com/monotykamary/pi-warp-kitty-images/blob/ff25e514e1f89950b79b944c3cb74c4580fff94d/README.md#L18-L63)
- [`package.json` lines 1-9](https://github.com/monotykamary/pi-warp-kitty-images/blob/ff25e514e1f89950b79b944c3cb74c4580fff94d/package.json#L1-L9)

它没有渲染器、tmux 检测、DCS 包装器、协议查询、图像 ID、重绘逻辑、清理逻辑、测试或运行时
依赖。在 tmux 外，认证的 Pi 版本已经自行检测 Warp，因此该覆盖在那里是多余的。

## 认证的 Pi 行为

Pi Stuff 认证 Pi `0.84.2`，对应上游提交 `914cf1472e715297caa30db4b9535d534a9eb718`；
参见
[`docs/compatibility.md`](../compatibility.md#certified-host)。

认证的 TUI 在检查 Kitty、Ghostty、WezTerm 或 Warp 之前先检查 tmux，并返回
`images: null`，因为图像协议被认为不可靠地穿过 tmux：

- [`terminal-image.ts` lines 47-102](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/tui/src/terminal-image.ts#L47-L102)

启用 Kitty 时，`encodeKitty()` 发出原始的 `ESC _G ... ESC \\` 块。它没有 tmux 封装或占位符模式：

- [`terminal-image.ts` lines 154-240](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/tui/src/terminal-image.ts#L154-L240)
- [`terminal-image.ts` lines 571-614](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/tui/src/terminal-image.ts#L571-L614)

Image 组件分配一个 ID，在首次渲染的行上发出 Kitty 传输，并添加空行，使 TUI 能按图像高度进行
布局。备用屏幕渲染器负责重新传输、复用放置、驱逐和清理：

- [`components/image.ts` lines 61-126](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/tui/src/components/image.ts#L61-L126)
- [`tui-alt-screen.ts` lines 300-384](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/tui/src/tui-alt-screen.ts#L300-L384)

因此，仅强制设置 `images: "kitty"` 会绕过 tmux 守卫，却没有加入使该守卫成为必要的传输机制。

## tmux 和 Kitty 协议要求

Kitty 图形命令是形如 `ESC _G ... ESC \\` 的 APC 序列，直接传输的数据会被拆分为不超过
4096 字节的块。该协议定义了查询操作，使客户端能够区分受支持和不受支持的终端：

- [Kitty graphics escape code](https://sw.kovidgoyal.net/kitty/graphics-protocol/#the-graphics-escape-code)
- [Kitty support query](https://sw.kovidgoyal.net/kitty/graphics-protocol/#querying-support-and-available-transmission-mediums)

tmux 不会透明转发任意终端序列。其文档化的直通契约是一个带有 `tmux;` 前缀的 DCS
包装器，并将每个内部 ESC 加倍。自 tmux 3.3 起，`allow-passthrough` 必须设为 `on` 或 `all`；
`on` 会将直通限制在可见窗格：

- [tmux passthrough FAQ](https://github.com/tmux/tmux/wiki/FAQ#what-is-the-passthrough-escape-sequence-and-how-do-i-use-it)
- [tmux `allow-passthrough` manual entry](https://man7.org/linux/man-pages/man1/tmux.1.html)

Kitty 在 0.28.0 中加入 Unicode 占位符，专门让 tmux 这类理解 Unicode 的 Host 应用能够用普通文本
移动图像。应用程序静默上传图像，使用 `U=1` 创建虚拟放置，并发出 `U+10EEEE` 单元格；其颜色
和附加符号编码图像、放置、行和列 ID：

- [Kitty Unicode placeholders](https://sw.kovidgoyal.net/kitty/graphics-protocol/#unicode-placeholders)

Warp 当前不兼容这一可靠路径。在固定的 Warp HEAD
`a9c0a1ebda0acfe5e57b6f6df7c6ef744a71f8eb` 中，`U=1` 会被解析，但存储并显示以及显示已存储操作
都会返回 `UnicodePlaceholderUnsupported`：

- [`kitty.rs` lines 299-375](https://github.com/warpdotdev/warp/blob/a9c0a1ebda0acfe5e57b6f6df7c6ef744a71f8eb/app/src/terminal/model/kitty.rs#L299-L375)
- [`kitty.rs` lines 607-719](https://github.com/warpdotdev/warp/blob/a9c0a1ebda0acfe5e57b6f6df7c6ef744a71f8eb/app/src/terminal/model/kitty.rs#L607-L719)

## Pi Stuff 架构适配性

现有媒体边界已经正确：

- [`codex/tools.ts` lines 165-211](../../../../../packages/pi-stuff/src/codex/tools.ts#L165-L211) 从 `view_image`
  返回原生 `image` 内容。
- [`codex/tools.ts` lines 215-277](../../../../../packages/pi-stuff/src/codex/tools.ts#L215-L277) 将生成的图像
  作为原生图像块返回。
- [ADR 0005，现已合并至 ADR 0009](../adr/0009-align-code-mode-with-openai-and-cloudflare.md) 要求嵌套媒体重新进入
  Pi 的普通规范化和渲染器，使普通终端、回退终端和恢复的 Session 共用同一路径。
- [ADR 0001](../adr/0001-keep-pi-as-the-host.md) 保持 TUI 和 Session 渲染器由 Host 所有。
- [ADR 0004](../adr/0004-route-suite-diagnostics-through-owned-ui.md) 排除了在 Host TUI 内使用原始 stdout 技巧。

Pi Stuff 已在
[`notification/transport.ts` lines 37-55](../../../../../packages/pi-stuff/src/notification/transport.ts#L37-L55)
中拥有一个小型 tmux DCS 包装器，但它发送的是一次性终端通知。在进程级 stdout 拦截器中复用这一
思路，无法提供 tmux 的图像单元格所有权、重绘、裁剪、驱逐或清理，并且会违反由 Host 所拥有的
呈现边界。

## 建议范围

### 可合并路径

在 Pi TUI 中实现并认证支持 tmux 的 Kitty Unicode 占位符渲染，然后将 Pi Stuff 的认证 Host
配置文件移至经过审查的上游修订版。不要再添加 Pi Stuff 图像 Tool 或渲染器。

能力门控应要求以下全部条件：

- 交互式 TUI 模式；
- 启用直通的 tmux 3.3 或更新版本；
- 成功的 DCS 包装 Kitty 图形查询，或同等强度的已确认外层终端信号；
- 稳健模式所需的 Unicode 占位符支持；
- 现有的 `terminal.showImages` 设置。

任一检查失败时，保留 Pi 现有的文本回退。除非必须允许不可见窗格发送图形，否则不需要
`allow-passthrough all`；`on` 是更安全的默认值。

### 一次性概念验证

仅用于快速本地实验：复制所引用仓库的能力覆盖，并为 Pi 的 Kitty 上传、放置和删除序列添加
DCS 包装。这可以证明字节传输能够通过一个可见窗格。它不应进入 Pi Stuff Package，因为直接放置
不会在 tmux 的单元格缓冲区中表示，也无法建立正确的窗格切换、调整大小、滚动或重绘行为。

## 验收检查

最小有意义的认证需要一个在真实 tmux 服务器内运行的真实 Pi Host PTY fixture，以及针对字节编码
的纯检查：

1. 支持的外层终端 + `allow-passthrough on`：PNG 在预期的单元格矩形中渲染。
2. 直通关闭、不支持的外层终端、非交互模式或 `terminal.showImages: false`：有界文本回退，
   且没有图形字节。
3. 隐藏/显示窗格、拆分、调整大小、TUI 调整大小、滚动、退出备用屏幕、重新加载 Session 以及
   Host 关闭后，不留下陈旧图像，并恢复相同的 transcript 布局。
4. 上传、放置、驱逐和删除命令恰好各被 DCS 包装一次；内部 ESC 字节被加倍。
5. tmux 外部现有的直接 Kitty 渲染保持字节等价。
6. Pi Stuff 现有的 `view_image`、`imagegen`、嵌套 Code Mode 媒体和提取 Package 检查保持不变。

任何测试都不应调用 LLM 或要求凭据。
