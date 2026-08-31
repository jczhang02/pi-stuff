<!-- translation-source: docs/capabilities/notification.md; translation-source-sha256: b5dc892a43301b7978c51495b612981461487dd583f56453754e77d751ebacbd -->

# Notification

[English](../../../../../docs/capabilities/notification.md)

Notification 在有实质内容的用户启动 Agent 工作结算、且 Pi 保持安静后发送终端原生提醒。

## 快速开始

在交互终端中运行 Pi，并打开：

```text
/notifications
```

查看当前策略并发送测试通知。使用默认值时，真实提醒要求至少 10 秒 Agent Work Duration，之后再经过 2 秒安静
宽限期。

## 何时发送提醒

满足以下条件时，一个工作周期才可以提醒：

1. Agent 运行来自直接用户工作；
2. 运行已经完全结算；
3. Agent Work Duration 达到 `minimumDurationMs`；
4. Pi 在 `gracePeriodMs` 内保持 idle，且没有 pending message；
5. 对应的完成或失败提醒已经开启。

等待 Pi 输入、确认或权限 prompt 的时间会从 Agent Work Duration 中扣除。宽限期内出现终端输入、新工作或
pending message，会取消待发送提醒。

单独由 Extension 发起的自动工作不会触发提醒。被中止的运行或没有最终 Assistant message 的运行保持安静。
发生错误的运行产生失败提醒；其他符合条件的结果产生完成提醒。

## 设置

`/notifications` 控制：

- Notification、完成和失败开关；
- 最短 Agent Work Duration 与安静宽限期；
- delivery 协议；
- response preview；
- terminal bell 与 tmux attention 行为；
- 测试 delivery。

默认值和准确 JSON 字段见[设置参考](../reference/settings.md#notification)。

## Delivery

| Delivery | 用途 |
| --- | --- |
| `auto` | 检测受支持终端并选择视觉协议 |
| `kitty` | Kitty OSC 99 |
| `osc777` | Ghostty OSC 777 |
| `osc9` | iTerm2 与 WezTerm OSC 9 |
| `bell` | BEL |

自动检测会根据终端环境选择 Kitty、Ghostty、iTerm2 或 WezTerm。在 tmux 之外，未知终端无法接收视觉通知；
只有有效策略允许时才退化到 BEL。

Delivery 只在 Pi 交互式 TUI 中运行。Print、JSON、RPC 和 headless mode 不会写入通知序列。

## tmux

tmux 内的视觉通知序列需要：

```tmux
set -g allow-passthrough on
```

视觉协议会包装成 tmux passthrough。开启 `tmuxNotification` 时，Pi Stuff 额外发送一个 attention BEL。
关闭后保留受支持的视觉 delivery，并禁止 tmux 内所有通知 BEL，包括显式 `bell` delivery。

tmux 负责 marker 样式和切换焦点后的清除时机。Notification passthrough 不会配置行内图像。

## 隐私与内容

`responsePreview` 默认关闭，因此完成通知使用简短通用正文。失败通知不会暴露 model error。

开启 preview 后，只使用最终 Assistant message 中有界的文字。围栏代码会跳过，Markdown 会展平，控制序列
会移除。标题最多 64 个终端列，正文最多 160 个。

Pi 失去焦点后，桌面通知历史仍可能可见。共享桌面或回答可能包含敏感信息时，请保持 preview 关闭。

## Bell 行为

在 tmux 之外，`terminalBell` 可以为视觉通知额外发送 BEL。BEL 产生声音、视觉提示还是没有动作，由终端决定。
如果 BEL 表现不符合预期，请配置终端本身。

## 相关文档

- [Notification Module README](../../packages/pi-stuff/src/notification/README.md)
- [设置参考](../reference/settings.md#notification)
- [故障排查](../troubleshooting.md#通知)
- [命令参考](../reference/commands.md)
