<!-- translation-source: packages/pi-stuff/src/codex/README.md; translation-source-sha256: 434b384df24b86db23bd90c0c8b2382bac0039bfc0a0dff85c3676f5de00f10e -->

# Pi Stuff Codex

Codex 模块为 Pi Stuff 提供一个 `/codex` 命令对话框、Fast 模式、Codex 订阅用量，以及选定的 `apply_patch`、`view_image` 和 `imagegen` 工具。它不会替换 Pi 的 Provider、Shell、压缩、会话或 TUI。

该能力在导入和启动期间保持冷态。只有打开 `/codex`，或用户驱动的交互式 Codex Agent 运行真正空闲稳定后，用量功能才进行网络 I/O。自动工作和非 Codex 运行不会刷新用量；重叠的运行后请求合并为一次尾随刷新；失败时保留最后观察到的快照。原生辅助程序只在实际工具调用时启动。认证缺失、模型不受支持或原生辅助程序不可用会成为有界命令或工具错误；普通 Pi 工作仍可使用。

`imagegen` 只为支持图像的 OpenAI Codex Responses 模型启用，并始终请求 `gpt-image-2`。当前已验证的原生辅助程序目标是 Linux x64。

## 命令

- `/codex` 打开全宽非浮动控制界面，并加载当前用量。
- `/codex fast` 切换 Fast 模式。启用后 Codex 请求会携带真实的 `priority` service tier。
- `/codex usage` 打开同一界面并刷新用量。

## 工具

- `apply_patch` 无需 Shell 包装即可应用 Codex 补丁封装。
- `view_image` 为支持图像的 Codex 模型加载本地图像。
- `imagegen` 使用 `gpt-image-2` 生成或编辑图像，并把结果保存到 `.pi/openai-codex-images/`。

三个工具都使用共享 Pi Stuff 工具生命周期渲染器。图像工具在共享生命周期行下保留行内终端媒体作为结果正文。
