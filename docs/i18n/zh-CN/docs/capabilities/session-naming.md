<!-- translation-source: docs/capabilities/session-naming.md; translation-source-sha256: 16f21160af33b421735ebf4cd578ab182abf5a566b46976c150d38f9f50b49a4 -->

# Session Naming

[English](../../../../../docs/capabilities/session-naming.md)

Session Naming 为结算后的工作生成简短、可搜索的英文标签。它可以自动命名 Session，也可以按需重新生成当前名称。

## 快速开始

启动一个新的 Pi Session，并完成一次普通的用户启动 Agent 运行。运行结算后，未命名 Session 会得到生成的名称。

随时可以使用：

```text
/autoname
/autoname settings
```

`/autoname` 重新生成当前名称。`/autoname settings` 打开交互设置列表。

## 自动命名何时运行

自动命名只监听完全结算的直接用户工作。它不会因 child Session、被替换的 context 或单独由 Extension 发起的
continuation 而运行。

未命名 Session 会在第一次用户运行结算后命名。之后的命名尝试要等待配置的冷却期，默认 10 分钟。失败的尝试
可以在下一次符合条件的结算运行后重试。

## 设置

| 设置 | 默认值 | 作用 |
| --- | --- | --- |
| Automatic naming | 开 | 在用户工作结算后命名符合条件的 Session |
| Rename cooldown | 10 分钟 | 两次自动命名尝试之间的最短间隔 |
| Keep manually assigned names | 关 | 开启后阻止自动替换手动名称 |
| Naming model | Session model | 选择可选的固定主要 model |

Dialog 中的冷却期可选 10 分钟、30 分钟、1 小时、6 小时和 24 小时。高级 JSON 可以提供有序
`fallbackModels` 列表。

关闭自动命名不会禁用 `/autoname`。选择 **Session model** 会删除固定路由，优先使用活动 Session model。

## Model 路由

命名按以下顺序尝试已经认证的候选：

1. 已配置的固定 model；
2. 活动 Session model；
3. 已配置的 fallback model。

每次尝试限制为 12 秒和 64 个输出 token；整个操作限制为 30 秒。Model 回答不可用或无效时，只有通过同一名称
质量检查的本地 fallback 才会使用。选择 naming model 不会改变活动 conversation model。

## 名称契约

生成的名称：

- 使用英文和两到四个单词；
- 不超过 30 个字符；
- 使用可打印、文件名安全的文字；
- 保留有用的技术标识符；
- 描述当前任务，而不是笼统描述仓库。

任务没有实质变化时，符合要求的当前名称可以保持不变。

## Context 与隐私

命名 prompt 使用有界的完整 User 和 Assistant 文字。它会移除开头的 system reminder，把内容当作不受信输入，
并遮盖类似凭据的模式。命名调用不能使用 Tool。

活动 Session 名称和命名 marker 保存在 Session 自有状态中。`respectManualName` 用于在决定周期命名能否替换名称时，
区分手动名称与生成名称。

## 恢复

无效的 `sessionNaming` JSON 会启用完整的内置默认值，并加入一条 Diagnostic Record。设置 dialog 不会覆盖
格式错误的 JSON；请先修正命名空间，重启 Pi，再打开 `/autoname settings`。

## 相关文档

- [Session Naming Module README](../../packages/pi-stuff/src/session-naming/README.md)
- [命令参考](../reference/commands.md)
- [设置参考](../reference/settings.md)
- [故障排查](../troubleshooting.md)
