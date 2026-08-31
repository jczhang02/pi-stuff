<!-- translation-source: packages/pi-stuff/src/codex/README.md; translation-source-sha256: 95f8ced0c236d1c4613a9d9b0355a4ed864052b92fe28f8f99b8eb5c1b6119c9 -->

# Codex

[English](../../../../../../../packages/pi-stuff/src/codex/README.md)

为受支持的 OpenAI Codex Responses model 提供 Fast mode、用量显示和原生 Tool。

## 快速开始

```text
/login openai-codex
/codex
```

使用 `/codex fast` 切换 priority service，使用 `/codex usage` 刷新当前 allowance。

## 亮点

- 只为受支持的 `openai-codex` Responses model 激活。
- 把 Fast mode 持久化到合并 Pi Stuff 设置。
- 可用时显示 weekly 与 five-hour 剩余额度。
- 让 Codex 用量刷新保持进程局部和有界。
- 提供 `apply_patch`；支持图像的 model 还提供 `view_image` 与 `imagegen`。
- 把 Fast 和 weekly remaining 状态加入共享 Statusline。

## 文档

- [Codex 指南](../../../../docs/capabilities/codex.md)
- [命令参考](../../../../docs/reference/commands.md#codex-与-rtk)
- [设置参考](../../../../docs/reference/settings.md#codex)
- [故障排查](../../../../docs/troubleshooting.md#codex-与-code-mode)

