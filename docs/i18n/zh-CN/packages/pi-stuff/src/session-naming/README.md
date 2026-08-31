<!-- translation-source: packages/pi-stuff/src/session-naming/README.md; translation-source-sha256: 4de3581cc83b67755c57abfcccec9f3315f5ee9de791a7153009b62b999145ec -->

# Session Naming

[English](../../../../../../../packages/pi-stuff/src/session-naming/README.md)

直接用户工作结算后生成简短、可搜索的 Session 名称。

## 快速开始

```text
/autoname
/autoname settings
```

`/autoname` 立即重命名当前 Session。`/autoname settings` 控制自动命名、冷却期、手动名称策略与主要
naming model。

## 亮点

- 在未命名 Session 第一次用户运行结算后命名。
- 按可配置的冷却期刷新符合条件的名称。
- 开启对应偏好后保留手动名称。
- 依次使用固定 model、活动 Session model 与可选 fallback。
- 生成有界的两到四词英文名称。
- 使用有界、脱敏的 conversation 文字，不使用 Tool。

## 文档

- [Session Naming 指南](../../../../docs/capabilities/session-naming.md)
- [设置参考](../../../../docs/reference/settings.md#sessionnaming)
- [命令参考](../../../../docs/reference/commands.md#session-与支线问题)
- [故障排查](../../../../docs/troubleshooting.md)

