<!-- translation-source: packages/pi-stuff/src/codex/README.md; translation-source-sha256: bf74ce7704cb9728ce258c29656cff47c4193d2745ec037d3853927947ad9c40 -->

# Pi Stuff Codex

Codex 模块为 Pi Stuff 提供一个 `/codex` 命令对话框、Fast 模式、Codex 订阅用量，以及选定的 `apply_patch`、`view_image` 和 `imagegen` 工具。它不会替换 Pi 的 Provider、Shell、压缩、会话或 TUI。

该能力在导入和启动期间保持冷态。只有打开 `/codex`，或用户驱动的交互式 Codex Agent 运行真正空闲稳定后，用量功能才进行网络 I/O。自动工作和非 Codex 运行不会刷新用量；重叠的运行后请求合并为一次尾随刷新；失败时保留最后观察到的快照。原生辅助程序只在实际工具调用时启动。认证缺失、模型不受支持或原生辅助程序不可用会成为有界命令或工具错误；普通 Pi 工作仍可使用。

每次用量刷新都作为一个由 Session 负责的 Effect operation 运行。十秒超时和调用方取消由 Effect 负责，Capability adapter 只保留原生的认证 `fetch`。Pi-facing adapter 会把类型化失败投影回现有 Command Dialog 和通知结果；已被替换 Session 的完成结果不能更新共享用量快照或 Statusline。

`imagegen` 只为支持图像的 OpenAI Codex Responses 模型启用，并始终请求 `gpt-image-2`。当前已验证的原生辅助程序目标是 Linux x64。

## 命令

- `/codex` 打开全宽非浮动控制界面，并加载当前用量。
- `/codex fast` 切换 Fast 模式。启用后 Codex 请求会携带真实的 `priority` service tier。
- `/codex usage` 打开同一界面并刷新用量。

## 工具

- `apply_patch` 无需 Shell 包装即可应用 Codex 补丁封装。
- `view_image` 为支持图像的 Codex 模型加载本地图像。
- `imagegen` 使用 `gpt-image-2` 生成或编辑图像，并把结果保存到 `.pi/openai-codex-images/`。

三个工具都使用共享 Pi Stuff 工具生命周期渲染器。图像工具在共享生命周期行下保留行内终端媒体作为结果正文。对于 `imagegen`，Pi Stuff 保留原生结构化结果与生成路径文本，再以 best-effort 方式内联最多四个可读、每个不超过 25 MiB 的普通文件。Pi 0.84.4 公开 `detectSupportedImageMimeTypeFromFile()` 会从文件字节识别 JPEG、PNG、GIF、WebP 与 BMP；不支持、缺失、超大或不可读的文件会保留文本结果，不会产生 MIME 错标。

该媒体结果本身并不认证 tmux 内的图像显示。渲染仍由 Pi 与当前终端协议负责，包括 multiplexer 的 passthrough 要求；Codex 不修改终端设置。
