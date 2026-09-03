<!-- translation-source: docs/reference/settings.md; translation-source-sha256: 40a735e95c1fa68d8535a0fd34c222acbdc57a26f7ed75282d94426f6e0a37f0 -->

# 设置参考

[English](../../../../../docs/reference/settings.md)

Pi Stuff 把设置保存在 `<agentDir>/pi-stuff.json` 这一份普通 JSON 文档中。每项能力负责一个顶层命名空间，
写入时会保留其他命名空间。

对于 Pi 中已有入口的设置，请使用 `/ui`、`/notifications`、`/autoname settings`、`/goal`、
`/ponytail`、`/rtk`、`/codex` 或 `/codemode`。直接编辑 JSON 适用于高级值；文件必须是有效 JSON，
不支持注释。

## 文件

| 位置 | 用途 |
| --- | --- |
| `<agentDir>/pi-stuff.json` | Pi Stuff 的合并设置 |
| `<agentDir>/settings.json` | Pi Host 设置，包括活动主题 |
| `<project>/.pi/code-mode.json` | 当前受信项目的 Code Mode override |
| 用户 MCP 配置 | Server 声明、连接策略和认证 |
| 外部 Context 配置 | Context engine 与 worker 配置 |

`<agentDir>` 是 Host 解析出的 Pi Agent 目录。

## 各命名空间默认值

### `ui`

| 字段 | 类型 | 默认值 | 控制入口 |
| --- | --- | --- | --- |
| `schemaVersion` | `3` | `3` | 系统管理 |
| `inlineSlashAutocomplete` | boolean | `true` | `/ui` |
| `inputHighlighting` | boolean | `true` | `/ui` |
| `statusline` | boolean | `true` | `/ui` |
| `statuslineDensity` | `auto`、`full` 或 `compact` | `auto` | `/ui` |
| `statuslineLatestPrompt` | boolean | `true` | `/ui` |
| `welcomeHeader` | boolean | `true` | `/ui` |

### `tools`

| 字段 | 类型 | 默认值 | 控制入口 |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | `1` | 系统管理 |
| `liveElapsed` | boolean | `true` | `/ui` |

### `rtk`

| 字段 | 类型 | 默认值 | 控制入口 |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | `1` | 系统管理 |
| `outputProjection` | boolean | `true` | `/rtk` |
| `rewriteCommands` | boolean | `true` | `/rtk` |

`rewriteCommands` 允许符合条件的 shell 命令使用 RTK。启用命令改写后，`outputProjection` 控制 RTK 的紧凑投影输出。

### `codex`

| 字段 | 类型 | 默认值 | 控制入口 |
| --- | --- | --- | --- |
| `fast` | boolean | `false` | `/codex` |

只有活动 model 支持 Codex 控制界面时，该设置才会生效。

### `goal`

| 字段 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `toolVisibility` | `always` 或 `after-first-goal` | `always` | Goal 终止 Tool 何时可见 |
| `experimental.goals` | boolean | `false` | 启用多 Goal 队列命令 |
| `rpc.enabled` | boolean | `false` | 启用 Goal RPC 界面 |
| `continuationLimits.automaticTurns` | 正整数或 `null` | `null` | 自动 turn 上限；`null` 表示不限 |
| `continuationLimits.noProgressTurns` | 正整数或 `null` | `null` | 无进展上限；`null` 表示关闭 |

交互式 Goal 设置界面负责常用的 continuation 与 Tool 可见性选择。

### `fastResume`

| 字段 | 类型 | 默认值 | 控制方式 |
| --- | --- | --- | --- |
| `hijackResume` | boolean | `true` | JSON |
| `shortcut` | 可选 Pi key ID 字符串 | 无 | JSON |

`hijackResume` 在进程内拦截 Pi 内置的 `/resume` 选择器。关闭后保留原生 `/resume`，并注册
`/fast-resume`。`shortcut` 为同一个使用有界 loader 的原生选择器增加 Host 快捷键。启动时只读取该命名空间，
不会创建或重写设置文件；无效值回退到默认值并记录诊断。

### `sessionNaming`

| 字段 | 类型 | 默认值 | 控制入口 |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | `1` | 系统管理 |
| `enabled` | boolean | `true` | `/autoname settings` |
| `cooldownMinutes` | `1` 到 `1440` 的整数 | `10` | `/autoname settings` |
| `respectManualName` | boolean | `false` | `/autoname settings` |
| `model` | 可选 `provider/model` 字符串 | 活动 Session model | `/autoname settings` |
| `fallbackModels` | 有序 `provider/model` 字符串 | `[]` | JSON |

删除 `model` 后，主要路由会恢复为活动 Session model。

### `notification`

| 字段 | 类型 | 默认值 | 控制入口 |
| --- | --- | --- | --- |
| `schemaVersion` | `3` | `3` | 系统管理 |
| `enabled` | boolean | `true` | `/notifications` |
| `completionAlerts` | boolean | `true` | `/notifications` |
| `failureAlerts` | boolean | `true` | `/notifications` |
| `minimumDurationMs` | 非负数 | `10000` | `/notifications` |
| `gracePeriodMs` | 非负数 | `2000` | `/notifications` |
| `delivery` | `auto`、`bell`、`kitty`、`osc9` 或 `osc777` | `auto` | `/notifications` |
| `responsePreview` | boolean | `false` | `/notifications` |
| `terminalBell` | boolean | `false` | `/notifications` |
| `tmuxNotification` | boolean | `true` | `/notifications` |

`responsePreview` 默认关闭，因为桌面通知历史可能在 Pi 之外保持可见。

### `ponytail`

| 字段 | 类型 | 默认值 | 控制入口 |
| --- | --- | --- | --- |
| `defaultMode` | `lite`、`full` 或 `ultra` | `full` | `/ponytail` |
| `hideStatus` | boolean | `false` | `/ponytail` |
| `quietStartup` | boolean | `false` | `/ponytail` |

当前进程存在 `PONYTAIL_*` 环境值时，它们会覆盖保存的 Ponytail 设置。

### `codeMode`

| 字段 | 类型 | 默认值 | 控制入口 |
| --- | --- | --- | --- |
| `enabled` | boolean | 进程默认值，否则 `false` | `/codemode global on|off` |

对于受信项目，`<project>/.pi/code-mode.json` 可以包含 boolean `enabled`。有效选择依次由冻结的子进程值、
项目 override、全局默认值、进程默认值和 `false` 解析。

### `web`

`web` 是由已配置 Web provider 使用的 JSON 对象。字段取决于这些 provider；Pi Stuff 保留对象，但不规定统一的
provider schema。

## 无效设置

无效命名空间会通过 `/diagnostics` 报告。交互式设置界面不会自动覆盖格式错误的用户 JSON。请修正报告的命名空间，
或先把它移走；重启 Pi 后，再通过所属命令应用所需值。

## 相关文档

- [命令参考](commands.md)
- [主题](themes.md)
- [故障排查](../troubleshooting.md)

