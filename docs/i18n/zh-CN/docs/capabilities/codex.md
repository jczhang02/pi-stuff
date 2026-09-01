<!-- translation-source: docs/capabilities/codex.md; translation-source-sha256: 3e7507769d6dcb91ec07c985100f09f621e45932dcd75dc7c70a623b64bd9095 -->

# Codex

[English](../../../../../docs/capabilities/codex.md)

当 Pi 使用受支持的 OpenAI Codex Responses model 时，Codex 提供 Fast mode、用量显示和 Codex 专属 Tool。

## 要求

活动 model 必须使用 `openai-codex` provider 和 Responses API 界面。在 Pi 中运行以下命令认证：

```text
/login openai-codex
```

图像 Tool 还要求 model 声明支持图像输入。

## 快速开始

选择受支持的 Codex model，然后运行：

```text
/codex
```

Dialog 显示 Fast mode、用量和当前 model 可用的 Tool。

## 命令

| 命令 | 操作 |
| --- | --- |
| `/codex` | 打开 Codex 控制 |
| `/codex fast` | 切换 Fast mode |
| `/codex usage` | 刷新用量 |

不接受其他子命令。

## Fast mode

Fast mode 默认关闭，保存为 `codex.fast`。开启后，Pi Stuff 为受支持的 OpenAI Codex request 加入
`service_tier: "priority"`。其他 provider 与 API 界面不变。

启用时，共享 Statusline 显示 `fast`。

## 用量

用量只保存在当前进程。打开 `/codex`、运行 `/codex usage`，或一次交互式用户启动运行结算后会刷新。
Request timeout 为 10 秒，offline mode 下不执行。

可用时，dialog 显示 weekly 与 five-hour 剩余额度。Statusline 可以显示 weekly remaining；在该界面上，
Codex 用量会替代货币 cost。认证、网络或不受支持账号的失败显示 `Usage unavailable`，不会阻止 conversation。

## Tool

受支持的 Codex model 提供 `apply_patch`。支持图像的 model 还提供：

- `view_image`：检查本地图像；
- `imagegen`：通过 `gpt-image-2` 生成或编辑图像。

生成图像保存在本地，最多四个符合条件的文件可以行内投影。Native helper 会按当前平台解析；不可用时返回有界
Tool error。

## 认证

Pi Stuff 使用活动 model registry entry 及其 API key 或 Bearer 认证。Account identity 与默认 Codex backend
URL 从已经认证的 model 推导。无法解析账号时，使用 `/login openai-codex`。

## 相关文档

- [Codex Module README](../../packages/pi-stuff/src/codex/README.md)
- [命令参考](../reference/commands.md#codex-与-rtk)
- [设置参考](../reference/settings.md#codex)
- [故障排查](../troubleshooting.md#codex-与-code-mode)

